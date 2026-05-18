# BitcoinYield — New Protocol Onboarding Checklist

> Send this to any Bitcoin-yield product team that wants to be listed on
> BitcoinYield. The more fields they fill in, the faster and more accurately
> we can integrate them. Fields marked **required** are the bare minimum;
> the rest let us surface richer signals to users.

---

## 1. Identity

| Field | Required? | Example | Notes |
|---|---|---|---|
| Protocol name | ✅ Yes | "Acre" | Display name on cards. |
| Product slug | ✅ Yes | `acre-btc` | Short, lowercase, hyphen-separated. Used as a primary key in our DB; **never changes** once live. |
| Product variant slug(s) | If multi-variant | `acre-btc-staked`, `acre-btc-yieldbearing` | One slug per variant we'll list separately. |
| Marketing URL | ✅ Yes | `https://bitcoin.acre.fi` | Where users go to learn about the product. |
| Direct deposit URL | Recommended | `https://bitcoin.acre.fi/dashboard` | The exact page a user clicks "Deposit" from. |
| Launch date | Recommended | `2024-03-15` | Battle-tested signal — "how long has this been live". |
| Twitter, Docs, GitHub | Recommended | URLs | Links on the protocol detail page. |

---

## 2. Yield product taxonomy

| Field | Required? | Example | Notes |
|---|---|---|---|
| Yield mechanism | ✅ Yes | `erc4626-share-price` / `nft-vetoken` / `direct-btc-payout` / `off-chain-strategy` / `wrapper-only` | Determines which adapter pattern we apply. See Section 8. |
| Payout asset | ✅ Yes | `BTC` / `your-receipt-token` / `your-governance-token` | What the user actually receives as yield. |
| Yield source description | ✅ Yes | "Mezo borrowing market interest" | One sentence; rendered verbatim on our protocol detail page. |
| Strategy summary | Recommended | "Deposits routed through MidasAllocator into lending markets on Mezo Chain." | 1-2 sentences. |
| Composability — does the receipt token earn yield in other DeFi? | Recommended | yes/no + list | Helps users understand opportunity cost. |

---

## 3. Asset and token info

### Underlying asset (what the user deposits)

| Field | Required? | Example | Notes |
|---|---|---|---|
| Asset symbol | ✅ Yes | `tBTC` / `wBTC` / `cbBTC` / `BTC` (native) | Display symbol. |
| Asset contract address(es) | ✅ Yes | `0x18084fba666a33d37592fa2633fd49a74dd93a88` per chain | List each chain if multi-chain. |
| Asset decimals | ✅ Yes | `8` or `18` | Important for decimal math. |
| Bridge / wrapping mechanism | If asset is wrapped BTC | "tBTC via Threshold Network" | Important risk disclosure. |

### Receipt token (what the user holds after deposit)

| Field | Required? | Example | Notes |
|---|---|---|---|
| Receipt symbol | ✅ Yes | `acreBTC` / `LBTC` / `stBTC` | Display symbol — this is what we list on cards. |
| Receipt token type | ✅ Yes | `erc20-vault-share` / `erc20-1to1-wrapper` / `erc721-position-nft` / `none` | Drives how we read TVL and balances. |
| Receipt contract address(es) | ✅ Yes | per chain | |
| Receipt decimals | ✅ Yes | `18` | |
| Cross-chain deployments | Recommended | List addresses on every chain it lives. | Lets us aggregate global supply. |

---

## 4. On-chain functions (the BIG one)

The single biggest determinant of integration quality. Fill in whichever
of the following your contract exposes:

### TVL access — pick one

| Mechanism | Function signature | Notes |
|---|---|---|
| ERC-4626 vault | `totalAssets()` | Best case. Returns underlying-denominated TVL. |
| Custom aggregator | e.g. `totalLockedBtc()` | Same idea, custom name — please document. |
| ERC-20 wrapper (1:1 backed) | `totalSupply()` | OK for wrapped-BTC products. Note decimals. |
| PoR oracle (Chainlink etc.) | `latestAnswer()` on a feed address | Acceptable if no on-chain function. |
| API only | Endpoint URL + JSON schema | Last resort. Document stability guarantees. |

