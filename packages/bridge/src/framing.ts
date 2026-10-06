import { endianness } from "node:os";
import { MAX_MESSAGE_BYTES } from "@tabby/protocol";

export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_MESSAGE_BYTES) throw new Error("Native message exceeds size limit");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(payload.length);
  else header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length =
        endianness() === "LE" ? this.buffer.readUInt32LE(0) : this.buffer.readUInt32BE(0);
      if (!length || length > MAX_MESSAGE_BYTES) throw new Error("Invalid native message size");
      if (this.buffer.length < length + 4) break;
      messages.push(JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")));
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }
  end() {
    if (this.buffer.length) throw new Error("Truncated native message");
  }
}
export class LineDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    let end: number;
    while ((end = this.buffer.indexOf(10)) !== -1) {
      if (end > MAX_MESSAGE_BYTES) throw new Error("IPC message exceeds size limit");
      messages.push(JSON.parse(this.buffer.subarray(0, end).toString("utf8")));
      this.buffer = this.buffer.subarray(end + 1);
    }
    if (this.buffer.length > MAX_MESSAGE_BYTES) throw new Error("IPC message exceeds size limit");
    return messages;
  }
}
export function line(value: unknown) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES)
    throw new Error("IPC message exceeds size limit");
  return `${payload}\n`;
}
