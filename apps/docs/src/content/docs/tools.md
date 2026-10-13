---
title: Tools & commands
description: Six MCP tools, a JSON CLI, and the browser APIs behind them.
---

Use `browser_connections` first, then `browser_capabilities` to discover what the connected browser supports. Supply `connectionId` when more than one profile is connected.

## MCP

| Tool                   | Input                                             | Purpose                                         |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `browser_connections`  | None                                              | List connected browser profiles.                |
| `browser_capabilities` | `connectionId?`                                   | List available API methods and page actions.    |
| `browser_call`         | `method`, `args`, `connectionId?`                 | Call one browser API.                           |
| `browser_batch`        | `calls`, `continueOnError?`, `connectionId?`      | Run up to 100 API calls in order.               |
| `browser_page`         | `tabId`, `action`, action fields, `connectionId?` | Read or interact with a page.                   |
| `browser_events`       | `cursor?`, `types?`, `timeoutMs?`, `limit?`       | Read or wait for tab, window, and other events. |

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

## Events

`browser_events` returns recent browser events and a `cursor`. Pass the cursor back to get only newer events, and set `timeoutMs` (up to 45 seconds) to wait for the next one instead of polling. `types` filters by prefix:

```json
{ "cursor": "3f2a9c1d:41", "types": ["tab.updated"], "timeoutMs": 15000 }
```

| Prefix      | Events                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `tab.`      | `created`, `updated` (status, URL, title, pin, group), `removed`, `activated`, `moved`, `attached` |
| `window.`   | `created`, `removed`, `focused`                                                                    |
| `group.`    | `created`, `updated`, `removed`                                                                    |
| `bookmark.` | `created`, `changed`, `moved`, `removed`                                                           |
| `download.` | `created`, `changed`                                                                               |

The extension keeps the last 500 events in memory. `dropped: true` means older events were evicted, and `reset: true` means the extension restarted; re-read state with `browser_call` in either case.

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

| `action`     | Additional fields                                     | Result                                                                                                               |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `read`       | `maxTextLength?`, `maxElements?`, `frameId?`          | Page text, links, and interactive elements (200 of each by default).                                                 |
| `wait`       | `selector?` or `text?`, `gone?`, `url?`, `timeoutMs?` | Wait for a visible element or text to appear (or disappear), or for the tab to finish loading when neither is given. |
| `click`      | `selector` or `x`, `y`                                | Click an element or coordinates.                                                                                     |
| `hover`      | `selector` or `x`, `y`                                | Move the pointer over an element.                                                                                    |
| `drag`       | `selector` or `x`, `y`; `toSelector` or `toX`, `toY`  | Drag with the mouse from one point to another (Chromium).                                                            |
| `type`       | `selector`, `text`                                    | Replace a field’s contents.                                                                                          |
| `select`     | `selector`, `value`                                   | Select an option.                                                                                                    |
| `scroll`     | `x?`, `y?`, `selector?`                               | Scroll the page or an element.                                                                                       |
| `press`      | `key`, `selector?`                                    | Press a key, including modifiers such as `Control+A`.                                                                |
| `upload`     | `selector`, `files`                                   | Attach local files to an `<input type=file>` (Chromium).                                                             |
| `evaluate`   | `expression`                                          | Evaluate JavaScript in the page and return a JSON value.                                                             |
| `screenshot` | None                                                  | Capture the page.                                                                                                    |

`timeoutMs` defaults to 10 seconds and may be up to 45. After `tabs.update` or a click that navigates, wait for something only the next page has: pass `url` (part of the new address), or a `selector` or `text` from the new page. Right after a click, the old page can still report that it has loaded. Relative `files` paths are resolved from the CLI or MCP server’s working directory.

Chromium uses its debugger API for trusted input, uploads, and JavaScript evaluation. Firefox uses DOM events, which some sites ignore; `drag` and `upload` are unavailable, screenshots capture the visible tab, and `evaluate` falls back to an isolated context (DOM only, no page globals) on pages whose CSP forbids `eval`. Browser-internal pages, extension stores, and other protected pages may block page access. Check capabilities for exact support.

## CLI

Install with `npm install -g tabherd`. JSON results go to stdout; errors produce a nonzero exit code.

```sh
tabherd status
tabherd capabilities
tabherd call tabs.query '[{}]'
tabherd page 42 '{"action":"read"}'
tabherd batch '[{"method":"tabs.query","args":[{}]}]'
tabherd events --follow --type tab.
```

| Command                   | Usage                                                                            |
| ------------------------- | -------------------------------------------------------------------------------- |
| `status`                  | List live connections.                                                           |
| `capabilities`            | Inspect supported methods and actions.                                           |
| `call METHOD JSON_ARGS`   | Call a browser API with a JSON argument array.                                   |
| `page TAB_ID JSON_OBJECT` | Run a page action.                                                               |
| `batch JSON_CALLS`        | Run a JSON array of API calls; add `--continue-on-error` to keep going.          |
| `events`                  | Print events; add `--cursor`, `--type`, `--wait MS`, `--limit`, or `--follow`.   |
| `mcp`                     | Start the stdio MCP server.                                                      |
| `setup`                   | Register the native host for installed browsers; add `--browser NAME` to choose. |
| `doctor`                  | Check the installation and connection, with a fix for each problem.              |
| `uninstall`               | Remove all Tabherd native host registrations.                                    |

`events --follow` streams new events as JSON lines until interrupted. Add `--connection ID` to `capabilities`, `call`, `page`, `batch`, or `events` to choose a profile. Run `--help` for command options.
