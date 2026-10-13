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

**Chrome, Chromium, Edge, or Brave:** open the browser’s extensions page, enable **Developer mode**, choose **Load unpacked**, and select the unzipped `tabherd-VERSION-chrome` folder.

**Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` from the unzipped `tabherd-VERSION-firefox` folder. Temporary add-ons must be loaded again after restarting Firefox.

Tabherd requests broad browser permissions so your agent can operate tabs, pages, bookmarks, and other browser data. Connect it only to agents you trust, and choose how much it may do in the popup’s **Agent access** setting:

| Mode            | Agents can                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full access** | Use every browser API and page action (the default).                                                                                                |
| **Standard**    | Do everything except read or change cookies, run JavaScript in pages (`evaluate`), clear browsing data, delete history, or delete downloaded files. |
| **Read only**   | Inspect tabs, windows, groups, bookmarks, history, and pages (read, wait, screenshot); change nothing.                                              |

Agents can’t change the mode; blocked calls return an error that asks them to check with you. The popup also lists the agent’s recent actions.

## 3. Register the local bridge

```sh
tabherd setup
```

Setup registers every supported browser it finds: Chrome, Chromium, Edge, Brave, and Firefox. Choose one with `--browser chrome`. The extension has the same ID wherever it’s loaded, so you don’t need to copy it.

Reload the extension, open its popup, and connect if needed. The browser starts the native host; no background server command is required. Run `setup` again after upgrading Node.js or moving your global npm packages.

Check the connection:

```sh
tabherd doctor
tabherd call tabs.query '[{}]'
```

`doctor` checks the installation, each browser registration, and the live connection, and says how to fix anything that fails.

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

Restart your agent and ask: **“List my tabs, then suggest how to organize them.”** Use [the CLI](../tools/#cli) directly if your agent doesn’t support MCP. An optional [agent skill](https://github.com/lmdevv/tabherd/blob/main/skills/tabherd/SKILL.md) teaches agents common workflows.

To build from source instead, see the [repository README](https://github.com/lmdevv/tabherd#from-source).

## If it isn’t connected

Run `tabherd doctor` and follow the fix for each failed check. Check that the extension is loaded and its popup shows **Bridge connected**. If you built the extension yourself with a different ID, run `tabherd setup --extension-id YOUR_ID`. With several browser profiles, use the connection ID from `status` or `browser_connections`.

Remove all Tabherd native host registrations with `tabherd uninstall`, then remove the extension from your browser.
