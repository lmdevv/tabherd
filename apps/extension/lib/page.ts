import type { PageInput } from "@tabherd/protocol";
import type { BrowserApi } from "./engine.ts";

// This function is serialized by scripting.executeScript: keep it self-contained.
export function domAction(input: PageInput, mode?: "measure" | "locate" | "focus" | null) {
  const selected = () => {
    if (!input.selector) throw new Error(`${input.action} requires selector.`);
    const element = document.querySelector(input.selector);
    if (!element) throw new Error(`No element matches selector: ${input.selector}`);
    return element as HTMLElement;
  };
  const selectorFor = (element: Element) => {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
      return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && node !== document.documentElement) {
      const tag = node.localName;
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter((child) => child.localName === tag)
        : [];
      parts.unshift(
        `${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ""}`,
      );
      node = node.parentElement;
    }
    return `html > ${parts.join(" > ")}`;
  };
  if (input.action === "read") {
    const text = document.body?.innerText ?? "";
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href],button,input,textarea,select,[role=button],[contenteditable=true]",
      ),
    );
    return {
      title: document.title,
      url: location.href,
      text: text.slice(0, input.maxTextLength),
      textTruncated: text.length > input.maxTextLength,
      links: links.slice(0, input.maxElements).map((element) => ({
        text: (element.innerText || element.getAttribute("aria-label") || "").slice(0, 300),
        url: element.href,
        selector: selectorFor(element),
      })),
      linksTruncated: links.length > input.maxElements,
      elements: elements.slice(0, input.maxElements).map((element) => ({
        selector: selectorFor(element),
        tag: element.localName,
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        role: element.getAttribute("role"),
        label: (
          element.getAttribute("aria-label") ||
          (element as HTMLInputElement).labels?.[0]?.innerText ||
          element.innerText ||
          element.getAttribute("placeholder") ||
          ""
        ).slice(0, 300),
        disabled: Boolean((element as HTMLButtonElement).disabled),
        ...(element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && !["password", "file"].includes(element.type))
          ? {
              value: element.value.slice(0, input.maxTextLength),
              valueTruncated: element.value.length > input.maxTextLength,
            }
          : {}),
        ...(element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
          ? { checked: element.checked }
          : {}),
        ...(element instanceof HTMLSelectElement
          ? {
              options: Array.from(element.options)
                .slice(0, 100)
                .map((option) => ({
                  value: option.value,
                  text: option.text,
                  selected: option.selected,
                })),
            }
          : {}),
      })),
      elementsTruncated: elements.length > input.maxElements,
    };
  }
  if (input.action === "wait") {
    let found: boolean;
    if (input.selector) {
      const element = document.querySelector(input.selector);
      found = !!element && (element.checkVisibility?.() ?? element.getClientRects().length > 0);
    } else if (input.text !== undefined)
      found = (document.body?.innerText ?? "").includes(input.text);
    else throw new Error("wait in the page requires selector or text.");
    return { found: input.gone ? !found : found };
  }
  if (input.action === "scroll") {
    const element = input.selector ? selected() : window;
    element.scrollBy({ left: input.x ?? 0, top: input.y ?? 0, behavior: "instant" });
    return { ok: true };
  }
  if (input.action === "select") {
    if (input.value === undefined) throw new Error("select requires value.");
    const element = selected();
    if (!(element instanceof HTMLSelectElement))
      throw new Error("select requires a <select> element.");
    if (!Array.from(element.options).some((option) => option.value === input.value))
      throw new Error(`No option has value: ${input.value}`);
    element.value = input.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: element.value };
  }
  if (input.action === "click" || input.action === "hover") {
    const element = input.selector
      ? selected()
      : (document.elementFromPoint(input.x ?? -1, input.y ?? -1) as HTMLElement | null);
    if (!element)
      throw new Error(`${input.action} requires selector or coordinates within the viewport.`);
    // locate leaves scrolling alone, so an earlier measured point stays valid.
    if (mode !== "locate") element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("Target element is not visible.");
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    if (mode === "locate" && (x < 0 || y < 0 || x > innerWidth || y > innerHeight))
      throw new Error(
        "Drag target is outside the viewport after scrolling to the source. Scroll or resize so both are visible, or use toX and toY.",
      );
    if (mode === "measure" || mode === "locate") return { x, y };
    if (input.action === "hover") {
      for (const type of ["pointerover", "mouseover", "pointermove", "mousemove"])
        element.dispatchEvent(
          new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      for (const type of ["pointerenter", "mouseenter"])
        element.dispatchEvent(
          new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, {
            clientX: x,
            clientY: y,
          }),
        );
      return { ok: true, trusted: false };
    }
    element.click();
    return { ok: true, trusted: false };
  }
  if (input.action === "type") {
    if (input.text === undefined) throw new Error("type requires text.");
    const element = selected();
    element.scrollIntoView({ block: "center" });
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly)
        throw new Error("Target field is disabled or read-only.");
      if (mode === "focus") {
        element.select();
        return { ok: true };
      }
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, input.text);
    } else if (element.isContentEditable) {
      if (mode === "focus") {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return { ok: true };
      }
      element.textContent = input.text;
    } else throw new Error("type requires an input, textarea, or contenteditable element.");
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.text }),
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, trusted: false };
  }
  if (input.action === "press") {
    if (!input.key) throw new Error("press requires key.");
    const element = input.selector ? selected() : (document.activeElement as HTMLElement | null);
    if (!element) throw new Error("No element is focused.");
    element.focus();
    const modifiers = input.key.split("+");
    const key = modifiers.pop()!;
    const options = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers.includes("Control"),
      metaKey: modifiers.includes("Meta"),
      altKey: modifiers.includes("Alt"),
      shiftKey: modifiers.includes("Shift"),
    };
    const allowed = element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
    if (allowed && key === "Enter") {
      if (element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
      else if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement)
        element.click();
    }
    return { ok: true, trusted: false };
  }
  throw new Error(`Unsupported DOM action: ${input.action}`);
}

