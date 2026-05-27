#!/usr/bin/env tsx
/**
 * Generates src/adapters-registry.ts from the adapters/ folder. Each
 * subfolder containing `index.ts` is treated as an adapter; folder name is
 * the slug. Run via `pnpm registry:build`.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ADAPTERS_DIR = path.join(REPO_ROOT, "adapters");
const OUTPUT_FILE = path.join(REPO_ROOT, "src", "adapters-registry.ts");

function discoverAdapters(): string[] {
  if (!existsSync(ADAPTERS_DIR)) return [];
  return readdirSync(ADAPTERS_DIR, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        existsSync(path.join(ADAPTERS_DIR, d.name, "index.ts")),
    )
    .map((d) => d.name)
    .sort();
}

function toIdentifier(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function generate(slugs: string[]): string {
  const header = `/**
 * AUTO-GENERATED. Do not edit. Regenerate with: pnpm registry:build
 */
`;
  if (slugs.length === 0) {
    return `${header}\nimport type { Adapter } from './core/types.js'\n\nexport const adapters: Record<string, Adapter> = {}\n`;
  }

  const imports = slugs
    .map(
      (slug) =>
        `import ${toIdentifier(slug)} from '../adapters/${slug}/index.js'`,
    )
    .join("\n");

  const entries = slugs
    .map((slug) => {
      const ident = toIdentifier(slug);
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(slug)
        ? slug
        : JSON.stringify(slug);
      return key === ident ? `  ${key},` : `  ${key}: ${ident},`;
    })
    .join("\n");

  return `${header}
import type { Adapter } from './core/types.js'

${imports}

export const adapters: Record<string, Adapter> = {
${entries}
}
`;
}

function main(): void {
  const slugs = discoverAdapters();
  const content = generate(slugs);
  writeFileSync(OUTPUT_FILE, content, "utf8");
  console.log(`✓ Wrote ${OUTPUT_FILE}`);
  console.log(
    `  ${slugs.length} adapter(s) registered: ${slugs.join(", ") || "(none)"}`,
  );
}

main();
