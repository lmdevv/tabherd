import { createConnection } from "node:net";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  CallRequest,
  BatchRequest,
  PageRequest,
  Hello,
  errorMessage,
  type BridgeMethod,
} from "@tabherd/protocol";
import { type Connection } from "./native-host";
import { LineDecoder, line } from "./framing";
import { stateDirectory } from "./paths";

const Descriptor = Hello.extend({
  socket: z.string(),
  token: z.string(),
  pid: z.number(),
  connectedAt: z.number(),
  instanceId: z.string(),
});
const Response = z.object({ result: z.unknown().optional(), error: z.string().optional() });
export function request(
  connection: Connection,
  method: "ping" | BridgeMethod,
  input?: unknown,
  timeoutMs = 60_000,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const client = createConnection(connection.socket),
      decoder = new LineDecoder();
    let done = false;
    const finish = (error?: Error, result?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Browser request timed out; mutation outcome may be unknown. Inspect browser state before retrying; mutations are never retried automatically.",
          ),
        ),
      timeoutMs,
    );
    client.on("connect", () => {
      try {
        client.write(line({ token: connection.token, method, input }));
      } catch (error) {
        finish(new Error(errorMessage(error)));
      }
    });
    client.on("data", (chunk) => {
      try {
        const messages = decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if (messages.length) {
          const response = Response.parse(messages[0]);
          finish(response.error ? new Error(response.error) : undefined, response.result);
        }
      } catch (error) {
        finish(new Error(errorMessage(error)));
      }
    });
    client.on("error", (error) => finish(error));
    client.on("close", () =>
      finish(
        new Error("Browser connection closed; inspect browser state before repeating a mutation"),
      ),
    );
  });
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};
export async function inspectConnections(): Promise<{ live: Connection[]; stale: number }> {
  const dir = join(stateDirectory(), "connections");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { live: [], stale: 0 };
    throw error;
  }
  let stale = 0;
  const results = await Promise.allSettled(
    files
      .filter((name) => name.endsWith(".json"))
      .map(async (file) => {
        const path = join(dir, file);
        const connection = Descriptor.parse(JSON.parse(await readFile(path, "utf8")));
        try {
          await request(connection, "ping", undefined, 1500);
        } catch (error) {
          // Only a crashed host leaves its descriptor behind; a live but busy host keeps it.
          if (!alive(connection.pid)) {
            await unlink(path).catch(() => undefined);
            stale++;
          }
          throw error;
        }
        return connection;
      }),
  );
  return {
    live: results
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .sort((a, b) => b.connectedAt - a.connectedAt),
    stale,
  };
}
export async function discover(): Promise<Connection[]> {
  return (await inspectConnections()).live;
}
export async function dispatch(method: BridgeMethod, raw: unknown = {}): Promise<unknown> {
  const input =
    method === "call"
      ? CallRequest.parse(raw)
      : method === "batch"
        ? BatchRequest.parse(raw)
        : method === "page"
          ? PageRequest.parse(raw)
          : z.object({ connectionId: z.string().optional() }).strict().parse(raw);
  const connections = await discover();
  const matching = input.connectionId
    ? connections.filter((c) => c.connectionId === input.connectionId)
    : connections;
  if (!matching.length)
    throw new Error(
      "No matching browser connected. Run tabherd setup, reload the extension, then tabherd status.",
    );
  if (matching.length > 1)
    throw new Error(
      "Multiple browser profiles connected; provide connectionId from browser_connections or tabherd status.",
    );
  return request(matching[0]!, method, input);
}
export async function connections() {
  return (await discover()).map(({ socket: _socket, token: _token, ...info }) => info);
}