**Please provide a complete sample on-chain call** — the exact contract
address, function name, expected return, and how to interpret it.

### APR / yield access — pick one

| Mechanism | What we read | Notes |
|---|---|---|
| Share-price growth (ERC-4626 style) | `convertToAssets(10^decimals)` snapshot at latest + N blocks ago | Preferred — fully verifiable, no trust. |
| Emissions / gauge model | `preview_emissions(gauge, t1)`, `preview_emissions(gauge, t2)` + gauge.totalSupply + reward-token price | Curve-style. We compute APR from rate × token price ÷ TVL. |
| Direct yield-rate function | e.g. `currentApy()` | Acceptable if methodology is documented. |
| API endpoint | URL + JSON schema | We'll consume it. Document the **window** (7d / 30d / lifetime) and whether it's gross or net of fees. |
| None — yield paid externally (BTC sats etc.) | — | We'll display 0 APR and note the mechanism. Tell us where payouts happen so users can verify independently. |

**For multi-window APR**: if you publish `7d`, `30d`, `90d` etc., please
say which is the "headline" your team considers authoritative. We default
to 7d on the card and surface the others on the detail page.

### Capacity & operational state — recommended

| Function | What it does | Notes |
|---|---|---|
| `maxDeposit(address)` | How much more this address can deposit. Pass `0x0` for "any depositor." | `uint256.max` = uncapped. A real number = capped. Drives the "vault is N% full" UI. |
| `paused()` | Bool — is the contract paused? | Drives "deposits disabled" badges. |
| `minDepositAmount()` (or similar) | Floor for new deposits | Users see this on the card. |
| `asset()` | Address of underlying | Lets us runtime-verify what users deposit. |

### Other useful reads

- `name()`, `symbol()`, `decimals()` — standard.
- Owner / governance / pause-authority addresses.
- Strategy contract address(es) — if the product routes through allocators / sub-strategies, please list them.

---

## 5. Multi-chain considerations

If the protocol deploys on more than one chain:

| Field | Required? | Notes |
|---|---|---|
| Chain IDs | ✅ Yes | Where the contracts live. We currently support Ethereum mainnet (`1`), Botanix (`3637`), Stacks (custom), Lightning, Bitcoin native. New chains: provide RPC URL + multicall3 address + block time. |
| Public RPC URLs | ✅ Yes | At least 2 fallbacks if possible. We need archive support for 30d historical reads. |
| Multicall3 deployment | If your chain has one | Canonical address is `0xcA11bde05977b3631167028862bE2a173976CA11`. If not deployed on your chain, name a substitute. |
| Aggregate supply method | If multi-chain | If LBTC lives on 5 chains, do you publish a method that sums across all chains? Or do we sum each `totalSupply` ourselves? |
| Block time (avg) | If non-mainnet | We use this to convert 30d into "blocks ago" for historical reads. |

---

## 6. Withdrawal mechanics

Users care a lot about this and most aggregators don't surface it well.

| Field | Required? | Example | Notes |
|---|---|---|---|
| Withdrawal type | ✅ Yes | `instant` / `queued` / `lock-period` / `epoch-based` | Drives a major UX field. |
| Typical wait time (days) | ✅ Yes | `0` / `3-7` / `28` | Approximate; we can refine via on-chain queue reads if you support them. |
| Queue / live wait function | If queued | Contract address + function returning live queue depth or estimated wait | Lets us show a live "wait time today" instead of a static range. |
| Minimum withdrawal | If different from min deposit | | |
| Withdrawal fees | If any | bps or flat | |
| Lock-up enforcement | If applicable | "Tokens locked for X days from deposit" | |

---

