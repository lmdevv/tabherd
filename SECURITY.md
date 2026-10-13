# Security

Tabherd gives local programs control of your real browser profile. This page explains what it trusts, what it protects, and how to report a problem.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/lmdevv/tabherd/security/advisories/new). Please don't open a public issue. Include the version (`tabherd --version`), browser and OS, and steps to reproduce. You'll get a reply within a week.

## Trust model

- **Agents you connect are trusted with your browser.** Tabherd doesn't try to tell a well-behaved agent from a malicious one. Choose an access mode in the extension popup to limit what any agent can do:
  - **Full access:** everything.
  - **Standard:** no cookies, page JavaScript, data clearing, or history and download deletion.
  - **Read only:** inspect only.
- **Page content is untrusted.** Page text can contain instructions written for agents (prompt injection). The MCP server tells agents to treat it as data. Prefer Read only or Standard when an agent browses sites you don't control.
- **Other users on the same computer are not trusted.**
  - The state directory (`~/.tabherd`) and the socket directory are private to your user (mode `0700`). Tabherd refuses a socket directory that is a link or owned by someone else.
  - Every local request must carry a random bearer token that only your user can read. On Windows, the token is what protects the named pipe.
- **Websites cannot reach the bridge.** It listens on a Unix socket or named pipe, never on a TCP port, and only the Tabherd extension may launch the native host. The browser enforces this through the manifest's `allowed_origins` or `allowed_extensions`.

## Behavior that protects you

- Mutations are never retried automatically. After a timeout or disconnect, the agent is told to check browser state first.
- Only allowlisted browser API methods are exposed. Events, callbacks and arbitrary extension APIs are not.
- The access mode is stored by the extension, and agents have no API to change it.
- The popup lists recent agent operations. It never records typed text or results.
- Results larger than the native messaging limit are refused, not truncated silently.

## Supported versions

Security fixes go into the latest release. Update both the npm package (`npm install -g tabherd`) and the extension.
