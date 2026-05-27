# Contributing

Adding a Bitcoin yield product to BitcoinYield.com takes ~30 lines of TypeScript and a PR. No database credentials, no infra knowledge.

## What happens to your PR

1. You open a PR adding `adapters/<your-protocol>/index.ts`
2. CI runs `pnpm cli test <slug>` against your adapter (real upstream call, **no DB**)
3. CI runs `pnpm cli validate <slug>` to ensure the pipeline accepts the output
4. A maintainer reviews: data accuracy spot-check vs the protocol's own UI, security review of any new dependencies
5. Merge → BitcoinYield's main app picks up the new package on the next deploy (~24h via auto-bump bot)
6. Hourly Inngest cron starts running your adapter → your protocol shows on bitcoinyield.com

You never get DB access. You never see production credentials. Your code runs in BitcoinYield's production but is sandboxed by what the framework declares safe.

## Adding a new adapter

### 1. Scaffold

```bash
mkdir -p adapters/my-protocol
touch adapters/my-protocol/{index.ts,README.md}
```

Folder name must match the adapter's `slug`. Use kebab-case (e.g., `mezo-earn`, `stacks-dual-stacking`).

### 2. Write the adapter

Adapters are pure functions. Import from the shared toolbox. Never reach into `process.env` or talk to a DB.

```ts
// adapters/my-protocol/index.ts
import {
  defineAdapter,
  http,
  math,
  prices,
  requirePositive,
} from "@bitcoinyield/adapters";

export default defineAdapter({
  slug: "my-protocol",
  name: "My Protocol",
  url: "https://myprotocol.com",
  category: "staking", // staking | restaking | lending | lp | yield-bearing | cdp
  custody: "self", // self | multisig | custodial | mpc

  async fetch() {
    const data = await http.get("https://api.myprotocol.com/v1/stats");

    const tvlBtc = requirePositive(data.totalBtc, "totalBtc");
    const apr = math.toPercent(requirePositive(data.aprDecimal, "aprDecimal"));
    const btcPrice = await prices.getBtc();

    return [
      {
        pool: "my-protocol-main",
        symbol: "BTC",
        tvlBtc,
        tvlUsd: math.mul(tvlBtc, btcPrice),
        apr,
      },
    ];
  },
});
```

### 3. Test it locally

```bash
pnpm cli test my-protocol      # raw fetch output, no pipeline, no storage
pnpm cli validate my-protocol  # full pipeline, prints what would be written
```

### 4. Write a README

`adapters/my-protocol/README.md` should include:

- What the protocol does (one paragraph)
- Data sources (TVL endpoint, APY endpoint, contract addresses)
- Required env vars (if any) — see "Environment" section below
- Cost estimate (rough RPC/API call count per hour)

### 5. Open a PR

CI will run automatically. If green, a maintainer will review.

## Conventions

### Required adapter fields

| Field     | Why                                                   |
| --------- | ----------------------------------------------------- |
| `slug`    | Stable, immutable identifier (must match folder name) |
| `name`    | Display name on bitcoinyield.com                      |
| `url`     | Protocol UI URL                                       |
| `fetch()` | The async function returning `AdapterResult[]`        |

### Recommended adapter fields

| Field                                                 | Why                                      |
| ----------------------------------------------------- | ---------------------------------------- |
| `category`                                            | Lets the UI filter by yield product type |
| `custody`                                             | Primary risk dimension for Bitcoin yield |
| `audit.firms`, `audit.latestUrl`                      | Trust signals shown to users             |
| `requires.rpc` / `requires.apis` / `requires.secrets` | Lets the runner validate before invoking |

### Output (`AdapterResult`)

| Field                    | Required | Notes                                                                      |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| `pool`                   | ✓        | Unique within this adapter (e.g., `'babylon-btc-staking'`)                 |
| `symbol`                 | ✓        | Token symbol (`BTC`, `LBTC`, `cbBTC`, `sBTC`, etc.)                        |
| `tvlBtc`                 | ✓        | **BTC-denominated** TVL. Throw via `requirePositive` if upstream is bad.   |
| `apr`                    | ✓        | In percent form (4.2 = 4.2%). Use `math.toPercent(decimalRate)` if needed. |
| `tvlUsd`                 | optional | Pipeline derives from `tvlBtc × btcPrice` if missing                       |
| `apyBase`, `apyReward`   | optional | Sum should equal `apr`                                                     |
| `atCapacity`, `capacity` | optional | If the product has a hard cap                                              |
| `metadata`               | optional | Arbitrary JSON; preserved verbatim in storage                              |

### File structure

```
adapters/my-protocol/
├── README.md          # required
├── index.ts           # required — must default-export defineAdapter(...)
├── abi.ts             # optional — for on-chain adapters
├── constants.ts       # optional — addresses, magic numbers
├── helpers.ts         # optional — extracted logic for complex adapters
└── index.test.ts      # optional — unit tests with MemoryStorage
```

The framework only cares about `index.ts`. Everything else is for your readability.

## Hard rules

1. **Don't import `process.env` directly.** Declare needed secrets in `requires.secrets`; the runner injects them via `ctx.env`.
2. **Don't import a DB driver or write anywhere.** Adapters return data; persistence is the framework's job.
3. **Don't catch errors silently.** If upstream returns garbage, `requirePositive` should throw — the runner's retry mechanism handles it. A row written with `apr=0` pollutes the time series forever.
4. **Don't roll your own retries.** `http.get` has 3 retries with exponential backoff built in.
5. **Don't compute USD differently each time.** Use `prices.getBtc()`. Single source of truth across all adapters.

## Environment (optional)

Some adapters need access to a chain RPC or third-party API. Declare what you need in `requires` and the framework wires it up:

```ts
requires: {
  rpc: ['ethereum'],           // pre-configured ethereum client (public RPC fallback if no key)
  stacks: true,                // pre-configured Stacks helper
  apis: ['moralis'],           // optional API clients
  secrets: ['MY_API_KEY'],     // exposed as ctx.env.MY_API_KEY
}
```

For local development with a paid RPC key (recommended for Ethereum-chain adapters), create `.env.local`:

```bash
BITCOINYIELD_RPC_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

The CLI works without any env vars (uses public RPC fallbacks) but is slower. For your own testing comfort, a free Alchemy/Infura key is recommended.

## Code of conduct

Be kind. We're here to make Bitcoin yield data more accurate and accessible.
