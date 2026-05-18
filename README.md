# @bitcoinyield/adapters

A standardized way for engineers to write Bitcoin yield product adapters that [BitcoinYield.com](https://bitcoinyield.com) tracks in production.

If your protocol pays Bitcoin yield (staking, restaking, lending, LP, yield-bearing tokens, …) and you want it on the BitcoinYield homepage, write an adapter and open a PR. Once merged, the production deploy picks it up automatically — your protocol's TVL and APR show up on the site within ~24h, hourly updated.

## Why this exists

Without a standardized framework, every adapter ended up reinventing the same things — and getting them subtly wrong in ways that polluted the time series:

- Silent zeros from inconsistent validators (we backfilled 50+ blip rows in one day)
- BTC price fetched from different sources across adapters (Voyager vs cached vs Lombard's API), causing tiny but persistent inconsistencies
- HTTP calls without retries (a 5s scraper timeout produced bad data)
- Wrong DefiLlama endpoint for one adapter caused a $600M TVL inflation that went undetected

This framework is the fix. One contract, one toolbox, one pipeline. Engineers write only the protocol-specific fetch logic; everything else is handled.

## What you write

A single TypeScript file (~30–60 lines) per protocol:

```ts
// adapters/my-protocol/index.ts
import { defineAdapter, http, math, prices, requirePositive } from '@bitcoinyield/adapters'

export default defineAdapter({
  slug: 'my-protocol',
  name: 'My Protocol',
  url: 'https://myprotocol.com',
  category: 'staking',
  custody: 'self',

  async fetch() {
    const data = await http.get('https://api.myprotocol.com/v1/stats')

    const tvlBtc = requirePositive(data.totalBtc, 'totalBtc')
    const apr = math.toPercent(requirePositive(data.aprDecimal, 'aprDecimal'))
    const btcPrice = await prices.getBtc()

    return [{
      pool: 'my-protocol-main',
      symbol: 'BTC',
      tvlBtc,
      tvlUsd: math.mul(tvlBtc, btcPrice),
      apr,
    }]
  },
})
```

That's it. No DB connection. No retry boilerplate. No unit conversions to debug. The pipeline + storage + alerting all live in `@bitcoinyield/adapters/core`.

## Quick start

```bash
git clone https://github.com/Strata-Labs/bitcoinyield-adapters
cd bitcoinyield-adapters
pnpm install

# List adapters
pnpm cli list

# Run an adapter against live data — no DB writes ever
pnpm cli test lombard

# Run the full pipeline (normalize, spike-guard, etc.) — also no DB writes
pnpm cli validate lombard
```

The CLI ships with `NoopStorage` and no DB driver. **It is physically impossible to write to BitcoinYield's database from your local machine.** Run anything you want.

## What the framework does for you

| Module | What it does |
|---|---|
| `math.add`, `math.mul`, `math.div`, `math.fromUnits`, `math.toPercent` | Decimal-safe arithmetic via decimal.js |
| `prices.getBtc()` | Cached canonical BTC price from DefiLlama. Same source across all adapters. |
| `http.get`, `http.post` | Native fetch with 3 retries (exponential backoff) + 10s timeout |
| `ethereum.readContract`, `ethereum.multicall` | viem-backed Ethereum reads with public RPC fallback if no key |
| `stacks.getFungibleTokenBalance`, `stacks.callReadOnly` | Hiro REST + Clarity contract reads |
| `requirePositive(value, name)` | Throws with descriptive error if not > 0 — replaces silent-zero bugs |

## Pipeline (runs after every `fetch()`)

| # | Check | Notes |
|---|---|---|
| 1 | Normalize types | string → number, validate required fields, derive `tvlUsd` from `tvlBtc × btcPrice` if missing |
| 2 | Boundaries | Drop rows with `tvlBtc < 0.001` or `apr` outside `[0, 1000]%` |
| 3 | Spike guard | Bidirectional 2x-in-5h check — drop rows that look like data regressions, alert on Discord |
| 4 | Persist | Atomic insert via the configured Storage backend |
| 5 | Run stats | Record success/error/duration for adapter health monitoring |

The pipeline is what makes the difference between "30 lines you wrote" and "production-grade time series." You write one of those parts; the framework handles everything else.

## What an adapter folder looks like

Required:
```
adapters/my-protocol/
├── README.md          # what it does, data sources, gotchas
└── index.ts           # default-exports defineAdapter(...)
```

For complex adapters (multi-step contract reads, helper extraction, etc.) use whatever structure helps:
```
adapters/zest-protocol/
├── README.md
├── index.ts           # entry — wires everything
├── constants.ts       # addresses, token IDs
├── vaults.ts          # extracted: balance fetching
└── rates.ts           # extracted: APR computation
```

The framework only requires `index.ts` to default-export an adapter. Everything else is your call.

## Status

| Component | Status |
|---|---|
| Adapter contract + toolbox | ✅ shipped |
| Pipeline (normalize, boundaries, bidirectional spike-guard) | ✅ shipped |
| CLI (`test`, `validate`, `list`) | ✅ shipped |
| `chains.ethereum`, `chains.stacks` | ✅ shipped |
| `DiscordNotifier` | ✅ shipped |
| Staleness monitor | ✅ shipped |
| All 24 production adapters ported from main app | ✅ shipped |
| Inngest microservice (`src/server.ts`) | ✅ shipped |
| Main-app endpoints (`/api/adapter-metrics`, `/api/adapter-status`) | 🚧 in progress |
| Adapter health page on bitcoinyield.com | 🛣️ planned |

## License

MIT.
