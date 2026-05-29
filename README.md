# BitcoinYield adapters

A standardized way for engineers to write Bitcoin yield product adapters for BitcoinYield.

If your protocol pays Bitcoin yield through staking, restaking, lending, LP strategies, yield-bearing tokens, or similar products, you can write an adapter and open a PR.

Public listing is not automatic after merge. We aim to merge valid adapters quickly so BitcoinYield can begin tracking the product in our internal database and build historical TVL and APR/APY data.

After our review is complete and the protocol report is researched and published, the product will appear on BitcoinYield.com with TVL and APR/APY data powered by the adapter and refreshed hourly.

To get in direct contact with the BitcoinYield listing team, reach out to Jacob at BitcoinYield.com or on Telegram at jake_blockchain.

## What you write

A single TypeScript file (~30–60 lines) per protocol:

```ts
// adapters/my-protocol/index.ts
import {
  defineAdapter,
  http,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

export default defineAdapter({
  slug: "my-protocol",
  name: "My Protocol",
  url: "https://myprotocol.com",
  category: "staking",
  custody: "self",

  async fetch() {
    const data = await http.get<{ totalBtc: number; aprDecimal: number }>(
      "https://api.myprotocol.com/v1/stats",
    );

    return [
      {
        symbol: "BTC",
        tvlBtc: requirePositive(data.totalBtc, "totalBtc"),
        apr: math.toPercent(requirePositive(data.aprDecimal, "aprDecimal")),
      },
    ];
  },
});
```

That's it. No DB connection. No retry boilerplate. No unit conversions to debug.
You return `tvlBtc` and `apr`; the pipeline derives `tvlUsd` from the canonical
BTC price, then normalizes, guards, and persists. Storage + alerting live in the
framework core.

## Quick start

```bash
git clone https://github.com/Strata-Labs/bitcoinyield-adapters
cd bitcoinyield-adapters
pnpm install

# List adapters
pnpm cli list

# Run an adapter against live data — no DB writes ever
pnpm cli test lombard-finance

# Run the full pipeline (normalize, spike-guard, etc.) — also no DB writes
pnpm cli validate lombard-finance
```

The CLI ships with `NoopStorage` and no DB driver. **It is physically impossible to write to BitcoinYield's database from your local machine.** Run anything you want.

## What the framework does for you

| Module                                                                 | What it does                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `math.add`, `math.mul`, `math.div`, `math.fromUnits`, `math.toPercent` | Decimal-safe arithmetic via decimal.js                                   |
| `prices.getBtc()`                                                      | Cached canonical BTC price (CoinGecko). Same source across all adapters. |
| `http.get`, `http.post`                                                | Native fetch with 3 retries (exponential backoff) + 10s timeout          |
| `ethereum.readContract`, `ethereum.multicall`                          | viem-backed Ethereum reads with public RPC fallback if no key            |
| `stacks.getFungibleTokenBalance`, `stacks.callReadOnly`                | Hiro REST + Clarity contract reads                                       |
| `requirePositive(value, name)`                                         | Throws with descriptive error if not > 0 — replaces silent-zero bugs     |

## Pipeline (runs after every `fetch()`)

| #   | Check           | Notes                                                                                          |
| --- | --------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Normalize types | string → number, validate required fields, derive `tvlUsd` from `tvlBtc × btcPrice` if missing |
| 2   | Boundaries      | Drop rows with `tvlBtc` outside `[0.0001, 5,000,000]` or `apr` outside `[0, 1000]%`            |
| 3   | Spike guard     | Bidirectional 2x-in-5h check — drop rows that look like data regressions, alert on Discord     |
| 4   | Persist         | Atomic insert via the configured Storage backend                                               |
| 5   | Run stats       | Record success/error/duration for adapter health monitoring                                    |

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

## License

MIT.