## 7. Risk and trust disclosure

| Field | Required? | Example | Notes |
|---|---|---|---|
| Custody model | ✅ Yes | `self-custody` / `multisig` / `mpc` / `custodial` | Single biggest risk axis for BTC products. |
| Multisig threshold | If multisig | `4-of-7` Safe (`0x…`) | Threshold + Etherscan link to the Safe. |
| Multisig signers | Recommended | Public list of teams / firms | Boosts trust signal. |
| Upgradeable contracts? | ✅ Yes | yes/no | If yes, who controls upgrades, and is there a timelock? |
| Timelock duration | If upgradeable | e.g. `48h` | |
| Pause authority | If has `paused` | Address that can pause | |
| Audits | ✅ Yes | List of `{firm, report URL, date}` | We display these on the protocol card. |
| Insurance | Recommended | Nexus Mutual / Sherlock / in-protocol fund | Coverage details. |
| Past incidents | Recommended | Any | Honest disclosure builds trust. |

---

## 8. Fees

| Field | Required? | Example | Notes |
|---|---|---|---|
| Entry fee | ✅ Yes | `0` / `0.5%` / `50 bps` | Charged at deposit. |
| Exit fee | ✅ Yes | | Charged at withdrawal. |
| Management fee | ✅ Yes | `0` / `2% annual` | Time-based. |
| Performance fee | ✅ Yes | `0` / `10% of yield` | On profit. |
| Where do fees go | Recommended | "Protocol treasury", "veToken holders" | |
| Live fee getters | If on-chain | `entryFeeBasisPoints()` etc. | So we can read current fees from the contract. |

---

## 9. Compliance / onboarding

| Field | Required? | Example | Notes |
|---|---|---|---|
| KYC requirement | ✅ Yes | yes/no | |
| Geographic restrictions | If KYC | List blocked jurisdictions | |
| Minimum deposit (USD or BTC) | ✅ Yes | `0.001 BTC` / `$25,000` | |
| Accredited-only? | If applicable | | |

---

## 10. Adapter type — for our internal classification

Pick one. This determines which adapter pattern we use.

### `erc4626-share-price` (preferred)
Your contract is ERC-4626 compliant. We read `totalAssets`, `convertToAssets(10^decimals)`, `maxDeposit`, `paused`. APR derived from share-price growth over 30 days, fully on-chain. Examples: Acre, Botanix, Yield Basis (×6 variants).

### `erc4626-with-emissions` (also great)
ERC-4626 vault + a gauge contract that emits a reward token. We do all the
above plus read `preview_emissions(gauge, t1) / (gauge, t2)` and pull the
reward token's price from CoinGecko. APR = share-price growth + emissions
APR. Examples: Yield Basis staked variants.

### `wrapper-only` (acceptable)
Receipt token is 1:1 backed by deposited BTC; yield doesn't accrue to the
receipt token. We read `totalSupply` for TVL. Yield comes from downstream
products (your own Earn vault, partner protocols, etc.). Need to point us
at the downstream product. Examples: LBTC, M-BTC (Merlin Seal-era).

