import { listAdapterSlugs, loadAdapter } from "../loadAdapter.js";

export async function listCommand(): Promise<void> {
  const slugs = listAdapterSlugs();
  if (slugs.length === 0) {
    console.log("(no adapters found in ./adapters)");
    return;
  }
  console.log(`Found ${slugs.length} adapter(s):\n`);
  for (const slug of slugs) {
    try {
      const adapter = await loadAdapter(slug);
      console.log(
        `  ${slug.padEnd(20)}  ${adapter.name.padEnd(28)}  ${adapter.url}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${slug.padEnd(20)}  [ERROR: ${msg}]`);
    }
  }
}
