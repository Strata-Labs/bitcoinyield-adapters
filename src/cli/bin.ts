#!/usr/bin/env tsx
import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  (process as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(
    ".env.local",
  );
}

import { testCommand } from "./commands/test.js";
import { validateCommand } from "./commands/validate.js";
import { listCommand } from "./commands/list.js";

const HELP = `
bitcoinyield-adapter — local development for BitcoinYield adapters

Usage:
  bitcoinyield-adapter test <slug>      Run adapter.fetch() and print raw output
  bitcoinyield-adapter validate <slug>  Run full pipeline (no DB writes)
  bitcoinyield-adapter list             List all adapters
  bitcoinyield-adapter --help           Show this help

Notes:
  - The CLI uses NoopStorage by default. It cannot write to any database,
    even if one is reachable from your machine.
  - For Ethereum-chain adapters, set BITCOINYIELD_RPC_ETHEREUM for better
    reliability. Without it, a public RPC fallback is used.
`;

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    console.log(HELP.trim());
    return;
  }

  switch (command) {
    case "test":
      await testCommand(rest[0] ?? "");
      break;
    case "validate":
      await validateCommand(rest[0] ?? "");
      break;
    case "list":
      await listCommand();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n✗ Failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(1, 4).join("\n"));
  }
  process.exit(1);
});