### `nft-vetoken` (more work, please publish addresses)
Curve-style veToken: users lock the deposit asset into an NFT position
with linear-decay voting weight. Yield via gauges + epoch emissions.
Requires a `totalLocked()` aggregator on the lock contract (please expose
this — otherwise we'd have to enumerate NFTs which is expensive). Example:
Mezo Earn veBTC.

### `off-chain-strategy` (hybrid expected)
Yield generated off-chain (CEX trading, basis trades, RWA, etc.). Receipt
token may or may not appreciate via NAV updates. Need:
- A per-token NAV / exchange rate oracle (Chainlink PoR or similar)
- An API endpoint with documented APR methodology
- Strategy disclosure

Examples: SolvBTC+, Maple BTC Yield, Lombard Earn (LBTCv).

### `direct-btc-payout`
Yield is paid out in BTC sats directly to depositors' Bitcoin addresses,
not via share-price growth in the wrapper. Need:
- Payout-source Bitcoin addresses (so we can verify historical APR via
  on-chain Bitcoin analysis)
- API endpoint for current rate
- Receipt token's totalSupply for TVL (or equivalent)

Example: zenBTC.

### `custodial`
Pure off-chain product. Need:
- Quarterly or monthly polling endpoint with TVL + APR
- Attestation / audit reports
- Transparent fee schedule

Examples: Coinbase BTC Yield Fund, Sypher Capital.

---

## 11. Display preferences

| Field | Notes |
|---|---|
| Display denomination | BTC or USD? Our default is BTC for the asset class, USD for the dollar value. |
| Risk tier | Self-assessment: low / medium / high. We'll set this independently but your view is useful. |
| Logo URL | Square SVG or PNG, transparent background, 256×256 minimum. |
| Brand color | Hex code for any accents. |

---

## 12. Operational

| Field | Notes |
|---|---|
| Outage notification contact | Where do we email if our integration starts erroring (so you can investigate)? |
| Status page URL | If you publish one. |
| Discord / Slack for technical questions | Direct channel beats email. |
| API key rotation policy | If we hold an API key, how often will it rotate? |
| Rate-limit policy | How many requests per minute can we make? |

---

## 13. What to send back

A protocol team filling this in should send back:

1. **A filled copy of this checklist** (markdown or PDF — either fine).
2. **A sample contract call** for TVL and APR — exact addresses, function names, expected raw return, decoded result. Run it once and paste the output.
3. **For API endpoints:** a sample response with all fields documented.
4. **For multi-chain:** a per-chain table of contracts.
5. **Audit reports** (links to firm + PDFs).

That gives us everything we need to ship an adapter in **30-60 minutes**
instead of the days of reverse-engineering we typically do today.

---

## Why this matters to a protocol team

Aggregators that integrate fragmented sources display fragmented data.
Bitcoin yield is a small enough category that **the protocols with the
cleanest data interfaces will get the most accurate representation** on
BitcoinYield and similar trackers. The work to fill this in once is paid
back by every aggregator stopping to ask the same questions independently.

We strongly prefer protocols that:

- Publish all contract addresses in their docs (not just the user-facing UI)
- Expose ERC-4626 (or equivalent) view functions
- Publish a Chainlink Proof-of-Reserves feed if any BTC custody is involved
- Use a Curve-style gauge for emissions (well-understood pattern)
- Document their APR methodology (window, gross vs net, what's included)

Protocols that don't will still be listed when possible, but with explicit
disclaimers like *"APR sourced from protocol's dashboard; methodology not
publicly documented"* — which is the right tradeoff for honesty but isn't
the most flattering presentation.

---

## Quick reference: what each yield mechanism gives us

| Mechanism | TVL clarity | APR clarity | Integration effort |
|---|---|---|---|
| ERC-4626 share-price | ⭐⭐⭐ Full on-chain | ⭐⭐⭐ Derivable from share-price delta | Low |
| Emissions + gauge | ⭐⭐⭐ Full on-chain | ⭐⭐⭐ Derivable from emissions × token price | Low |
| ERC-20 + PoR oracle | ⭐⭐⭐ Verifiable via oracle | ⭐ Need API | Low-medium |
| ERC-20 wrapper only | ⭐⭐⭐ Via totalSupply | ⭐ Often N/A or via downstream product | Low |
| veToken NFT | ⭐⭐ Need aggregator function | ⭐ Variable per user — complex | Medium-high |
| Off-chain strategy | ⭐⭐ Via PoR if available, else API | ⭐ API only | Medium |
| Direct BTC payout | ⭐⭐ Via wrapper supply | ⭐ Requires Bitcoin chain analysis or API | High to fully verify |
| Pure custodial | ⭐ API or manual disclosure | ⭐ API or manual disclosure | Low if API; high if manual |
