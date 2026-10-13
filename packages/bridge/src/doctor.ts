import { access, constants, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CHROMIUM_ID, FIREFOX_ID, HOST_NAME, errorMessage } from "@tabherd/protocol";
import { inspectConnections } from "./client";
import { readInstallation, type Registration } from "./install";
import { stateDirectory } from "./paths";

const exec = promisify(execFile);
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}
const SETUP = "Run tabherd setup, then reload the extension.";

async function checkManifest(reg: Registration, launcher: string): Promise<Check> {
  const name = `${reg.browser} native host manifest`;
  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(reg.manifestPath, "utf8"));
  } catch (error) {
    return { name, ok: false, detail: `${reg.manifestPath}: ${errorMessage(error)}`, fix: SETUP };
  }
  const problems: string[] = [];
  if (manifest.name !== HOST_NAME) problems.push(`name is ${manifest.name}, expected ${HOST_NAME}`);
  if (manifest.path !== launcher) problems.push(`path is ${manifest.path}, expected ${launcher}`);
  if (reg.browser === "firefox") {
    if (!manifest.allowed_extensions?.includes(FIREFOX_ID))
      problems.push(`allowed_extensions lacks ${FIREFOX_ID}`);
  } else if (!manifest.allowed_origins?.includes(`chrome-extension://${CHROMIUM_ID}/`))
    problems.push(`allowed_origins lacks the Tabherd extension ID ${CHROMIUM_ID}`);
  if (reg.registryKey) {
    try {
      const { stdout } = await exec("reg.exe", ["query", reg.registryKey, "/ve"]);
      if (!stdout.includes(reg.manifestPath))
        problems.push(`registry key ${reg.registryKey} does not point at the manifest`);
    } catch {
      problems.push(`registry key ${reg.registryKey} is missing`);
    }
  }
  return problems.length
    ? { name, ok: false, detail: problems.join("; "), fix: SETUP }
    : { name, ok: true, detail: reg.manifestPath };
}

export async function doctor() {
  const checks: Check[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  checks.push({
    name: "Node.js version",
    ok: major > 22 || (major === 22 && minor >= 18),
    detail: process.versions.node,
    fix: "Install Node.js 22.18 or newer, then run tabherd setup again.",
  });
  const installation = await readInstallation().catch((error) => {
    checks.push({
      name: "installation record",
      ok: false,
      detail: errorMessage(error),
      fix: SETUP,
    });
    return null;
  });
  if (installation === undefined)
    checks.push({
      name: "installation record",
      ok: false,
      detail: `No installation in ${stateDirectory()}`,
      fix: "Run tabherd setup.",
    });
  if (installation) {
    checks.push({ name: "installation record", ok: true, detail: stateDirectory() });
    for (const [name, path, mode] of [
      [
        "launcher",
        installation.launcher,
        process.platform === "win32" ? constants.R_OK : constants.X_OK,
      ],
      ["registered Node.js", installation.node, constants.X_OK],
      ["registered bridge", installation.entry, constants.R_OK],
    ] as const) {
      const ok = await access(path, mode).then(
        () => true,
        () => false,
      );
      checks.push({
        name,
        ok,
        detail: ok
          ? path
          : `${path} is missing or not ${mode === constants.X_OK ? "executable" : "readable"}`,
        ...(ok ? {} : { fix: "Node.js or Tabherd moved. Run tabherd setup again." }),
      });
    }
    // Build bundles this module into dist/index.js, so this URL is the running binary.
    const current = fileURLToPath(import.meta.url);
    checks.push({
      name: "registered bridge matches this CLI",
      ok: installation.entry === current,
      detail:
        installation.entry === current
          ? current
          : `The browser launches ${installation.entry}; this CLI is ${current}`,
      ...(installation.entry === current
        ? {}
        : { fix: "Run tabherd setup with this CLI so the browser launches the same version." }),
    });
    if (!installation.registrations.length)
      checks.push({ name: "browser registrations", ok: false, detail: "None", fix: SETUP });
    for (const reg of installation.registrations)
      checks.push(await checkManifest(reg, installation.launcher));
  }
  const { live, stale } = await inspectConnections();
  checks.push({
    name: "browser connection",
    ok: live.length > 0,
    detail: live.length
      ? `${live.length} connected: ${live.map((c) => `${c.browser} ${c.connectionId}`).join(", ")}`
      : "No browser is connected",
    ...(live.length
      ? {}
      : {
          fix: "Open the browser with the Tabherd extension enabled, open its popup and choose Reconnect. If the popup shows an error, fix the failed checks above.",
        }),
  });
  return {
    ok: checks.every((check) => check.ok),
    checks,
    connections: live.map(({ socket: _socket, token: _token, ...info }) => info),
    staleDescriptorsRemoved: stale,
  };
}
