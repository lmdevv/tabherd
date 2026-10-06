import {
  HOST_NAME,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  WireRequest,
  errorMessage,
} from "@tabherd/protocol";
import { createEngine, type BrowserApi } from "./engine.ts";

export const RETRY_ALARM = "tabherd-native-reconnect";

export function createBridge(api: BrowserApi, chromium: boolean) {
  const engine = createEngine(api, chromium);
  let port: any;
  let connecting: Promise<void> | undefined;
  const status = {
    connected: false,
    error: "",
    connectionId: "",
    extensionId: api.runtime.id,
    browser: chromium ? "chrome" : "firefox",
  };
  const response = (id: string, result?: unknown, error?: string) => {
    let message =
      error === undefined ? { type: "response", id, result } : { type: "response", id, error };
    try {
      if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES) {
        message = {
          type: "response",
          id,
          error:
            "Result exceeds the native message limit. Narrow your query, reduce maxTextLength, or use a smaller screenshot viewport.",
        };
      }
    } catch {
      message = {
        type: "response",
        id,
        error: "The browser returned a value that cannot be serialized as JSON.",
      };
    }
    return message;
  };
  async function receive(source: any, value: unknown) {
    const parsed = WireRequest.safeParse(value);
    if (!parsed.success) {
      if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
        try {
          source.postMessage(
            response(value.id, undefined, `Invalid bridge request: ${parsed.error.message}`),
          );
        } catch {}
      }
      return;
    }
    const request = parsed.data;
    try {
      const result = await engine.dispatch(request.method, request.input);
      // Reply only on the original port. Never retry an action after disconnect.
      source.postMessage(response(request.id, result));
    } catch (error) {
      try {
        source.postMessage(response(request.id, undefined, errorMessage(error)));
      } catch {}
    }
  }
  async function connect() {
    if (port || connecting) return connecting;
    connecting = (async () => {
      try {
        const stored = await api.storage.local.get("tabherdProfileId");
        const profileId = stored.tabherdProfileId ?? crypto.randomUUID();
        if (!stored.tabherdProfileId) await api.storage.local.set({ tabherdProfileId: profileId });
        status.connectionId = `${profileId}${api.extension?.inIncognitoContext ? ":private" : ""}`;
        status.error = "";
        const native = api.runtime.connectNative(HOST_NAME);
        port = native;
        native.onMessage.addListener((value: unknown) => {
          void receive(native, value);
        });
        native.onDisconnect.addListener(() => {
          const error =
            api.runtime.lastError?.message ||
            native.error?.message ||
            "The native bridge disconnected.";
          if (port !== native) return;
          port = undefined;
          status.connected = false;
          status.error = error;
          void api.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
        });
        native.postMessage({
          type: "hello",
          version: PROTOCOL_VERSION,
          connectionId: status.connectionId,
          browser: status.browser,
          extensionId: api.runtime.id,
          privateContext: Boolean(api.extension?.inIncognitoContext),
        });
        status.connected = true;
        await api.alarms.clear(RETRY_ALARM);
      } catch (error) {
        status.connected = false;
        status.error = errorMessage(error);
        const failed = port;
        port = undefined;
        try {
          failed?.disconnect();
        } catch {}
        await api.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
      }
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }
  return {
    connect,
    getStatus: () => ({ ...status }),
    async reconnect() {
      // Finish initialization before disconnecting to avoid overlapping ports.
      await connecting;
      const previous = port;
      port = undefined;
      status.connected = false;
      try {
        previous?.disconnect();
      } catch {}
      await connect();
      return { ...status };
    },
  };
}
