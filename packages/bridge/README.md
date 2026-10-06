# tabherd

Your browser, connected to your agent. This package is the local MCP server, CLI, and native-messaging host for the [Tabherd](https://github.com/lmdevv/tabherd) browser extension.

```sh
npm install -g tabherd
```

1. Install the Tabherd extension from the [latest release](https://github.com/lmdevv/tabherd/releases/latest) and copy its extension ID.
2. `tabherd setup --browser chrome --extension-id YOUR_EXTENSION_ID` (or `--browser chromium|edge|brave|firefox`).
3. Reload the extension, then run `tabherd status`.

Add it to your agent as a stdio MCP server:

```json
{ "mcpServers": { "tabherd": { "command": "tabherd", "args": ["mcp"] } } }
```

Tabherd grants local control of your real browser profile; use it with agents you trust. See the [repository](https://github.com/lmdevv/tabherd) for tools, CLI usage, and the agent skill.

MIT License.
