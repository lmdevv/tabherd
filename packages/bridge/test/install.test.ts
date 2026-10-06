import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, stat, rm, chmod, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_NAME, FIREFOX_ID } from "@tabherd/protocol";
import { launcherText, registration, type BrowserName } from "../src/install";
import { socketAddress } from "../src/paths";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
test("native host registration targets each supported browser and platform", () => {
  const browsers: BrowserName[] = ["chrome", "chromium", "edge", "brave", "firefox"];
  const linux = [
    ".config/google-chrome/NativeMessagingHosts",
    ".config/chromium/NativeMessagingHosts",
    ".config/microsoft-edge/NativeMessagingHosts",
    ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    ".mozilla/native-messaging-hosts",
  ];
  const mac = [
    "Google/Chrome",
    "Chromium",
    "Microsoft Edge",
    "BraveSoftware/Brave-Browser",
    "Mozilla",
  ];
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
      assert.deepEqual(chrome.allowed_origins, [`chrome-extension://${"a".repeat(32)}/`]);
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
