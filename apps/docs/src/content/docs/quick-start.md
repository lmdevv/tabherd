---
title: Quick start
description: Install Tabherd, connect your browser, and add it to your agent.
---

Tabherd runs on your computer and connects to your existing browser profile. You’ll need Node.js 22.18 or newer.

## 1. Install

```sh
npm install -g tabherd
```

Download the extension zip for your browser from the [latest release](https://github.com/lmdevv/tabherd/releases/latest) and unzip it.

## 2. Load the extension

**Chrome, Chromium, Edge, or Brave:** open the browser’s extensions page, enable **Developer mode**, choose **Load unpacked**, and select the unzipped `tabherd-VERSION-chrome` folder. Copy Tabherd’s extension ID.

**Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` from the unzipped `tabherd-VERSION-firefox` folder. Temporary add-ons must be loaded again after restarting Firefox.

Tabherd requests broad browser permissions so your agent can operate tabs, pages, bookmarks, and other browser data. Connect it only to agents you trust.

## 3. Register the local bridge

```sh
tabherd setup --browser chrome --extension-id YOUR_EXTENSION_ID
```

Use `chromium`, `edge`, or `brave` for those browsers. Firefox uses a fixed extension ID:

```sh
tabherd setup --browser firefox
```

Reload the extension, open its popup, and connect if needed. The browser starts the native host; no background server command is required. Run `setup` again after upgrading Node.js or moving your global npm packages.

Check the connection:

```sh
tabherd status
tabherd call tabs.query '[{}]'
```

## 4. Add MCP to your agent

Add this stdio server to your agent’s MCP configuration:

```json
{
  "mcpServers": {
    "tabherd": {
      "command": "tabherd",
      "args": ["mcp"]
    }
  }
}
```

Restart your agent and ask: **“List my tabs, then suggest how to organize them.”** Use [the CLI](/tools/#cli) directly if your agent doesn’t support MCP. An optional [agent skill](https://github.com/lmdevv/tabherd/blob/main/skills/tabherd/SKILL.md) teaches agents common workflows.

To build from source instead, see the [repository README](https://github.com/lmdevv/tabherd#from-source).

## If it isn’t connected

Check that the extension is loaded, the popup is connected, and `setup` used the correct browser and extension ID. With several browser profiles, use the connection ID from `status` or `browser_connections`.

Remove all Tabherd native host registrations with `tabherd uninstall`, then remove the extension from your browser.
