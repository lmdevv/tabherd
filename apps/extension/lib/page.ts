import type { PageInput } from "@tabherd/protocol";
import type { BrowserApi } from "./engine.ts";

// This function is serialized by scripting.executeScript: keep it self-contained.
export function domAction(input: PageInput, mode?: "measure" | "focus") {
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
      links: links.slice(0, 200).map((element) => ({
        text: (element.innerText || element.getAttribute("aria-label") || "").slice(0, 300),
        url: element.href,
        selector: selectorFor(element),
      })),
      linksTruncated: links.length > 200,
      elements: elements.slice(0, 200).map((element) => ({
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
      elementsTruncated: elements.length > 200,
    };
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
  if (input.action === "click") {
    const element = input.selector
      ? selected()
      : (document.elementFromPoint(input.x ?? -1, input.y ?? -1) as HTMLElement | null);
    if (!element) throw new Error("click requires selector or coordinates within the viewport.");
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("Target element is not visible.");
    if (mode === "measure") return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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
  async function inject(input: PageInput, mode?: "measure" | "focus") {
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
      if (input.action === "click") {
        if (!input.selector && (input.x === undefined || input.y === undefined))
          throw new Error("click requires selector or both x and y.");
        const point = input.selector ? await inject(input, "measure") : { x: input.x, y: input.y };
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...point,
          button: "left",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...point,
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
    if (chromium && ["click", "type", "press", "evaluate", "screenshot"].includes(input.action)) {
      if (input.frameId !== undefined && input.frameId !== 0)
        throw new Error(
          "Trusted Chromium input, evaluate, and screenshot support the main frame only. Omit frameId or use frameId: 0.",
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
    if (input.action === "evaluate")
      throw new Error(
        "evaluate requires Chromium's debugger API; Firefox supports DOM page actions only.",
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
      input.action === "click" &&
      !input.selector &&
      (input.x === undefined || input.y === undefined)
    )
      throw new Error("click requires selector or both x and y.");
    return inject(input);
  };
}
