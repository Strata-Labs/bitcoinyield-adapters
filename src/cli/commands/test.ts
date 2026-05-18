import { loadAdapter } from '../loadAdapter.js'

export async function testCommand(slug: string): Promise<void> {
  if (!slug) {
    console.error('Usage: bitcoinyield-adapter test <slug>')
    process.exit(1)
  }

  const adapter = await loadAdapter(slug)

  console.log(`▸ ${adapter.name} (${adapter.slug})`)
  console.log(`  url:      ${adapter.url}`)
  if (adapter.requires) console.log(`  requires: ${JSON.stringify(adapter.requires)}`)
  console.log()

  // Mirror runAdapter's secret-whitelisting so adapters that declare
  // `requires.secrets` get a populated `ctx.env`.
  const allowedSecrets = adapter.requires?.secrets ?? []
  const env: Record<string, string | undefined> = {}
  for (const key of allowedSecrets) {
    env[key] = process.env[`BITCOINYIELD_${key}`]
  }

  const startedAt = Date.now()
  const result = await adapter.fetch({ env })
  const durationMs = Date.now() - startedAt

  console.log(`✓ Returned ${result.length} row(s) in ${durationMs}ms\n`)
  console.log(JSON.stringify(result, null, 2))
}
