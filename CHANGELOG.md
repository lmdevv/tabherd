# Changelog

## Unreleased

- A Nix flake: `nix run github:lmdevv/tabherd`, `overlays.default`, and NixOS and Home Manager modules (`programs.tabherd`) that register the native host declaratively.
- `tabherd doctor` accepts native host manifests installed outside `tabherd setup`, such as by those modules or nixpkgs' Firefox wrapper, and names the manifest in each failure.
- `tabherd setup` warns when it registers a Nix store path.

## 0.1.0

The first published release of the `tabherd` npm package and extension zips.

### Setup and connection

- The Chromium extension has a fixed ID (`hepgdbeccdmbongocnnamapillglcbgk`) wherever it's loaded from, so `tabherd setup` needs no `--extension-id`.
- `tabherd setup` registers every installed browser. `--browser` and `--extension-id` are repeatable, and IDs allowed by earlier setups are kept.
- `tabherd doctor` checks Node.js, the installation, each browser registration and the live connection, with a fix for each problem.
- The popup shows the connected bridge version. A stopped extension worker reconnects on its own, and descriptors left by crashed hosts are cleaned up.
- Setup warns when it runs from the temporary npx cache.

### Page control

- New actions:
  - `wait` for a selector, page text, a URL, or page load.
  - `hover`.
  - `drag`, including native HTML5 drag-and-drop (Chromium).
  - `upload` local files (Chromium).
- `read` takes `maxElements` (up to 1000).
- Firefox supports `evaluate`. It runs in the page, or in an isolated context when the page's CSP forbids eval.
- Errors thrown inside pages now reach the agent on Chromium instead of appearing as an empty result.

### Events

- `browser_events` and `tabherd events` report tab, window, group, bookmark and download events.
- Results come with a cursor; `timeoutMs` long-polls for the next event. `dropped` and `reset` flag missed events.
- `tabherd events --follow` streams events as JSON lines.

### Safety

- Access modes in the extension popup:
  - **Full access**.
  - **Standard**: no cookies, page JavaScript, data clearing, or history and download deletion.
  - **Read only**.
- Agents can't change the mode, and capabilities report it.
- The popup lists recent agent operations.
- `SECURITY.md` describes the trust model and how to report vulnerabilities.

### Development

- `pnpm test:firefox` runs the Firefox build through the real native host. CI runs both real-browser tests on Linux and unit checks on Linux, macOS and Windows.
- Docs deploy to GitHub Pages.

## 0.0.1

Initial development version. It was never published.
