---
title: Tools & commands
description: Five MCP tools, a JSON CLI, and the browser APIs behind them.
---

Use `browser_connections` first, then `browser_capabilities` to discover what the connected browser supports. Supply `connectionId` when more than one profile is connected.

## MCP

| Tool                   | Input                                             | Purpose                                      |
| ---------------------- | ------------------------------------------------- | -------------------------------------------- |
| `browser_connections`  | None                                              | List connected browser profiles.             |
| `browser_capabilities` | `connectionId?`                                   | List available API methods and page actions. |
| `browser_call`         | `method`, `args`, `connectionId?`                 | Call one browser API.                        |
| `browser_batch`        | `calls`, `continueOnError?`, `connectionId?`      | Run up to 100 API calls in order.            |
| `browser_page`         | `tabId`, `action`, action fields, `connectionId?` | Read or interact with a page.                |

`args` is an array of positional arguments. To list tabs:

```json
{ "method": "tabs.query", "args": [{}] }
```

To save a bookmark:

```json
{
  "method": "bookmarks.create",
  "args": [{ "title": "Project notes", "url": "https://example.com" }]
}
```

A batch contains calls in the same format. It stops on the first error unless `continueOnError` is true. It is not a transaction: completed calls remain applied. After a timeout, inspect the browser before retrying a mutation.

## Browser APIs

Tabherd exposes JSON-compatible browser methods; events and APIs that require callback functions aren’t proxied. Availability depends on the browser, version, and permissions. The capabilities response is the authoritative list.

| API            | What you can do                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `tabs`         | Query, create, activate, close, move, duplicate, reload, discard, group, zoom, and capture tabs. |
| `windows`      | Inspect, create, focus, resize, and close windows.                                               |
| `tabGroups`    | Read, name, color, collapse, and move groups where supported.                                    |
| `bookmarks`    | Search, read, create, edit, move, and remove bookmarks and folders.                              |
| `history`      | Search visits, add URLs, and remove history.                                                     |
| `sessions`     | Find recently closed tabs and restore sessions.                                                  |
| `downloads`    | Start, inspect, pause, resume, cancel, reveal, and remove downloads.                             |
| `cookies`      | Read, set, and remove cookies.                                                                   |
| `browsingData` | Inspect settings and clear selected categories of browser data.                                  |
| `search`       | Search using the browser’s search provider.                                                      |

For example, `tabs.move` uses `args: [tabId, {"windowId": windowId, "index": -1}]`; `tabs.remove` uses `args: [[tabId1, tabId2]]`. Browser method arguments retain their native API shape.

## Page actions

All page calls require `tabId` and `action`. Use selectors returned by `read` where possible.

| `action`     | Additional fields            | Result                                                |
| ------------ | ---------------------------- | ----------------------------------------------------- |
| `read`       | `maxTextLength?`, `frameId?` | Page text, links, and interactive elements.           |
| `click`      | `selector` or `x`, `y`       | Click an element or coordinates.                      |
| `type`       | `selector`, `text`           | Replace a field’s contents.                           |
| `select`     | `selector`, `value`          | Select an option.                                     |
| `scroll`     | `x?`, `y?`, `selector?`      | Scroll the page or an element.                        |
| `press`      | `key`, `selector?`           | Press a key, including modifiers such as `Control+A`. |
| `evaluate`   | `expression`                 | Evaluate JavaScript in Chromium.                      |
| `screenshot` | None                         | Capture the page.                                     |

Chromium uses its debugger API for trusted input and JavaScript evaluation. Firefox uses DOM interactions; `evaluate` is unavailable and screenshots capture the visible tab. Browser-internal pages, extension stores, and other protected pages may block page access. Check capabilities for exact support.

## CLI

Install with `npm install -g tabherd`. JSON results go to stdout; errors produce a nonzero exit code.

```sh
tabherd status
tabherd capabilities
tabherd call tabs.query '[{}]'
tabherd page 42 '{"action":"read"}'
tabherd batch '[{"method":"tabs.query","args":[{}]}]'
```

| Command                   | Usage                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| `status`                  | List live connections.                                                        |
| `capabilities`            | Inspect supported methods and actions.                                        |
| `call METHOD JSON_ARGS`   | Call a browser API with a JSON argument array.                                |
| `page TAB_ID JSON_OBJECT` | Run a page action.                                                            |
| `batch JSON_CALLS`        | Run a JSON array of API calls; add `--continue-on-error` to keep going.       |
| `mcp`                     | Start the stdio MCP server.                                                   |
| `setup --browser NAME`    | Register the native host; Chromium browsers also require `--extension-id ID`. |
| `uninstall`               | Remove all Tabherd native host registrations.                                 |

Add `--connection ID` to `capabilities`, `call`, `page`, or `batch` to choose a profile. Run `--help` for command options.
