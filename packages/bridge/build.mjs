import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chmod } from "node:fs/promises";
// Packagers without an npm install step (Nix) bundle the runtime dependencies as well.
const standalone = process.env.TABHERD_STANDALONE === "1";
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  ...(standalone ? {} : { packages: "external", external: ["@modelcontextprotocol/sdk/*", "zod"] }),
  // The shared workspace is source-only; bundle it so Node never loads TypeScript.
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
  banner: {
    js: standalone
      ? // Bundled CommonJS dependencies call require; ESM output has none.
        "#!/usr/bin/env node\nimport { createRequire as __tabherdRequire } from 'node:module';\nconst require = __tabherdRequire(import.meta.url);"
      : "#!/usr/bin/env node",
  },
  sourcemap: true,
});
await chmod("dist/index.js", 0o755);
