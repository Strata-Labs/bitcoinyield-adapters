# Claude Code Instructions for BitcoinYield Adapters

## What this repo is

Standalone microservice that runs every BitcoinYield protocol adapter on a schedule and POSTs results to the main BitcoinYield app via HTTP. It holds **no database credentials** — the main app owns the schema and persistence.

Two outbound endpoints on the main app (both auth'd by `x-adapter-key`):

- `POST /api/adapter-metrics` — writes a `protocolMetrics` row
- `POST /api/adapter-status` — writes/upserts an `adapterStatus` row

Local Discord webhooks handle operational paging (spike alerts, scraper failures with Browserbase session URL) — that fires even when the main app is down.

## Package manager

Always use `pnpm`. Same as the main app.

```bash
pnpm install
pnpm test <slug>      # run one adapter live, print result
pnpm validate <slug>  # full pipeline live (fetch + guards), no DB writes
pnpm list             # list registered adapters
pnpm build            # regenerates registry then builds
```

## Architecture

### Adapter contract

Every adapter is a single file (or folder for complex ones) under `adapters/<slug>/index.ts`:

```ts
import { createRate, defineAdapter, math, http, requirePositive } from '@bitcoinyield/adapters'

export default defineAdapter({
  slug: 'protocol-name',
  name: 'Protocol Display Name',
  url: 'https://protocol.com',
  category: 'staking' | 'lending' | 'yield-bearing' | ...,
  custody: 'self' | 'multisig' | 'custodial',
  requires: { secrets: ['SOME_API_KEY'] },  // optional

  async fetch(ctx) {
    // ctx.env.SOME_API_KEY is available if declared above
    const data = await http.get(...)
    const tvlBtc = requirePositive(parseFloat(data.tvl), 'data.tvl')
    return [{
      symbol: 'BTC',
      tvlBtc,
      rate: createRate({
        type: 'apr',
        value: apr,
        basis: 'reported',
        source: 'https://protocol.example/rates',
        compounding: { method: 'unknown' },
      }),
    }]
  },
})
```

Adapters are auto-discovered. Adding a new file in `adapters/` and running `pnpm build` regenerates `src/adapters-registry.ts`.

### Pipeline

For every adapter run: `fetch → normalize → boundaries → spike-guard → POST to main app`.

- **normalize** — requires `symbol`, `tvlBtc`, and `rate` (or legacy `apr`); derives `tvlUsd` and writes canonical rate semantics into metadata during the main-app migration
- **boundaries** — drops rows outside `tvlBtc 0.0001..5_000_000` or annualized rate -1000..1000. Negative observed rates are valid and must not be floored.
- **spike-guard** — two bands, both directions, 5h window: >=3x alerts Discord but keeps the row; >=5x alerts and drops it (DefiLlama comparison: theirs is a one-way 5x drop)

### Toolbox (use these — don't roll your own)

Reach for these before writing anything custom:

- `math.{add,sub,mul,div,fromBps,clamp}` — decimal.js underneath. **Never use raw JS arithmetic for money.**
- `prices.getBtc()` — single source of BTC price (5min cache via CoinGecko). Don't call other price APIs directly.
- `http.{get,post,getText,graphql}` — has retries + timeouts built in.
- `scraper.{scrape,openPage,matchNumber}` — Browserbase wrapper for JS-rendered pages. **Last resort only** — always prefer a contract read or protocol API; scrape only when neither exists (currently no adapter scrapes: mezo-earn moved to Mezo's API, merlin-btc to on-chain reads).
- `chains.ethereum` — viem with fallback transport across 4 public RPCs, multicall, shared `erc20Abi` and `erc4626VaultAbi`.
- `chains.evm` / `getEvmClient(config)` — env-first client factory for non-mainnet EVM chains (Botanix, Ink). Set `BITCOINYIELD_RPC_<CHAIN>` in production.
- `chains.stacks` — Hiro REST + `@stacks/transactions` for read-only contract calls.
- `cms.getManualMetrics(ctx, slug)` — for products with no API or on-chain source (Sypher, Coinbase fund): reads marketer-maintained APR/TVL from the main app's CMS (`GET /api/manual-metrics/:slug`). Adapter must declare `requires.secrets: ["API_URL", "ADAPTER_KEY"]`. **Never hardcode reported figures in an adapter** — they go stale and silently overwrite CMS edits.
- `requirePositive(value, name)` — **throws loudly if zero/negative/NaN**. Use this aggressively. Silent zeros are the bug we built this framework to prevent.
- `createRate(input)` — validates rate semantics. APR is the default; APY requires automatic compounding evidence.
- `calculateUnitValueRate(input)` — central share/NAV/conversion-rate annualization. Do not repeat this math inside adapters.

## Conventions

### Adapter style

- Keep adapter files small (30-60 LOC). Split into a folder if longer.
- Adapters are self-contained, with one sanctioned exception: a protocol family with several near-identical adapters may share a helper folder under `adapters/<protocol>/` (no `index.ts`, so it never registers as an adapter) — see `adapters/yieldbasis/token-adapter.ts` and `adapters/yieldbasis/yield-bearing-adapter.ts`. Such helpers must deep-import from `src/core/*`, not `@bitcoinyield/adapters` — the entrypoint re-exports the registry, which imports the adapters that import the helper, and the cycle crashes module init. Anything useful beyond one protocol belongs in `src/core/utils/`.
- Declare external secret needs via `requires.secrets`. They appear on `ctx.env`.
- Don't hardcode addresses or API URLs at module top — put constants near where they're used.
- Match existing `adapters/*` for structure before inventing your own pattern.

### Safety rules

- **Unavailable is null, never zero.** Return `rate: null` with `rateUnavailableReason` when no defensible rate exists.
- **APY requires compounding proof.** Supply a pollable share price, NAV, exchange rate, or protocol-accounting field showing yield retained in the held position.
- **`NoopStorage` is the CLI default.** A contributor running `pnpm test <slug>` physically cannot write to production. The framework ships no DB driver.
- **Don't mock the database in tests.** Integration tests hit a real backend or the noop storage — never a mock.

### Commits

No `Co-Authored-By` trailer, no description-style commit body. Concise subject only — see main app's commit log for style.

## Deployment

Inngest serve handler at `src/server.ts`, deployed to Vercel as a separate project from the main app. Same Inngest account, separate function set.

Required env in production:

- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — from Inngest dashboard
- `BITCOINYIELD_API_URL` — main app base URL
- `BITCOINYIELD_ADAPTER_KEY` — shared secret for the two endpoints
- `BITCOINYIELD_BROWSERBASE_KEY`, `BITCOINYIELD_BROWSERBASE_PROJECT_ID` — for scraper adapters
- `BITCOINYIELD_VOYAGER_API_KEY`, etc — per-adapter secrets

Discord webhook (optional, for operational alerts):

- `DISCORD_WEBHOOK` — single channel for every alert type. Each message
  prefixes its category (`SPIKE`, `BOUNDARY`, `STALE`, `REGRESSION`) so one
  channel is enough.

## Open follow-ups

- **Lombard multi-chain LBTC** — intentionally reads Ethereum supply only (~$650M); the protocol-wide backing (~$960M) requires summing BTC balances across Lombard's `/api/v1/addresses` custody list (needs a Bitcoin indexer). Documented in the adapter README.
- **`adapterStatus` collection** — needs to be added to the main app before status reporting can go live (see INTEGRATION.md).
- **acre-mezo** — disabled 2026-07-13: the vault's on-chain accounting is bricked; `totalAssets()` and `convertToAssets()` both revert with "DF: feed is unhealthy" (dormant project, price feed updater stopped, heartbeat lapsed). Re-enable when the reads work again; the adapter also carries an apr floor + `allowZeroApr` for the dormant period, remove those when Acre relaunches properly.
- **zenrock-zenbtc** — disabled 2026-07-06: API reports `yieldAPY: 0` with the exchange rate frozen since ~2026-06-21. Re-enable when Zenrock resumes paying yield.
- **botanix** — retired 2026-08-17 (permanent, never re-enable): Botanix Labs shut the network down — announced 2026-06-10, withdrawals closed 2026-07-09, last block 2026-07-31. Every RPC endpoint is dead. The `.disabled` file is kept only as an ERC-4626 reference; the folder can be deleted outright.
- **yb-\*-yieldbearing APY = official 30d trading APY** — `tradingApy` is stored as APY because `pricePerShare()` proves automatic position-value accrual. Negative windows remain negative; they are never floored to zero.

## When in doubt

- Read an adjacent adapter that does something similar before writing yours.
- Run `pnpm test <slug>` with real env to confirm output before committing.
- If something feels like it needs a new utility, check `src/core/utils/` first — it might already exist.
