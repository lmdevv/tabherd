---
title: Quick start
description: Build Tabby, connect your browser, and add it to your agent.
---

Tabby runs on your computer and connects to your existing browser profile. You’ll need Node.js 22 or newer and pnpm.

## 1. Build

From the repository root:

```sh
pnpm install
pnpm build
```

## 2. Load the extension

**Chrome, Chromium, Edge, or Brave:** open the browser’s extensions page, enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist/chrome-mv3`. Copy Tabby’s extension ID.

**Firefox:** run `pnpm --filter extension build:firefox`. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `apps/extension/dist/firefox-mv2/manifest.json`. Temporary add-ons must be loaded again after restarting Firefox.

Tabby requests broad browser permissions so your agent can operate tabs, pages, bookmarks, and other browser data. Connect it only to agents you trust.

## 3. Register the local bridge

```sh
node packages/bridge/dist/index.js setup --browser chrome --extension-id YOUR_EXTENSION_ID
```

Use `chromium`, `edge`, or `brave` for those browsers. Firefox uses a fixed extension ID:

```sh
node packages/bridge/dist/index.js setup --browser firefox
```

Reload the extension, open its popup, and connect if needed. The browser starts the native host; no background server command is required. Keep the repository in place after setup, or register again if you move it.

Check the connection:

```sh
node packages/bridge/dist/index.js status
node packages/bridge/dist/index.js call tabs.query '[{}]'
```

## 4. Add MCP to your agent

Add this stdio server to your agent’s MCP configuration. Replace the path with the absolute path to your checkout:

```json
{
  "mcpServers": {
    "tabby": {
      "command": "node",
      "args": ["/absolute/path/to/tabby/packages/bridge/dist/index.js", "mcp"]
    }
  }
}
```

Restart your agent and ask: **“List my tabs, then suggest how to organize them.”** Use [the CLI](/tools/#cli) directly if your agent doesn’t support MCP. An optional agent skill lives at `skills/tabby/SKILL.md`.

## If it isn’t connected

Check that the extension is loaded, the popup is connected, and `setup` used the correct browser and extension ID. With several browser profiles, use the connection ID from `status` or `browser_connections`.

Remove all Tabby native host registrations with `node packages/bridge/dist/index.js uninstall`, then remove the extension from your browser.
