import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(new URL("../entrypoints/offscreen/main.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ESNext } },
).outputText;

function createOffscreen() {
  const messages = [];
  const errors = [];
  let poll;
  let receive;
  let changed;
  let respond = async () => ({ ok: true });
  const media = {
    matches: false,
    addEventListener(_event, listener) {
      changed = listener;
    },
  };

  runInNewContext(source, {
    console: { error: (...args) => errors.push(args) },
    window: {
      matchMedia: () => media,
      setInterval(listener) {
        poll = listener;
      },
    },
    browser: {
      runtime: {
        onMessage: {
          addListener(listener) {
            receive = listener;
          },
        },
        sendMessage(message) {
          messages.push({ ...message });
          return respond();
        },
      },
    },
  });

  return {
    media,
    messages,
    errors,
    poll: () => poll(),
    changed: () => changed(),
    setResponse: (callback) => {
      respond = callback;
    },
    sync: () => new Promise((resolve) => receive({ type: "toolbar-icon-sync" }, {}, resolve)),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("detects both theme changes when Chromium delivers no change events", async () => {
  const page = createOffscreen();
  await page.sync();
  assert.equal(page.messages.at(-1).dark, false);

  page.media.matches = true;
  page.poll();
  await settle();
  assert.equal(page.messages.at(-1).dark, true);

  page.media.matches = false;
  page.poll();
  await settle();
  assert.equal(page.messages.at(-1).dark, false);
  assert.equal(page.messages.length, 3);
  assert.equal(page.errors.length, 0);
});

test("unchanged polling does not wake the worker, but restart sync reapplies the icon", async () => {
  const page = createOffscreen();
  await page.sync();
  for (let i = 0; i < 10; i++) page.poll();
  await settle();
  assert.equal(page.messages.length, 1);

  await page.sync();
  assert.equal(page.messages.length, 2);
});

test("retries failed updates instead of treating the new theme as applied", async () => {
  const page = createOffscreen();
  await page.sync();
  page.media.matches = true;
  page.setResponse(async () => ({ ok: false }));
  page.poll();
  await settle();
  assert.equal(page.errors.length, 1);

  page.setResponse(async () => ({ ok: true }));
  page.poll();
  await settle();
  page.poll();
  assert.equal(page.messages.length, 3);
  assert.equal(page.messages.at(-1).dark, true);
});

test("coalesces polling and events while an icon update is in flight", async () => {
  const page = createOffscreen();
  await page.sync();
  let acknowledge;
  page.setResponse(() => new Promise((resolve) => (acknowledge = resolve)));
  page.media.matches = true;
  page.changed();
  page.poll();
  page.poll();
  assert.equal(page.messages.length, 2);

  // A second theme change during the request must be picked up by the next check.
  page.media.matches = false;
  acknowledge({ ok: true });
  await settle();
  page.setResponse(async () => ({ ok: true }));
  page.poll();
  await settle();
  assert.equal(page.messages.at(-1).dark, false);
  assert.equal(page.messages.length, 3);
});
