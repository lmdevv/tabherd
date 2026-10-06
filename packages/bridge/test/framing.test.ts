import { test } from "node:test";
import assert from "node:assert/strict";
import { endianness } from "node:os";
import { MAX_MESSAGE_BYTES } from "@tabby/protocol";
import { FrameDecoder, LineDecoder, encodeFrame, line } from "../src/framing";

function header(size: number) {
  const result = Buffer.alloc(4);
  if (endianness() === "LE") result.writeUInt32LE(size);
  else result.writeUInt32BE(size);
  return result;
}

test("native framing preserves fragmented Unicode and coalesced messages", () => {
  const values = [{ title: "資料 🎮 café" }, { tabs: [1, 2] }];
  const encoded = Buffer.concat(values.map(encodeFrame));
  const decoder = new FrameDecoder(),
    decoded: unknown[] = [];
  for (let offset = 0; offset < encoded.length; offset += 3)
    decoded.push(...decoder.push(encoded.subarray(offset, offset + 3)));
  assert.deepEqual(decoded, values);
  decoder.end();
  assert.deepEqual(new FrameDecoder().push(encoded), values);
});

test("native framing accepts the exact byte limit and rejects oversized or empty payloads", () => {
  const value = "x".repeat(MAX_MESSAGE_BYTES - 2);
  assert.equal(encodeFrame(value).length, MAX_MESSAGE_BYTES + 4);
  assert.deepEqual(new FrameDecoder().push(encodeFrame(value)), [value]);
  assert.throws(() => encodeFrame(`${value}x`), /size limit/);
  assert.throws(() => new FrameDecoder().push(header(MAX_MESSAGE_BYTES + 1)), /size/);
  assert.throws(() => new FrameDecoder().push(header(0)), /size/);
  assert.throws(
    () => new FrameDecoder().push(Buffer.concat([header(1), Buffer.from("{")])),
    SyntaxError,
  );
});

test("native framing rejects incomplete headers and payloads at EOF", () => {
  const encoded = encodeFrame({ value: 1 });
  for (const length of [1, 3, 4, encoded.length - 1]) {
    const decoder = new FrameDecoder();
    assert.deepEqual(decoder.push(encoded.subarray(0, length)), []);
    assert.throws(() => decoder.end(), /Truncated/);
  }
});

test("IPC framing uses byte boundaries and supports multiple complete lines", () => {
  const values = [{ text: "🎮資料" }, { tab: 3 }];
  const bytes = Buffer.from(values.map(line).join(""));
  const decoder = new LineDecoder(),
    decoded: unknown[] = [];
  for (const byte of bytes) decoded.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(decoded, values);
  assert.deepEqual(new LineDecoder().push(bytes), values);
});

test("IPC byte limit applies independently to each line and incomplete buffers", () => {
  const value = "x".repeat(MAX_MESSAGE_BYTES - 2);
  assert.deepEqual(new LineDecoder().push(Buffer.from(line(value))), [value]);
  assert.deepEqual(new LineDecoder().push(Buffer.from(line(value) + line(value))), [value, value]);
  assert.throws(() => line(`${value}x`), /size limit/);
  assert.throws(() => line("🎮".repeat(MAX_MESSAGE_BYTES / 4)), /size limit/);
  assert.throws(() => new LineDecoder().push(Buffer.alloc(MAX_MESSAGE_BYTES + 1)), /size limit/);
  assert.throws(
    () => new LineDecoder().push(Buffer.from(`${"x".repeat(MAX_MESSAGE_BYTES + 1)}\n`)),
    /size limit/,
  );
  assert.throws(() => new LineDecoder().push(Buffer.from("invalid\n")), SyntaxError);
});