export function createPageController(api: BrowserApi, chromium: boolean) {
  const pending = new Map<number, Promise<unknown>>();
  async function inject(input: PageInput, mode?: "measure" | "locate" | "focus"): Promise<any> {
    const results = await api.scripting.executeScript({
      target: {
        tabId: input.tabId,
        ...(input.frameId === undefined ? {} : { frameIds: [input.frameId] }),
      },
      func: domAction,
      args: [input, mode ?? null],
    });
    const item = results.find(
      (result: any) => input.frameId === undefined || result.frameId === input.frameId,
    );
    if (!item) throw new Error("The requested frame is unavailable.");
    if (item.error) throw new Error(item.error.message ?? String(item.error));
    if (item.result === undefined)
      throw new Error(
        "Page action returned no result. The page may have navigated or rejected the script.",
      );
    return item.result;
  }
  // Center of the selected element (scrolled into view), or the given viewport coordinates.
  async function point(input: PageInput, scroll = true): Promise<{ x: number; y: number }> {
    if (input.selector) return inject({ ...input, action: "click" }, scroll ? "measure" : "locate");
    if (input.x === undefined || input.y === undefined)
      throw new Error(`${input.action} requires selector or both x and y.`);
    return { x: input.x, y: input.y };
  }
  async function wait(input: PageInput) {
    const started = Date.now(),
      deadline = started + input.timeoutMs;
    let lastError = "";
    for (;;) {
      try {
        const done =
          input.selector || input.text !== undefined
            ? (await inject(input)).found
            : (await api.tabs.get(input.tabId)).status === "complete";
        if (done) return { ok: true, elapsedMs: Date.now() - started };
        lastError = "";
      } catch (error) {
        // Navigation briefly detaches frames; keep polling until the deadline.
        lastError = error instanceof Error ? error.message : String(error);
        if (/No tab with id|Invalid tab ID/i.test(lastError)) throw error;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const target = input.selector
      ? `selector ${input.selector}`
      : input.text !== undefined
        ? `text ${JSON.stringify(input.text)}`
        : "the tab to finish loading";
    throw new Error(
      `Timed out after ${input.timeoutMs} ms waiting for ${input.gone ? "removal of " : ""}${target}.${lastError ? ` Last error: ${lastError}` : ""}`,
    );
  }
  async function evaluateInFirefox(input: PageInput) {
    if (!input.expression) throw new Error("evaluate requires expression.");
    if (input.frameId !== undefined && input.frameId !== 0)
      throw new Error("evaluate supports the main frame only. Omit frameId or use frameId: 0.");
    // window.eval runs in the page's own context, like Chromium's Runtime.evaluate.
    // Serializing there avoids cross-compartment wrappers around page objects.
    const pageCode = `(async () => { const value = await eval(${JSON.stringify(input.expression)}); const json = JSON.stringify(value === undefined ? null : value); return json === undefined ? "null" : json; })()`;
    try {
      const [json] = await api.tabs.executeScript(input.tabId, {
        code: `window.eval(${JSON.stringify(pageCode)}).then((json) => String(json))`,
      });
      if (typeof json !== "string") throw new Error("Evaluation returned no result.");
      return JSON.parse(json);
    } catch (error) {
      if (!/blocked by CSP/i.test(error instanceof Error ? error.message : String(error)))
        throw error;
    }
    // The page's CSP forbids eval: run in the isolated content-script context instead.
    // It shares the DOM but not page-defined globals.
    const [value] = await api.tabs.executeScript(input.tabId, { code: input.expression });
    return value ?? null;
  }
  async function debug(input: PageInput) {
    const target = { tabId: input.tabId };
    try {
      await api.debugger.attach(target, "1.3");
    } catch (error) {
      throw new Error(
        `Cannot attach to tab ${input.tabId}. Close DevTools and check the page supports debugging. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const send = async (method: string, params: Record<string, unknown> = {}) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          api.debugger.sendCommand(target, method, params),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `${method} timed out; debugger detached. The action may already have taken effect. Inspect the page before retrying.`,
                  ),
                ),
              20_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      if (input.action === "evaluate") {
        if (!input.expression) throw new Error("evaluate requires expression.");
        const result = await send("Runtime.evaluate", {
          expression: input.expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
          timeout: 15_000,
        });
        if (result.exceptionDetails)
          throw new Error(
            result.exceptionDetails.exception?.description ||
              result.exceptionDetails.text ||
              "Page evaluation failed.",
          );
        if (result.result?.subtype === "error") throw new Error(result.result.description);
        if (result.result?.unserializableValue !== undefined)
          return { value: result.result.unserializableValue, unserializable: true };
        if (result.result?.objectId && result.result?.value === undefined)
          throw new Error(
            "Evaluation result cannot be serialized. Return a JSON-compatible value.",
          );
        return result.result?.value ?? null;
      }
      if (input.action === "screenshot") {
        const result = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        return { dataUrl: `data:image/png;base64,${result.data}` };
      }
      if (input.action === "hover") {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await point(input)) });
        return { ok: true, trusted: true };
      }
      if (input.action === "drag") {
        const from = await point(input);
        const to = input.toSelector
          ? await point({ ...input, selector: input.toSelector }, false)
          : input.toX !== undefined && input.toY !== undefined
            ? { x: input.toX, y: input.toY }
            : undefined;
        if (!to) throw new Error("drag requires toSelector or both toX and toY.");
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...from,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        // Intermediate moves let drag libraries pass their movement thresholds.
        for (let step = 1; step <= 10; step++)
          await send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: from.x + ((to.x - from.x) * step) / 10,
            y: from.y + ((to.y - from.y) * step) / 10,
            button: "left",
            buttons: 1,
          });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...to,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        return { ok: true, trusted: true, from, to };
      }
      if (input.action === "upload") {
        if (!input.selector) throw new Error("upload requires selector.");
        if (!input.files?.length) throw new Error("upload requires files.");
        const found = await send("Runtime.evaluate", {
          expression: `(() => { const element = document.querySelector(${JSON.stringify(input.selector)}); return element instanceof HTMLInputElement && element.type === "file" ? element : element ? "not-file" : "missing"; })()`,
        });
        if (found.result?.value === "missing")
          throw new Error(`No element matches selector: ${input.selector}`);
        if (!found.result?.objectId)
          throw new Error("upload requires an <input type=file> element.");
        await send("DOM.setFileInputFiles", {
          files: input.files,
          objectId: found.result.objectId,
        });
        return { ok: true, files: input.files.length };
      }
      if (input.action === "click") {
        const target = await point(input);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...target,
          button: "left",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...target,
          button: "left",
          clickCount: 1,
        });
        return { ok: true, trusted: true };
      }
      if (input.action === "type") {
        await inject(input, "focus");
        if (input.text === "") {
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
        } else await send("Input.insertText", { text: input.text });
        return { ok: true, trusted: true };
      }
      if (input.action === "press") {
        if (!input.key) throw new Error("press requires key.");
        if (input.selector)
          await api.scripting
            .executeScript({
              target: { tabId: input.tabId },
              func: (selector: string) => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) throw new Error(`No element matches selector: ${selector}`);
                element.focus();
              },
              args: [input.selector],
            })
            .then((results: any[]) => {
              if (results[0]?.error || !results.length)
                throw new Error("Failed to focus target element.");
            });
        const parts = input.key.split("+");
        const key = parts.pop()!;
        const names: Record<string, [string, number]> = {
          Enter: ["Enter", 13],
          Tab: ["Tab", 9],
          Escape: ["Escape", 27],
          Backspace: ["Backspace", 8],
          Delete: ["Delete", 46],
          ArrowLeft: ["ArrowLeft", 37],
          ArrowUp: ["ArrowUp", 38],
          ArrowRight: ["ArrowRight", 39],
          ArrowDown: ["ArrowDown", 40],
          Home: ["Home", 36],
          End: ["End", 35],
          PageUp: ["PageUp", 33],
          PageDown: ["PageDown", 34],
          Space: ["Space", 32],
        };
        if (!names[key] && key.length !== 1)
          throw new Error(
            `Unsupported key: ${key}. Use Enter, Tab, Escape, arrow keys, or a single character; modifiers are Control, Alt, Shift, Meta.`,
          );
        if (parts.some((part) => !["Control", "Alt", "Shift", "Meta"].includes(part)))
          throw new Error("Unknown key modifier; use Control, Alt, Shift, or Meta.");
        const modifiers = parts.reduce(
          (value, part) => value | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[part] ?? 0),
          0,
        );
        const [code, keyCode] = names[key] ?? [
          /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /[0-9]/.test(key) ? `Digit${key}` : key,
          key.toUpperCase().charCodeAt(0),
        ];
        const shifted: Record<string, string> = {
          "`": "~",
          "1": "!",
          "2": "@",
          "3": "#",
          "4": "$",
          "5": "%",
          "6": "^",
          "7": "&",
          "8": "*",
          "9": "(",
          "0": ")",
          "-": "_",
          "=": "+",
          "[": "{",
          "]": "}",
          "\\": "|",
          ";": ":",
          "'": '"',
          ",": "<",
          ".": ">",
          "/": "?",
        };
        const character = modifiers & 8 ? (shifted[key] ?? key.toUpperCase()) : key;
        const params = {
          key: key === "Space" ? " " : key.length === 1 ? character : key,
          code,
          windowsVirtualKeyCode: keyCode,
          modifiers,
        };
        const text =
          !modifiers || modifiers === 8
            ? key === "Enter"
              ? "\r"
              : key === "Space"
                ? " "
                : key.length === 1
                  ? character
                  : undefined
            : undefined;
        await send("Input.dispatchKeyEvent", {
          type: text ? "keyDown" : "rawKeyDown",
          ...params,
          ...(text ? { text, unmodifiedText: text } : {}),
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
        return { ok: true, trusted: true };
      }
      throw new Error(`Unsupported debugger action: ${input.action}`);
    } finally {
      await api.debugger.detach(target).catch(() => {});
    }
  }
  return async (input: PageInput) => {
    if (input.action === "wait") return wait(input);
    if (
      chromium &&
      ["click", "type", "press", "evaluate", "screenshot", "hover", "drag", "upload"].includes(
        input.action,
      )
    ) {
      if (input.frameId !== undefined && input.frameId !== 0)
        throw new Error(
          "Trusted Chromium input, evaluate, upload, and screenshot support the main frame only. Omit frameId or use frameId: 0.",
        );
      // A debugger session is owned by exactly one request, including detach.
      const previous = pending.get(input.tabId) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => debug(input));
      pending.set(input.tabId, current);
      try {
        return await current;
      } finally {
        if (pending.get(input.tabId) === current) pending.delete(input.tabId);
      }
    }
    if (input.action === "evaluate") return evaluateInFirefox(input);
    if (input.action === "drag" || input.action === "upload")
      throw new Error(
        `${input.action} requires Chromium's debugger API and is unavailable in Firefox.`,
      );
    if (input.action === "screenshot") {
      if (input.frameId !== undefined && input.frameId !== 0)
        throw new Error("Screenshots capture the viewport, not individual frames.");
      const tab = await api.tabs.get(input.tabId);
      if (!tab.active)
        throw new Error(
          "Firefox screenshots require the target tab to be active. Use tabs.update(tabId, {active: true}) first.",
        );
      return { dataUrl: await api.tabs.captureVisibleTab(tab.windowId, { format: "png" }) };
    }
    if (
      (input.action === "click" || input.action === "hover") &&
      !input.selector &&
      (input.x === undefined || input.y === undefined)
    )
      throw new Error(`${input.action} requires selector or both x and y.`);
    return inject(input);
  };
}
