import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Adapter } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = path.resolve(__dirname, "../../adapters");

export function listAdapterSlugs(): string[] {
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

export async function loadAdapter(slug: string): Promise<Adapter> {
  const indexPath = path.join(ADAPTERS_DIR, slug, "index.ts");
  if (!existsSync(indexPath)) {
    throw new Error(
      `Adapter '${slug}' not found at ${indexPath}.\n` +
        `Known adapters: ${listAdapterSlugs().join(", ") || "(none)"}`,
    );
  }
  const mod = (await import(pathToFileURL(indexPath).href)) as {
    default: Adapter;
  };
  if (!mod.default) {
    throw new Error(
      `Adapter ${slug} must default-export the result of defineAdapter(...)`,
    );
  }
  return mod.default;
}
