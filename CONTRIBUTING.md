# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

Requires Node.js 22.18+ and pnpm.

```sh
pnpm install
pnpm build
```

Load `apps/extension/dist/chrome-mv3` as an unpacked extension and run `node packages/bridge/dist/index.js setup`. The manifest key pins the extension ID, so no ID is needed.

## Layout

| Path                | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `packages/protocol` | Shared schemas and constants (source only, bundled into the CLI). |
| `packages/bridge`   | The `tabherd` npm package: CLI, MCP server, native host.          |
| `apps/extension`    | The WXT browser extension for Chromium browsers and Firefox.      |
| `apps/docs`         | The Astro Starlight docs site.                                    |
| `skills/tabherd`    | An agent skill describing common workflows.                       |

## Checks

Run these before opening a pull request. CI runs them on Linux, macOS and Windows:

```sh
pnpm exec oxfmt --check
pnpm exec oxlint
pnpm check-types
pnpm test
```

Real-browser tests on Linux:

- `pnpm test:browser` runs the Chromium build in a disposable headless Chromium profile. Set `TABHERD_CHROMIUM` to choose a binary; branded Chrome ignores `--load-extension`.
- `pnpm test:firefox` runs the Firefox build as a temporary add-on through web-ext. Set `TABHERD_FIREFOX` to choose a binary.

Add tests with each change. Bridge tests use Node's test runner through tsx. Extension tests import the library modules with mocked browser APIs. Behavior that only a real browser shows belongs in the smoke tests.

## Releases

1. Bump `version` in `packages/bridge/package.json` and `apps/extension/package.json`.
2. Update `CHANGELOG.md`.
3. Publish a GitHub release tagged `vVERSION`. The release workflow tests, attaches the extension zips, and publishes the npm package.
