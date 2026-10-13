# Tabherd

Your browser, connected to your agent. A thin extension and local native bridge expose browser APIs through six MCP tools and a JSON CLI. Organize tabs, move windows, save bookmarks, read pages, and interact with the browser you already use.

## Quick start

Requires Node.js 22.18 or newer.

```sh
npm install -g tabherd
```

1. Download `tabherd-VERSION-chrome.zip` from the [latest release](https://github.com/lmdevv/tabherd/releases/latest) and unzip it. Load the folder as an unpacked extension in Chrome, Chromium, Edge, or Brave (Developer mode → **Load unpacked**).
2. Register the host for every installed browser: `tabherd setup`.
3. Reload the extension and check its popup connection.
4. Run `tabherd doctor`, then `tabherd call tabs.query '[{}]'`.

For Firefox, download `tabherd-VERSION-firefox.zip` and temporarily load its `manifest.json` from `about:debugging`.

On Nix, `nix run github:lmdevv/tabherd -- --help` runs the CLI. The NixOS and Home Manager modules (`programs.tabherd.enable = true`) register the browsers declaratively, so you skip `tabherd setup`. See [Nix and NixOS](apps/docs/src/content/docs/nix.md).

Add the bridge to your agent’s stdio MCP configuration:

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

The browser starts the native host automatically. No account or separate server. Tabherd grants local control of your real browser profile; use it with agents you trust, and pick **Full access**, **Standard** (no cookies, page JavaScript, or data deletion) or **Read only** in the extension popup. API availability varies by browser.

[Quick start](apps/docs/src/content/docs/quick-start.md) · [Nix and NixOS](apps/docs/src/content/docs/nix.md) · [Tools and CLI](apps/docs/src/content/docs/tools.md) · [Agent skill](skills/tabherd/SKILL.md)

## From source

Requires pnpm.

```sh
pnpm install
pnpm build
```

Load `apps/extension/dist/chrome-mv3` as an unpacked extension, then use `node packages/bridge/dist/index.js` in place of `tabherd`. Firefox: `pnpm build:firefox`, then load `apps/extension/dist/firefox-mv2/manifest.json`.

Docs: `pnpm --filter docs dev`. Checks: `pnpm test` and `pnpm check-types`. Optional real browser test on Linux with Chromium: `pnpm test:browser`.

## License

[MIT](LICENSE)
