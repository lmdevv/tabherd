import { createServer, type Socket } from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { z } from "zod";
import {
  type HelloInput,
  Hello,
  WireResponse,
  PROTOCOL_VERSION,
  errorMessage,
  WireRequest,
} from "@tabby/protocol";
import { FrameDecoder, LineDecoder, encodeFrame, line } from "./framing";
import { prepareState, socketAddress } from "./paths";

export interface Connection extends HelloInput {
  socket: string;
  token: string;
  pid: number;
  connectedAt: number;
  instanceId: string;
}
const ClientRequest = z
  .object({
    token: z.string(),
    method: z.enum(["ping", "call", "batch", "page", "capabilities"]),
    input: z.unknown().optional(),
  })
  .strict();
const equalToken = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export async function nativeHost() {
  const state = await prepareState(),
    instanceId = randomUUID(),
    token = randomUUID();
  const socketPath = await socketAddress(instanceId);
  const descriptor = join(state, "connections", `${instanceId}.json`);
  const pending = new Map<string, Socket>(),
    clients = new Set<Socket>();
  let connection: Connection | undefined;
  let closing = false;
  function reply(client: Socket, result: unknown) {
    if (!client.destroyed) client.end(line(result));
  }
  const server = createServer((client) => {
    clients.add(client);
    client.setTimeout(65_000, () => client.destroy());
    const decoder = new LineDecoder();
    let requested = false;
    client.on("data", (chunk) => {
      try {
        for (const raw of decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)) {
          if (requested) throw new Error("One request per IPC connection");
          requested = true;
          const request = ClientRequest.parse(raw);
          if (!equalToken(request.token, token)) throw new Error("Unauthorized local client");
          if (!connection) throw new Error("Browser has not connected");
          if (request.method === "ping") {
            const { token: _token, socket: _socket, ...info } = connection;
            reply(client, { result: info });
            continue;
          }
          const id = randomUUID();
          process.stdout.write(
            encodeFrame(
              WireRequest.parse({
                type: "request",
                id,
                method: request.method,
                input: request.input,
              }),
            ),
          );
          pending.set(id, client);
        }
      } catch (error) {
        reply(client, { error: errorMessage(error) });
      }
    });
    client.on("error", () => {
      /* Client can leave while the browser operation continues. */
    });
    client.on("close", () => {
      clients.delete(client);
      for (const [id, socket] of pending) if (socket === client) pending.delete(id);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  // Unix directory is private; the bearer token also authenticates Windows pipe clients.
  server.on("error", (error) => {
    console.error(errorMessage(error));
    void close();
  });
  const frames = new FrameDecoder();
  const helloTimeout = setTimeout(() => {
    console.error("Tabby extension did not send hello");
    void close();
  }, 10_000);
  let incoming: Promise<void> = Promise.resolve();
  async function receive(raw: unknown) {
    if (closing) return;
    if (!connection) {
      const hello = Hello.parse(raw);
      if (hello.version !== PROTOCOL_VERSION) throw new Error("Unsupported protocol version");
      connection = {
        ...hello,
        instanceId,
        socket: socketPath,
        token,
        pid: process.pid,
        connectedAt: Date.now(),
      };
      await writeFile(descriptor, JSON.stringify(connection), { mode: 0o600, flag: "wx" });
      clearTimeout(helloTimeout);
      return;
    }
    const response = WireResponse.parse(raw),
      client = pending.get(response.id);
    if (client) {
      pending.delete(response.id);
      reply(client, { result: response.result, error: response.error });
    }
  }
  async function close() {
    if (closing) return;
    closing = true;
    clearTimeout(helloTimeout);
    for (const client of clients) client.destroy();
    server.close();
    await unlink(descriptor).catch(() => undefined);
    if (process.platform !== "win32") await unlink(socketPath).catch(() => undefined);
    process.stdin.destroy();
  }
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const message of frames.push(chunk))
        incoming = incoming
          .then(() => receive(message))
          .catch(async (error) => {
            console.error(errorMessage(error));
            await close();
          });
    } catch (error) {
      console.error(errorMessage(error));
      void close();
    }
  });
  process.stdin.on("end", () => {
    try {
      frames.end();
    } catch (error) {
      console.error(errorMessage(error));
    }
    void incoming.finally(close);
  });
  process.stdin.on("error", () => {
    void close();
  });
  process.stdout.on("error", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
  process.on("SIGINT", () => {
    void close();
  });
}
