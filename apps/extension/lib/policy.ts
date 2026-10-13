// Access modes are chosen in the popup and stored by the extension. Agents can't change
// them: storage is not an exposed API.
export const ACCESS_MODES = ["full", "standard", "read-only"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];
export const ACCESS_STORAGE_KEY = "tabherdAccess";
export const ACCESS_LABELS: Record<AccessMode, string> = {
  full: "Full access",
  standard: "Standard",
  "read-only": "Read only",
};

const READ_METHODS = new Set([
  "tabs.query",
  "tabs.get",
  "tabs.getCurrent",
  "tabs.getZoom",
  "tabs.getZoomSettings",
  "tabs.captureVisibleTab",
  "tabs.detectLanguage",
  "windows.get",
  "windows.getCurrent",
  "windows.getLastFocused",
  "windows.getAll",
  "tabGroups.get",
  "tabGroups.query",
  "bookmarks.get",
  "bookmarks.getChildren",
  "bookmarks.getRecent",
  "bookmarks.getTree",
  "bookmarks.getSubTree",
  "bookmarks.search",
  "history.search",
  "history.getVisits",
  "sessions.getRecentlyClosed",
  "sessions.getDevices",
  "downloads.search",
  "downloads.getFileIcon",
  "browsingData.settings",
]);
const READ_PAGE_ACTIONS = new Set(["read", "wait", "screenshot"]);
// Session credentials and irreversible deletion of the user's data.
const sensitive = (method: string) =>
  method.startsWith("cookies.") ||
  (method.startsWith("browsingData.") && method !== "browsingData.settings") ||
  [
    "history.deleteUrl",
    "history.deleteRange",
    "history.deleteAll",
    "downloads.removeFile",
  ].includes(method);

export const isAccessMode = (value: unknown): value is AccessMode =>
  (ACCESS_MODES as readonly unknown[]).includes(value);

export function allowsMethod(mode: AccessMode, method: string) {
  if (mode === "read-only") return READ_METHODS.has(method);
  if (mode === "standard") return !sensitive(method);
  return true;
}
export function allowsPageAction(mode: AccessMode, action: string) {
  return mode !== "read-only" || READ_PAGE_ACTIONS.has(action);
}
export function blockedError(mode: AccessMode, operation: string) {
  return new Error(
    `${operation} is blocked: the user set Tabherd to ${ACCESS_LABELS[mode]} in the extension popup. Ask the user to change the access mode if this is needed; it cannot be changed through Tabherd.`,
  );
}
