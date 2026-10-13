import { homedir } from "node:os";
import { join, dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HOST_NAME, FIREFOX_ID, CHROMIUM_ID } from "@tabherd/protocol";
import { prepareState, stateDirectory } from "./paths";

const exec = promisify(execFile);
export const BROWSERS = ["chrome", "chromium", "edge", "brave", "firefox"] as const;
export type BrowserName = (typeof BROWSERS)[number];
export interface Registration {
  browser: BrowserName;
  manifestPath: string;
  registryKey?: string;
}
type Env = Record<string, string | undefined>;
// Chromium browsers keep their Linux profiles under XDG_CONFIG_HOME; relative values are ignored.
export const configHome = (home: string, env: Env = process.env) =>
  env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : join(home, ".config");
export function registration(
  browser: BrowserName,
  platform: string,
  home: string,
  state: string,
  env: Env = process.env,
): Registration {
  const dirs = {
    chrome: {
      linux: "google-chrome/NativeMessagingHosts",
      darwin: "Google/Chrome",
      registry: "Google\\Chrome",
    },
    chromium: {
      linux: "chromium/NativeMessagingHosts",
      darwin: "Chromium",
      registry: "Chromium",
    },
    edge: {
      linux: "microsoft-edge/NativeMessagingHosts",
      darwin: "Microsoft Edge",
      registry: "Microsoft\\Edge",
    },
    // Brave reads Chrome's directories on Linux and macOS (brave-core app/brave_main_delegate.cc).
    brave: {
      linux: "google-chrome/NativeMessagingHosts",
      darwin: "Google/Chrome",
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
    return {
      browser,
      manifestPath: join(
        browser === "firefox" ? home : configHome(home, env),
        dirs.linux,
        `${HOST_NAME}.json`,
      ),
    };
  throw new Error(`Unsupported platform: ${platform}`);
}
// Machine-wide locations, used by package managers such as the NixOS module.
export const SYSTEM_MANIFEST_DIRECTORIES: Partial<Record<string, [BrowserName, string][]>> = {
  linux: [
    ["chrome", "/etc/opt/chrome/native-messaging-hosts"],
    ["chromium", "/etc/chromium/native-messaging-hosts"],
    ["edge", "/etc/opt/edge/native-messaging-hosts"],
    ["firefox", "/usr/lib/mozilla/native-messaging-hosts"],
    ["firefox", "/usr/lib64/mozilla/native-messaging-hosts"],
  ],
};
/** Manifests that exist on this machine, whoever wrote them. */
export function findManifests(
  platform: string,
  home: string,
  exists: (path: string) => boolean = existsSync,
  env: Env = process.env,
): Registration[] {
  if (platform === "win32") return [];
  const candidates = [
    ...BROWSERS.map((browser) => registration(browser, platform, home, "", env)),
    ...(SYSTEM_MANIFEST_DIRECTORIES[platform] ?? []).map(([browser, directory]) => ({
      browser,
      manifestPath: join(directory, `${HOST_NAME}.json`),
    })),
  ];
  // Brave shares Chrome's file; report each file once.
  const unique = [...new Map(candidates.map((reg) => [reg.manifestPath, reg])).values()];
  return unique.filter((reg) => exists(reg.manifestPath));
}
// Profile directories show which browsers this user has run.
export function detectBrowsers(
  platform: string,
  home: string,
  env: Env = process.env,
  exists: (path: string) => boolean = existsSync,
): BrowserName[] {
  const config = configHome(home, env);
  const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
    roaming = env.APPDATA ?? join(home, "AppData", "Roaming"),
    support = join(home, "Library", "Application Support");
  const paths: Record<BrowserName, string> =
    platform === "win32"
      ? {
          chrome: join(local, "Google", "Chrome", "User Data"),
          chromium: join(local, "Chromium", "User Data"),
          edge: join(local, "Microsoft", "Edge", "User Data"),
          brave: join(local, "BraveSoftware", "Brave-Browser", "User Data"),
          firefox: join(roaming, "Mozilla", "Firefox"),
        }
      : platform === "darwin"
        ? {
            chrome: join(support, "Google", "Chrome"),
            chromium: join(support, "Chromium"),
            edge: join(support, "Microsoft Edge"),
            brave: join(support, "BraveSoftware", "Brave-Browser"),
            firefox: join(support, "Firefox"),
          }
        : {
            chrome: join(config, "google-chrome"),
            chromium: join(config, "chromium"),
            edge: join(config, "microsoft-edge"),
            brave: join(config, "BraveSoftware", "Brave-Browser"),
            firefox: join(home, ".mozilla"),
          };
  return BROWSERS.filter((browser) => exists(paths[browser]));
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
  /** Extra Chromium extension IDs, e.g. a store or self-built copy. The release ID is always allowed. */
  extensionIds?: string[];
  manifestDirectory?: string;
}
export async function install(options: InstallOptions) {
  if (!options.browsers.length) throw new Error("Select a browser");
  const invalid = (options.extensionIds ?? []).find((id) => !isExtensionId(id));
  if (invalid !== undefined)
    throw new Error(
      `Invalid --extension-id ${JSON.stringify(invalid)}: use the 32-letter ID from chrome://extensions`,
    );
  // Keep IDs allowed by earlier setups, so re-running setup never disconnects a custom build.
  const extensionIds = [
    ...new Set([
      CHROMIUM_ID,
      ...storedExtensionIds(await readInstallation()),
      ...(options.extensionIds ?? []),
    ]),
  ];
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
        : { allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`) }),
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
        extensionIds,
        registrations: [...new Map(merged.map((r) => [r.browser, r])).values()],
      }),
      { mode: 0o600 },
    );
  }
  const warning = setupWarning(entry);
  return {
    ...(warning ? { warning } : {}),
    installed: registrations,
    launcher,
    node,
    entry,
    extensionIds: options.browsers.some((b) => b !== "firefox") ? extensionIds : undefined,
    next: "Reload the extension (or restart the browser), then run tabherd doctor",
  };
}
export function setupWarning(entry: string) {
  // The npx cache is temporary; a registration pointing into it breaks once it is cleaned.
  if (entry.includes(`${sep}_npx${sep}`))
    return "Setup ran from the temporary npx cache. Install globally with npm install -g tabherd, then run tabherd setup again.";
  // A store path disappears after an upgrade and garbage collection.
  if (entry.startsWith("/nix/store/"))
    return "Setup registered a Nix store path, which breaks once this version is garbage-collected. Use the NixOS or Home Manager module instead, or run tabherd setup again after every upgrade.";
}
export const isExtensionId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-p]{32}$/.test(id);
// installation.json is user-editable; ignore anything that is not a valid ID.
export const storedExtensionIds = (state: InstallState | undefined): string[] =>
  Array.isArray(state?.extensionIds) ? state.extensionIds.filter(isExtensionId) : [];
export interface InstallState {
  node: string;
  entry: string;
  launcher: string;
  extensionIds?: string[];
  registrations: Registration[];
}
export async function readInstallation(): Promise<InstallState | undefined> {
  try {
    return JSON.parse(await readFile(join(stateDirectory(), "installation.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function readInstallState(): Promise<Registration[]> {
  return (await readInstallation())?.registrations ?? [];
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
