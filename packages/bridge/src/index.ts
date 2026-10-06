import { parseArgs } from "node:util";
import { errorMessage } from "@tabby/protocol";
import { connections, dispatch } from "./client";
import { nativeHost } from "./native-host";
import { install, uninstall, type BrowserName } from "./install";
import { mcp } from "./mcp";
import packageJson from "../package.json" with { type: "json" };

const help = `Tabby — your browser, connected to your agent.

  tabby setup --browser chrome --extension-id ID
  tabby setup --browser firefox
  tabby status
  tabby capabilities [--connection ID]
  tabby call METHOD '[ARG,...]' [--connection ID]
  tabby batch '[{"method":"tabs.query","args":[{}]}]' [--continue-on-error]
  tabby page TAB_ID '{"action":"read"}' [--connection ID]
  tabby mcp
  tabby uninstall
  tabby --version

Browsers: chrome, chromium, edge, brave, firefox.
Use --manifest-dir DIR for a custom browser native-host manifest location.
Calls and batches take positional JSON arguments. Changes are immediate.
`;
async function main() {
  const command = process.argv[2] ?? "help";
  // Browsers append origin/parent-window arguments to native-host launches.
  if (command === "native-host") return nativeHost();
  if (["version", "--version", "-v"].includes(command)) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (command === "mcp") {
    if (process.argv.length !== 3) throw new Error("mcp does not accept arguments");
    return mcp();
  }
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
      browser: { type: "string" },
      "extension-id": { type: "string" },
      "manifest-dir": { type: "string" },
      connection: { type: "string" },
      "continue-on-error": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (["help", "--help", "-h"].includes(command) || values.help) {
    process.stdout.write(help);
    return;
  }
  const expect = (n: number) => {
    if (positionals.length !== n)
      throw new Error(`Expected ${n} positional arguments for ${command}. Run tabby help.`);
  };
  const allowedOptions: Record<string, string[]> = {
    setup: ["browser", "extension-id", "manifest-dir"],
    uninstall: [],
    status: [],
    capabilities: ["connection"],
    call: ["connection"],
    batch: ["connection", "continue-on-error"],
    page: ["connection"],
  };
  for (const option of Object.keys(values)) {
    if (!allowedOptions[command]?.includes(option))
      throw new Error(`--${option} is not an option for ${command}. Run tabby help.`);
  }
  const selected = values.connection ? { connectionId: values.connection } : {};
  let result: unknown;
  switch (command) {
    case "setup": {
      expect(0);
      const browser = values.browser;
      if (!browser || !["chrome", "chromium", "edge", "brave", "firefox"].includes(browser))
        throw new Error("Select --browser chrome|chromium|edge|brave|firefox");
      result = await install({
        browsers: [browser as BrowserName],
        extensionId: values["extension-id"],
        manifestDirectory: values["manifest-dir"],
      });
      break;
    }
    case "uninstall":
      expect(0);
      result = await uninstall();
      break;
    case "status":
      expect(0);
      result = { connections: await connections() };
      break;
    case "capabilities":
      expect(0);
      result = await dispatch("capabilities", selected);
      break;
    case "call":
      expect(2);
      result = await dispatch("call", {
        ...selected,
        method: positionals[0],
        args: JSON.parse(positionals[1]!),
      });
      break;
    case "batch":
      expect(1);
      result = await dispatch("batch", {
        ...selected,
        calls: JSON.parse(positionals[0]!),
        continueOnError: values["continue-on-error"] ?? false,
      });
      break;
    case "page":
      expect(2);
      result = await dispatch("page", {
        ...JSON.parse(positionals[1]!),
        ...selected,
        tabId: Number(positionals[0]),
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}. Run tabby help.`);
  }
  process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
}
main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
