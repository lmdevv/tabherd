import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, chmod, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";

export const stateDirectory = () => process.env.TABHERD_STATE_DIR ?? join(homedir(), ".tabherd");
export async function prepareState() {
  const dir = stateDirectory();
  await mkdir(join(dir, "connections"), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(dir, 0o700);
    await chmod(join(dir, "connections"), 0o700);
  }
  return dir;
}
export async function socketAddress(instance: string) {
  const user = createHash("sha256")
    .update(`${homedir()}:${process.getuid?.() ?? "windows"}`)
    .digest("hex")
    .slice(0, 12);
  if (process.platform === "win32") return `\\\\.\\pipe\\tabherd-${user}-${instance}`;
  // macOS per-user temp paths exceed the 104-byte socket path limit; /tmp is short.
  const dir = join(process.platform === "darwin" ? "/tmp" : tmpdir(), `tabherd-${user}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Temp directories are shared: refuse a directory or link created by another user.
  const info = await lstat(dir);
  if (!info.isDirectory() || info.uid !== process.getuid?.())
    throw new Error(`Socket directory is not a private directory owned by this user: ${dir}`);
  await chmod(dir, 0o700);
  const address = join(dir, `${instance.replaceAll("-", "").slice(0, 16)}.sock`);
  if (Buffer.byteLength(address) > 100)
    throw new Error("Temporary directory path is too long for a Unix socket");
  return address;
}
