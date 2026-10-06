# Tabby

Your browser, connected to your agent. A thin extension and local native bridge expose browser APIs through five MCP tools and a JSON CLI. Organize tabs, move windows, save bookmarks, read pages, and interact with the browser you already use.

## Quick start

Requires Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm build
```

1. Load `apps/extension/dist/chrome-mv3` as an unpacked extension in Chrome, Chromium, Edge, or Brave. Copy its extension ID.
2. Register the host: `node packages/bridge/dist/index.js setup --browser chrome --extension-id YOUR_EXTENSION_ID`.
3. Reload the extension and check its popup connection.
4. Run `node packages/bridge/dist/index.js status`, then `node packages/bridge/dist/index.js call tabs.query '[{}]'`.

For Firefox, run `pnpm --filter extension build:firefox`, temporarily load `apps/extension/dist/firefox-mv2/manifest.json` from `about:debugging`, and register with `setup --browser firefox`.

Add the bridge to your agent’s stdio MCP configuration:

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

The browser starts the native host automatically. No account or separate server. Tabby grants local control of your real browser profile; use it with agents you trust. API availability varies by browser.

[Quick start](apps/docs/src/content/docs/quick-start.md) · [Tools and CLI](apps/docs/src/content/docs/tools.md) · [Agent skill](skills/tabby/SKILL.md)

Docs: `pnpm --filter docs dev`. Checks: `pnpm test` and `pnpm check-types`. Optional real browser test on Linux with Chromium: `pnpm test:browser`.
