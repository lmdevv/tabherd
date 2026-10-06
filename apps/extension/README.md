# Tabherd extension

Build with `pnpm --filter extension build`, then load `dist/chrome-mv3` through
Chrome's **Load unpacked**. Firefox: `pnpm --filter extension build:firefox`, then
load `dist/firefox-mv2/manifest.json` as a temporary add-on.

Install the local native host with the CLI's `setup` command. The popup shows the
extension ID to use during setup, its profile ID, and connection status.
Reload the extension after rebuilding. The bridge reconnects automatically;
the popup also has a reconnect button.

The bridge exposes the browser APIs supported by your browser. Chromium page
control uses brief debugger sessions; Firefox uses DOM actions and visible-tab
screenshots. Browser internal pages cannot be scripted.

Toolbar icons adapt to light and dark themes. Chrome uses an offscreen media
query; Firefox uses native theme icons. Run `pnpm --filter extension test` and
`pnpm --filter extension check-types` to verify changes.
