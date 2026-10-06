import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, chmod } from "node:fs/promises";
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
  const dir = join(tmpdir(), `tabherd-${user}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const address = join(dir, `${instance}.sock`);
  if (Buffer.byteLength(address) > 100)
    throw new Error("Temporary directory path is too long for a Unix socket");
  return address;
}
