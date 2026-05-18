import { loadAdapter } from "../loadAdapter.js";
import { runAdapter } from "../../core/runAdapter.js";

export async function validateCommand(slug: string): Promise<void> {
  if (!slug) {
    console.error("Usage: bitcoinyield-adapter validate <slug>");
    process.exit(1);
  }

  const adapter = await loadAdapter(slug);

  console.log(`▸ ${adapter.name} (${adapter.slug}) — validate (dry run)\n`);

  const result = await runAdapter(adapter, { dryRun: true });

  console.log(`✓ status: ${result.status}`);
  console.log(`  would insert: ${result.inserted.length} row(s)`);
  console.log(`  dropped:      ${result.dropped.length} row(s)`);
  console.log();

  if (result.dropped.length > 0) {
    console.log("Dropped rows:");
    for (const { reason } of result.dropped) {
      console.log(`  - ${reason}`);
    }
    console.log();
  }

  if (result.inserted.length > 0) {
    console.log("Would insert:");
    console.log(JSON.stringify(result.inserted, null, 2));
  }
}
