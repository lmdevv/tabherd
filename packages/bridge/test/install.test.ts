import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  rm,
  chmod,
  mkdir,
  symlink,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_NAME, FIREFOX_ID, CHROMIUM_ID } from "@tabherd/protocol";
import {
  detectBrowsers,
  findManifests,
  launcherText,
  registration,
  setupWarning,
  type BrowserName,
} from "../src/install";
import { socketAddress } from "../src/paths";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
test("native host registration targets each supported browser and platform", () => {
  const browsers: BrowserName[] = ["chrome", "chromium", "edge", "brave", "firefox"];
  const linux = [
    ".config/google-chrome/NativeMessagingHosts",
    ".config/chromium/NativeMessagingHosts",
    ".config/microsoft-edge/NativeMessagingHosts",
    ".config/google-chrome/NativeMessagingHosts",
    ".mozilla/native-messaging-hosts",
  ];
  const mac = ["Google/Chrome", "Chromium", "Microsoft Edge", "Google/Chrome", "Mozilla"];
  const windows = [
    "Google\\Chrome",
    "Chromium",
    "Microsoft\\Edge",
    "BraveSoftware\\Brave-Browser",
    "Mozilla",
  ];
  browsers.forEach((browser, i) => {
    assert.equal(
      registration(browser, "linux", "/home/example", "/state").manifestPath,
      join("/home/example", linux[i]!, `${HOST_NAME}.json`),
    );
    assert.equal(
      registration(browser, "darwin", "/Users/example", "/state").manifestPath,
      join(
        "/Users/example",
        "Library/Application Support",
        mac[i]!,
        "NativeMessagingHosts",
        `${HOST_NAME}.json`,
      ),
    );
    assert.equal(
      registration(browser, "win32", "home", "state").registryKey,
      `HKCU\\Software\\${windows[i]}\\NativeMessagingHosts\\${HOST_NAME}`,
    );
  });
  assert.throws(() => registration("chrome", "android", "/home", "/state"), /Unsupported/);
});

test("setup detects installed browsers from their profile directories", () => {
  const present = (paths: string[]) => (path: string) => paths.includes(path);
  assert.deepEqual(
    detectBrowsers(
      "linux",
      "/h",
      {},
      present([join("/h", ".config", "chromium"), join("/h", ".mozilla")]),
    ),
    ["chromium", "firefox"],
  );
  assert.deepEqual(
    detectBrowsers(
      "darwin",
      "/U",
      {},
      present([join("/U", "Library", "Application Support", "Google", "Chrome")]),
    ),
    ["chrome"],
  );
  assert.deepEqual(
    detectBrowsers(
      "win32",
      "C:\\u",
      { LOCALAPPDATA: "L", APPDATA: "R" },
      present([join("L", "Microsoft", "Edge", "User Data"), join("R", "Mozilla", "Firefox")]),
    ),
    ["edge", "firefox"],
  );
  assert.deepEqual(
    detectBrowsers("linux", "/h", {}, () => false),
    [],
  );
});

