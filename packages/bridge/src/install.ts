import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HOST_NAME, FIREFOX_ID } from "@tabherd/protocol";
import { prepareState, stateDirectory } from "./paths";

const exec = promisify(execFile);
export type BrowserName = "chrome" | "chromium" | "edge" | "brave" | "firefox";
export interface Registration {
  browser: BrowserName;
  manifestPath: string;
  registryKey?: string;
}
export function registration(
  browser: BrowserName,
  platform: string,
  home: string,
  state: string,
): Registration {
  const dirs = {
    chrome: {
      linux: ".config/google-chrome/NativeMessagingHosts",
      darwin: "Google/Chrome",
      registry: "Google\\Chrome",
    },
    chromium: {
      linux: ".config/chromium/NativeMessagingHosts",
      darwin: "Chromium",
      registry: "Chromium",
    },
    edge: {
      linux: ".config/microsoft-edge/NativeMessagingHosts",
      darwin: "Microsoft Edge",
      registry: "Microsoft\\Edge",
    },
    brave: {
      linux: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
      darwin: "BraveSoftware/Brave-Browser",
      registry: "BraveSoftware\\Brave-Browser",
    },
    firefox: { linux: ".mozilla/native-messaging-hosts", darwin: "Mozilla", registry: "Mozilla" },
  }[browser];
  if (!dirs) throw new Error(`Unsupported browser: ${browser}`);
  if (platform === "win32")
    return {
      browser,
      manifestPath: join(state, `${browser}-${HOST_NAME}.json`),
      registryKey: `HKCU\\Software\\${dirs.registry}\\NativeMessagingHosts\\${HOST_NAME}`,
    };
  if (platform === "darwin")
    return {
      browser,
      manifestPath: join(
        home,
        "Library",
        "Application Support",
        dirs.darwin,
        "NativeMessagingHosts",
        `${HOST_NAME}.json`,
      ),
    };
  if (platform === "linux")
    return { browser, manifestPath: join(home, dirs.linux, `${HOST_NAME}.json`) };
  throw new Error(`Unsupported platform: ${platform}`);
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function launcherText(platform: string, node: string, entry: string, state?: string) {
  if ([node, entry, ...(state ? [state] : [])].some((v) => /[\r\n]/.test(v)))
    throw new Error("Launcher paths cannot contain newlines");
  if (platform === "win32") {
    if ([node, entry, ...(state ? [state] : [])].some((v) => v.includes('"')))
      throw new Error("Invalid Windows launcher path");
    const escape = (v: string) => v.replaceAll("%", "%%");
    return `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${state ? `set "TABHERD_STATE_DIR=${escape(state)}"\r\n` : ""}"${escape(node)}" "${escape(entry)}" native-host %*\r\n`;
  }
  return `#!/bin/sh\n${state ? `export TABHERD_STATE_DIR=${quote(state)}\n` : ""}exec ${quote(node)} ${quote(entry)} native-host "$@"\n`;
}
export interface InstallOptions {
  browsers: BrowserName[];
  extensionId?: string;
  manifestDirectory?: string;
}
export async function install(options: InstallOptions) {
  if (!options.browsers.length) throw new Error("Select a browser");
  if (
    options.browsers.some((b) => b !== "firefox") &&
    !/^[a-p]{32}$/.test(options.extensionId ?? "")
  )
    throw new Error(
      "Provide --extension-id with the installed extension's 32-letter ID from chrome://extensions",
    );
  if (options.manifestDirectory && options.browsers.length !== 1)
    throw new Error("--manifest-dir requires exactly one browser");
  const state = await prepareState();
  // Build bundles this module into dist/index.js, so this URL resolves the actual installed binary.
  const entry = fileURLToPath(import.meta.url),
    node = process.execPath;
  await access(entry);
  await access(node);
  const launcher = join(state, process.platform === "win32" ? "native-host.cmd" : "native-host");
  await writeFile(launcher, launcherText(process.platform, node, entry, state), { mode: 0o700 });
  const registrations: Registration[] = [];
  for (const browser of options.browsers) {
    const reg = registration(browser, process.platform, homedir(), state);
    if (options.manifestDirectory)
      reg.manifestPath = join(resolve(options.manifestDirectory), `${HOST_NAME}.json`);
    const manifest = {
      name: HOST_NAME,
      description: "Tabherd local browser bridge",
      path: launcher,
      type: "stdio",
      ...(browser === "firefox"
        ? { allowed_extensions: [FIREFOX_ID] }
        : { allowed_origins: [`chrome-extension://${options.extensionId}/`] }),
    };
    await mkdir(dirname(reg.manifestPath), { recursive: true });
    await writeFile(reg.manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    if (reg.registryKey)
      await exec("reg.exe", [
        "add",
        reg.registryKey,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        reg.manifestPath,
        "/f",
      ]);
    registrations.push(reg);
    // Record each completed registration, so a failed later browser install remains removable.
    const previous = await readInstallState();
    const merged = [...previous.filter((old) => old.browser !== browser), ...registrations];
    await writeFile(
      join(state, "installation.json"),
      JSON.stringify({
        node,
        entry,
        launcher,
        registrations: [...new Map(merged.map((r) => [r.browser, r])).values()],
      }),
      { mode: 0o600 },
    );
  }
  return {
    installed: registrations,
    launcher,
    node,
    entry,
    next: "Enable or reload the extension, wait up to one minute, then run tabherd status",
  };
}
async function readInstallState(): Promise<Registration[]> {
  try {
    const data = JSON.parse(await readFile(join(stateDirectory(), "installation.json"), "utf8"));
    return data.registrations ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function uninstall() {
  const registrations = await readInstallState();
  for (const reg of registrations) {
    if (reg.registryKey) await exec("reg.exe", ["delete", reg.registryKey, "/f"]);
    await unlink(reg.manifestPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  await unlink(join(stateDirectory(), "installation.json")).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  return {
    removed: registrations,
    next: "Disable or reload the extension to end existing native-host connections.",
  };
}
