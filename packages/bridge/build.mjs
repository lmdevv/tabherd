import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chmod } from "node:fs/promises";
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  // The shared workspace is source-only; bundle it so Node never loads TypeScript.
  external: ["@modelcontextprotocol/sdk/*", "zod"],
  plugins: [
    {
      name: "protocol",
      setup(b) {
        b.onResolve({ filter: /^@tabherd\/protocol$/ }, () => ({
          path: fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
        }));
      },
    },
  ],
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
});
await chmod("dist/index.js", 0o755);