test(
  "POSIX launcher quotes arguments and embeds the configured state directory",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-launcher-"));
    try {
      const target = join(dir, "entry' $(never-execute).mjs"),
        launcher = join(dir, "launch"),
        state = join(dir, "state' $(literal)");
      await writeFile(
        target,
        "process.stdout.write(JSON.stringify({args:process.argv.slice(2),state:process.env.TABHERD_STATE_DIR}));",
      );
      await writeFile(launcher, launcherText("linux", process.execPath, target, state));
      await chmod(launcher, 0o700);
      const { stdout } = await exec(
        launcher,
        ["chrome-extension://abc/", "$(literal)", "with spaces"],
        { env: { ...process.env, TABHERD_STATE_DIR: "wrong-state" } },
      );
      assert.deepEqual(JSON.parse(stdout), {
        args: ["native-host", "chrome-extension://abc/", "$(literal)", "with spaces"],
        state,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("Windows launcher quotes paths, escapes environment expansion and rejects multiline paths", () => {
  const text = launcherText(
    "win32",
    "C:\\Program Files\\node.exe",
    "C:\\user%name\\tabherd.js",
    "C:\\state%name",
  );
  assert.ok(text.includes("user%%name"));
  assert.ok(text.includes("state%%name"));
  assert.ok(text.includes("DisableDelayedExpansion"));
  assert.ok(text.includes("%*"));
  assert.throws(() => launcherText("linux", "/node", "bad\nentry"), /newlines/);
  assert.throws(() => launcherText("linux", "/node", "/entry", "bad\rstate"), /newlines/);
  assert.throws(() => launcherText("win32", "node", 'bad"entry'), /Invalid/);
});

test(
  "Windows launcher works with absolute executable and entry paths",
  { skip: process.platform !== "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-launcher-"));
    try {
      const target = join(dir, "entry with spaces.mjs"),
        launcher = join(dir, "launch.cmd");
      await writeFile(target, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
      await writeFile(launcher, launcherText("win32", process.execPath, target));
      const { stdout } = await exec(
        "cmd.exe",
        ["/d", "/s", "/c", `""${launcher}" origin add-on-id"`],
        { windowsVerbatimArguments: true },
      );
      assert.deepEqual(JSON.parse(stdout), ["native-host", "origin", "add-on-id"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "CLI setup records browser-specific manifests and uninstall removes only registered files",
  { skip: process.platform === "win32", timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-install-")),
      state = join(dir, "state"),
      firefoxDir = join(dir, "firefox"),
      chromeDir = join(dir, "chrome");
    const cli = (args: string[]) =>
      exec(process.execPath, [entry, ...args], {
        env: { ...process.env, TABHERD_STATE_DIR: state },
      });
    try {
      await assert.rejects(
        cli([
          "setup",
          "--browser",
          "chrome",
          "--extension-id",
          "invalid",
          "--manifest-dir",
          chromeDir,
        ]),
      );
      await assert.rejects(stat(join(chromeDir, `${HOST_NAME}.json`)), { code: "ENOENT" });
      const first = JSON.parse(
        (await cli(["setup", "--browser", "firefox", "--manifest-dir", firefoxDir])).stdout,
      );
      const firefoxPath = join(firefoxDir, `${HOST_NAME}.json`),
        chromePath = join(chromeDir, `${HOST_NAME}.json`);
      const firefox = JSON.parse(await readFile(firefoxPath, "utf8"));
      assert.equal(firefox.name, HOST_NAME);
      assert.equal(firefox.type, "stdio");
      assert.deepEqual(firefox.allowed_extensions, [FIREFOX_ID]);
      assert.equal(firefox.allowed_origins, undefined);
      assert.equal(firefox.path, first.launcher);
      assert.equal((await stat(firefox.path)).mode & 0o777, 0o700);
      const launcher = await readFile(firefox.path, "utf8");
      assert.ok(launcher.includes(process.execPath));
      assert.ok(launcher.includes(entry));
      assert.ok(launcher.includes(state));
      await cli(["setup", "--browser", "chrome", "--manifest-dir", chromeDir]);
      assert.deepEqual(JSON.parse(await readFile(chromePath, "utf8")).allowed_origins, [
        `chrome-extension://${CHROMIUM_ID}/`,
      ]);
      await cli([
        "setup",
        "--browser",
        "chrome",
        "--extension-id",
        "a".repeat(32),
        "--manifest-dir",
        chromeDir,
      ]);
      const chrome = JSON.parse(await readFile(chromePath, "utf8"));
      assert.deepEqual(chrome.allowed_origins, [
        `chrome-extension://${CHROMIUM_ID}/`,
        `chrome-extension://${"a".repeat(32)}/`,
      ]);
      assert.equal(chrome.allowed_extensions, undefined);
      assert.equal((await stat(chromePath)).mode & 0o777, 0o600);
      const installed = JSON.parse(await readFile(join(state, "installation.json"), "utf8"));
      assert.equal(installed.registrations.length, 2);
      await cli([
        "setup",
        "--browser",
        "chrome",
        "--extension-id",
        "b".repeat(32),
        "--manifest-dir",
        chromeDir,
      ]);
      assert.equal(
        JSON.parse(await readFile(join(state, "installation.json"), "utf8")).registrations.length,
        2,
      );
      // A later setup keeps every ID allowed before, so custom builds stay connected.
      await cli(["setup", "--browser", "chrome", "--manifest-dir", chromeDir]);
      assert.deepEqual(JSON.parse(await readFile(chromePath, "utf8")).allowed_origins, [
        `chrome-extension://${CHROMIUM_ID}/`,
        `chrome-extension://${"a".repeat(32)}/`,
        `chrome-extension://${"b".repeat(32)}/`,
      ]);
      await assert.rejects(cli(["setup", "--manifest-dir", chromeDir]), /requires --browser/);
      // Doctor checks every stored ID, and setup ignores corrupt stored IDs.
      const record = join(state, "installation.json");
      const saved = JSON.parse(await readFile(record, "utf8"));
      await writeFile(
        chromePath,
        JSON.stringify({
          ...JSON.parse(await readFile(chromePath, "utf8")),
          allowed_origins: [`chrome-extension://${CHROMIUM_ID}/`],
        }),
      );
      const missing = JSON.parse((await cli(["doctor"]).catch((error) => error)).stdout);
      assert.match(
        missing.checks.find((c: any) => c.name === "chrome native host manifest").detail,
        new RegExp(`lacks extension ID ${"a".repeat(32)}`),
      );
      await writeFile(record, JSON.stringify({ ...saved, extensionIds: "corrupt" }));
      await cli(["setup", "--browser", "chrome", "--manifest-dir", chromeDir]);
      assert.deepEqual(JSON.parse(await readFile(chromePath, "utf8")).allowed_origins, [
        `chrome-extension://${CHROMIUM_ID}/`,
      ]);
      await writeFile(record, JSON.stringify(saved));
      await cli(["setup", "--browser", "chrome", "--manifest-dir", chromeDir]);
      const healthy = JSON.parse((await cli(["doctor"]).catch((error) => error)).stdout);
      assert.equal(healthy.ok, false, "no browser is connected");
      assert.deepEqual(
        healthy.checks.filter((check: { ok: boolean }) => !check.ok).map((c: any) => c.name),
        ["browser connection"],
      );
      await writeFile(chromePath, JSON.stringify({ name: HOST_NAME, path: "/elsewhere" }));
      const broken = JSON.parse((await cli(["doctor"]).catch((error) => error)).stdout);
      const manifestCheck = broken.checks.find(
        (c: any) => c.name === "chrome native host manifest",
      );
      assert.equal(manifestCheck.ok, false);
      assert.match(manifestCheck.detail, /path is \/elsewhere/);
      assert.match(manifestCheck.detail, /allowed_origins lacks/);
      assert.match(manifestCheck.fix, /tabherd setup/);
      const unrelated = join(chromeDir, "unrelated.json");
      await writeFile(unrelated, "keep");
      const removed = JSON.parse((await cli(["uninstall"])).stdout);
      assert.equal(removed.removed.length, 2);
      await assert.rejects(readFile(firefoxPath), { code: "ENOENT" });
      await assert.rejects(readFile(chromePath), { code: "ENOENT" });
      await assert.rejects(readFile(join(state, "installation.json")), { code: "ENOENT" });
      assert.equal(await readFile(unrelated, "utf8"), "keep");
      assert.deepEqual(JSON.parse((await cli(["uninstall"])).stdout).removed, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "socket paths stay short and refuse a socket directory replaced with a link",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-socket-"));
    const previous = process.env.TMPDIR;
    try {
      const address = await socketAddress(crypto.randomUUID());
      assert.ok(Buffer.byteLength(address) <= 100, address);
      assert.equal((await stat(dirname(address))).mode & 0o777, 0o700);
      if (process.platform !== "linux") return;
      // On Linux the socket directory follows TMPDIR, so a planted link is testable.
      process.env.TMPDIR = dir;
      const elsewhere = join(dir, "elsewhere");
      await mkdir(elsewhere);
      await symlink(elsewhere, join(dir, basename(dirname(address))));
      await assert.rejects(socketAddress(crypto.randomUUID()), /not a private directory/);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "setup warns when it runs from the temporary npx cache",
  { skip: process.platform === "win32", timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-npx-"));
    try {
      const pkg = join(dir, "_npx", "abc", "node_modules", "tabherd");
      await mkdir(join(pkg, "dist"), { recursive: true });
      await copyFile(entry, join(pkg, "dist", "index.js"));
      await symlink(
        fileURLToPath(new URL("../node_modules", import.meta.url)),
        join(pkg, "node_modules"),
      );
      const run = async (script: string) =>
        JSON.parse(
          (
            await exec(
              process.execPath,
              [script, "setup", "--browser", "firefox", "--manifest-dir", join(dir, "manifests")],
              { env: { ...process.env, TABHERD_STATE_DIR: join(dir, "state") } },
            )
          ).stdout,
        );
      assert.match((await run(join(pkg, "dist", "index.js"))).warning, /npx cache/);
      assert.equal((await run(entry)).warning, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("manifest discovery covers per-user and machine-wide locations", () => {
  // Paths are built with the host's separator, so build the fixtures the same way.
  const present = new Set([
    join("/home/example", ".config/chromium/NativeMessagingHosts", `${HOST_NAME}.json`),
    join("/etc/opt/chrome/native-messaging-hosts", `${HOST_NAME}.json`),
    join("/usr/lib/mozilla/native-messaging-hosts", `${HOST_NAME}.json`),
  ]);
  assert.deepEqual(
    findManifests("linux", "/home/example", (path) => present.has(path)).map((r) => [
      r.browser,
      r.manifestPath,
    ]),
    [...present].map((path, i) => [["chromium", "chrome", "firefox"][i], path]),
  );
  assert.deepEqual(
    findManifests("win32", "C:\\Users\\example", () => true),
    [],
  );
});

test("setup warns about registrations that a cache or garbage collection removes", () => {
  const npx = join("/home/u/.npm/_npx/abc/node_modules/tabherd/dist/index.js");
  assert.match(setupWarning(npx)!, /npx/);
  assert.match(setupWarning("/nix/store/abc-tabherd-0.1.0/lib/tabherd/dist/index.js")!, /Nix/);
  assert.equal(setupWarning(join("/usr/lib/node_modules/tabherd/dist/index.js")), undefined);
});

test(
  "doctor accepts native host manifests installed outside tabherd setup",
  { skip: process.platform === "win32", timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tabherd-managed-"));
    try {
      const home = join(dir, "home");
      const { manifestPath } = registration("chromium", process.platform, home, "");
      const launcher = join(dir, "native-host");
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(launcher, "#!/bin/sh\n");
      await chmod(launcher, 0o755);
      const manifest = {
        name: HOST_NAME,
        path: launcher,
        type: "stdio",
        allowed_origins: [`chrome-extension://${CHROMIUM_ID}/`],
      };
      const doctor = async () => {
        const env = { ...process.env, HOME: home, TABHERD_STATE_DIR: join(dir, "state") };
        const result = await exec(process.execPath, [entry, "doctor"], { env }).catch((e) => e);
        const report = JSON.parse(result.stdout);
        return {
          record: report.checks.find((c: any) => c.name === "installation record"),
          manifest: report.checks.find((c: any) => c.detail.includes(manifestPath)),
        };
      };
      const none = await doctor();
      assert.equal(none.manifest, undefined);
      await writeFile(manifestPath, JSON.stringify(manifest));
      const managed = await doctor();
      assert.equal(managed.record.ok, true);
      assert.equal(managed.manifest.ok, true);
      // A directory passes an execute-permission check but cannot be launched.
      await writeFile(manifestPath, JSON.stringify({ ...manifest, path: dir }));
      assert.match((await doctor()).manifest.detail, /not an executable file/);
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, path: join(dir, "gone"), allowed_origins: [] }),
      );
      const broken = await doctor();
      assert.equal(broken.manifest.ok, false);
      assert.match(broken.manifest.detail, /not an executable file/);
      assert.match(broken.manifest.detail, /lacks extension ID/);
      assert.match(broken.manifest.fix, /Nix/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
