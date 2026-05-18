# BitcoinYield — Per-Protocol Data Requests

> Working document. For each protocol BitcoinYield currently tracks, this
> summarizes what we read today, the data sources we depend on, the open
> questions / gaps, and the specific information we'd ideally get from the
> protocol team. Sections marked **🔴 blocked** have meaningful data quality
> issues; **🟡 hybrid** are working but could be more transparent; **🟢 ok**
> are fully validated.

---

## Context for protocol teams reading this

BitcoinYield (https://bitcoinyield.com) is a yield-product aggregator
focused specifically on Bitcoin. We run a standalone microservice that
queries each tracked protocol hourly via a mix of on-chain reads and APIs,
and we surface TVL, APR, and protocol-quality signals on the platform.

We strongly prefer on-chain or well-documented API sources over scraping
your dashboard. Scraping is fragile (breaks when your UI changes) and
under-represents your actual TVL/yield to users who skim our aggregator.

This document asks each protocol team to fill in gaps so we can switch
fragile/incomplete data sources to authoritative ones.

---

## 🟢 Acre BTC

**What we track:** TVL (tBTC under management), APR (30-day on-chain),
capacity, paused state, share price.

**Sources:**
- Vault contract: `0x19531C886339dd28b9923d903F6B235C45396ded` (Ethereum)
- Reads: `totalAssets()`, `convertToAssets(1e18)` at latest + 30d-prior block, `maxDeposit`, `paused`, `asset()`.

**Open questions / asks for Acre team:**
1. **Strategy transparency.** V2 routes through `MidasAllocator` (`0xD72b…59Bb`) → Midas Capital. Can you publish or confirm: what % of TVL is currently in Midas vs. cash? Are there multiple strategies under MidasAllocator?
2. **Oracle health.** During our testing we saw `totalAssets()` revert with `DF: feed is unhealthy`. What's the SLA on the data feed? Is there a way to subscribe to feed-status alerts?
3. **`WithdrawalQueue` (`0xe7b8…5D06`).** What's the average time-to-finalize for redemptions right now? Is there a method to read live queue depth and an estimated wait time?
4. **`BitcoinDepositorV2` (`0xe5F4…c777`).** Can you share the verified ABI? We'd like to read `minDepositAmount` directly instead of guessing from your UI.
5. **Audit + governance.** Owner is `0x790dda4c…77e59`. Is this a Safe multisig? What's the threshold (e.g. 4-of-7)? Latest audit reports?
6. **Recent negative APR.** Our on-chain 30d share-price delta showed ~-11% APR on May 13, 2026. Was this a fee event, a one-off rebase, or strategy losses? Worth documenting publicly if it recurs.

---

## 🟢 Botanix (stBTC vault)

**What we track:** TVL (pBTC underlying), APR (30-day on-chain), capacity,
paused state, share price.

**Sources:**
- Vault: `0xF4586028FFdA7Eca636864F80f8a3f2589E33795` (Botanix L2, chain 3637)
- Reads: same as Acre — full ERC-4626 surface.

**Open questions / asks for Botanix team:**
1. **Yield-source disagreement.** Your docs say yield comes from "transaction fees" on Botanix L2. Your `blend.money/safe/yield` API mentions allocations to "Morpho markets" (50% stBTC/pBTC, 50% Dolomite stBTC/pBTC). Which is it, or both?
2. **Capacity cap.** `maxDeposit(0x0)` returns ~76 pBTC at the moment. The vault is ~23% full. Is this a hard programmatic cap or a temporary limit, and how do you decide when to raise it?
3. **pBTC peg.** Docs state pBTC pegs 1:1 with BTC. Is there an automated mechanism that enforces this, or is it operationally maintained? Any PoR feed for pBTC reserves?
4. **Dispatcher contracts.** Are there separate strategy contracts under stBTC we should be reading (analogous to Acre's MidasAllocator)?
5. **Audit + threshold.** Same as Acre — owner is a multisig, what's the threshold and who are the signers? Latest audits?

---

## 🟢 Yield Basis — six markets (yb-WBTC, yb-tBTC, yb-cbBTC × {yield-bearing, staked})

**What we track per market:** TVL (yield-bearing + staked split), APR
(30-day on-chain share-price delta), $YB emissions APR (staked variants),
share price, max-deposit, paused state.

**Sources:**
- Per-market LT contracts (e.g., `0xfBF3…E763` for yb-WBTC) (Ethereum)
- `GaugeController` (`0x1Be1…1c21`) and per-market gauges for emissions.
- CoinGecko for $YB price.

**Open questions / asks for Yield Basis team:**
1. **Gauge.totalSupply vs LT.staked discrepancy.** For yb-WBTC we see gauge.totalSupply = 254.39 yb-WBTC but LT.updated_balances.staked = 236.52. Different by ~7%. Is this a boost factor in gauge accounting, or do they track conceptually different things? Our emissions APR math uses LT staked count (matches dashboard within 0.1%) — want to confirm we're using the right denominator.
2. **$YB emissions schedule.** Is there a published halving / decay schedule for inflation? `preview_emissions` lets us project forward but we'd want to alert users if a step-down is coming.
3. **`staker` contract on the Factory's Market struct.** What's the difference between this and the gauge — same contract or distinct?
4. **Capacity per market.** `maxDeposit` exists on LT, but the dashboard sometimes shows markets as "At Capacity." Is the cap on LT, on the AMM, or both? What's the canonical "is this market full?" signal?
5. **Custody model and audit.** Marked as "multisig" in our system — confirm the threshold and link to the latest audit.

---

## 🟡 Hermetica hBTC

**What we track:** TVL (in BTC + USD), APY (7d/30d/90d from your API),
hBTC rate, remaining capacity.

**Sources:**
- API: `https://app.hermetica.fi/api/v2*` (5 endpoints, all parallel)
- No on-chain reads currently.

**Open questions / asks for Hermetica team:**
1. **hbtcPrice premium.** Your `/api/v2/hbtc/price` returns ~$81,500 today while spot BTC is ~$80,000. The ~1.3% delta only partly matches `hbtcRate` (1.013). What explains the rest? Secondary-market premium? Different oracle?
2. **APY methodology.** Your `apy?range=7d/30d/90d` returns realized yield — beautiful. Just confirming: is this share-price-delta-style (gross of fees) or net to the user?
3. **Capacity at zero.** `remaining_capacity` returns 0 across runs. Is the vault permanently full, or is this a temporary state pending deposit allowances? Any signal we can read to detect when it reopens?
4. **Rewards/emissions component.** If hBTC ever adds a token-rewards layer on top of base yield, what endpoint will expose it?
5. **Published SDK.** Your `@hermetica/sdk` npm package is "Proprietary" license. We're calling the endpoints directly to avoid the dep — confirm the endpoint URLs are stable.

---

## 🟡 Lombard Finance (LBTC bridge token)

**What we track:** TVL (LBTC totalSupply on Ethereum), APR (your `estimated-apy` analytics endpoint).

**Sources:**
- LBTC contract: `0x8236a87084f8B84306f72007F36F2618A5634494`
- API: `mainnet.prod.lombard.finance/api/v1/analytics/estimated-apy`

**Open questions / asks for Lombard team:**
1. **APR what's-it-measure?** `lbtc_estimated_apy` — is that the yield a passive LBTC holder receives, or the yield available if you deposit LBTC into Lombard Earn (LBTCv)? They aren't the same product and our taxonomy treats them differently.
2. **Multi-chain LBTC supply.** Currently we only read Ethereum mainnet `totalSupply()`. Do you publish a per-chain breakdown (e.g. Base, Sui, BNB)? An aggregated `totalSupply` across chains would be the more honest TVL number.
3. **Proof of Reserves.** Is the LBTC peg 1:1 backed by held BTC, and is there a Chainlink (or other) PoR feed we can verify against?
4. **Custody.** Marked as multisig — what's the threshold, who are the signers, what's the recovery flow if the multisig is compromised?

---

## 🟡 Lombard Earn (LBTCv vault)

**What we track:** TVL, APR, share price.

**Sources:**
- Vault contract: `0x5401b8620E5FB570064CA9114fd1e135fd77D57c` (Ethereum)
  — exposes ERC-20 surface but NOT ERC-4626 (`totalAssets`, `convertToAssets`, `pricePerShare` all revert).
- Lombard API: `/analytics/btce/apy/summary` for APR + breakdown
- Sevenseas API: `/sevenseas-api/daily-data/.../latest` for TVL + share price

**Open questions / asks for Lombard team:**
1. **ERC-4626 surface.** The vault has `totalSupply` and `decimals` but not `totalAssets` / `convertToAssets`. Is there a different on-chain function that gives BTC-denominated TVL? Or is the Sevenseas feed the only authoritative source?
2. **APR breakdown structure.** Your `apy/summary` returns a `breakdown` array. What are the components conceptually — base lending yield, restaking, points, emissions?
3. **Sevenseas dependency.** Sevenseas is currently a hard dependency for our TVL number. Is there an internal Lombard endpoint we should be using instead?

---

## 🟡 Solv BTC+ (multi-strategy)

**What we track:** TVL (USD), APR — both from `rest.sft-api.com/stats/btcplus`.

**Sources:**
- BTC+ token on BSC: `0x4Ca70811E831db42072CBa1f0d03496EF126fAad` (plain ERC-20, no on-chain NAV)
- Solv API (one endpoint)

**Open questions / asks for Solv team:**
1. **BTC+ NAV oracle.** The Solv PoR Chainlink feed on BSC (`0x81ca…9A42`) gives total BTC backing, but not per-token NAV. Is there a per-token NAV oracle we can read to verify the API's reported TVL?
2. **Strategy disclosure.** Your docs describe BTC+ as a "multi-strategy" product (DeFi, CEX, off-chain). Can you publish or share the current strategy allocations (% in each venue)?
3. **NAV-vs-PoR drift.** If BTC+ ever trades above or below the PoR-implied NAV, what should aggregators display — the API number, the PoR-implied NAV, or both?
4. **Fees.** Entry / management / performance fees, and where they accrue.
5. **Audit + signer set.** Standard custody disclosure.

---

## 🟡 Solv xSolvBTC (formerly SolvBTC.BBN)

**What we track:** Nothing yet — `solv-btc-plus` adapter currently labels
its symbol as `SolvBTC.BBN` but actually queries the BTC+ product. The
xSolvBTC product (Babylon-staked variant) isn't separately tracked.

**Source:** Contract `0xd9D920AA40f578ab794426F5C90F6C731D159DEf` (Ethereum)
plus the `SolvBTC.BBN / SolvBTC` exchange-rate oracle at
`0x1f34794A16D644b9810477EbF3f0b3870141E2e3`.

**Open questions:**
1. **Should xSolvBTC be its own adapter?** It's a separate product from BTC+ — Babylon staking, different yield mechanics. Aggregators should track them separately.
2. **Exchange-rate methodology.** The on-chain rate at `0x1f34…E2e3` — how often is it updated? What's the proof-of-yield mechanism?
3. **APR/APY endpoint** specific to xSolvBTC (separate from BTC+).

---

## 🟡 Maple BTC Yield (futures basis trading)

**What we track:** TVL (BTC denominated, from API) + APR (currently the
syrupUSDC pool's APR as a proxy — **this is misleading**).

**Sources:**
- Maple GraphQL: `nativePoolById('btc_yield')` for TVL only
- Maple GraphQL: `poolV2('0x80ac…cc0b')` (the **syrupUSDC** pool) for APR — proxy, not BTC-Yield-specific.

**Open questions / asks for Maple team:**
1. **BTC Yield-specific APR endpoint.** We did GraphQL field probing — `NativePool` exposes only `tvlNative`, `tvlUsd`, `nextEligibleMaturityBtcYieldDate`. No APY field. Can you expose a `currentApy` (or similar) on `NativePool` for BTC Yield depositors?
2. **Strategy disclosure.** Docs describe BTC Yield as "futures basis trading" (cash-and-carry between BTC futures and spot). Can you publish the historical realized APR for BTC Yield specifically (separate from your USDC lending pools)?
3. **Borrower visibility.** `nativeLoans` returns all borrowers commingled (USDC + BTC + internal). Can we filter to BTC-relevant loans? An `assetId` or `nativePoolId` field on `NativeLoan` would solve it.
4. **Maturity / lockup.** What's the actual deposit-to-redemption window for BTC Yield depositors?
5. **Custody + audits.** Standard disclosure.

---

## 🟡 Babylon (BTC staking)

**What we track:** TVL (active_tvl), APR (btc_staking_apr), finality
provider counts, active delegations, max-staking APR ceiling.

**Source:** `staking-api.babylonlabs.io/v2/stats`

**Open questions / asks for Babylon team:**
1. **Max-APR realization.** Today current APR is ~0.04% but `max_staking_apr` is 0.64% (~14× higher). What conditions would need to change for current APR to approach max?
2. **Slashing risk.** Has any slashing occurred? What's the historical incidence rate, and what's the loss given a slashing event?
3. **Validator quality.** Of 46 active / 131 total finality providers — is there a Sybil-resistance mechanism? How concentrated is voting weight?
4. **Cumulative delegations metric.** `total_active_delegations: 9,918` is the historical count, while `active_delegations: 1,109` is current. Worth flagging the difference in your API docs.

---

## 🔴 Merlin Chain BTC Staking (M-BTC)

**What we track:** TVL + APR currently scraped from your dashboard's
"Historical Average" — but **Merlin Seal is concluded**, so the "APR"
we display is a historical, not current, rate.

**Sources:**
- Dashboard scrape: `merlinchain.io/stakebtc` (Browserbase)
- M-BTC contract: `0xB880fd278198bd590252621d4CD071b1842E9Bcd` on Merlin Chain L2 (chain 4200)

**Open questions / asks for Merlin team:**
1. **Seal status confirmation.** Docs state Seal is concluded. Is there any current native-yield mechanism, or is yield exclusively via partner protocols now (Solv, Avalon, Mage, Babylon, StakeStone)?
2. **Recommended display.** What APR should we display for `M-BTC`? Today the "Historical Average" on your dashboard is several months stale. Should we display 0% with a "see partner protocols" note?
3. **Partner-protocol integration.** Is there an aggregated view of M-BTC currently deployed in each partner protocol, with weighted APR?
4. **Bridge custody.** Where does the BTC backing M-BTC actually sit? Is there a PoR feed?

---

## 🔴 Mezo Earn (veBTC NFT lock)

**What we track:** TVL + APR scraped from `mezo.org/earn/lock`.

**Open questions / asks for Mezo team:**
1. **Contract addresses.** Your public docs at `mezo.org/docs/users/resources/contracts-reference/` list MEZO, MUSD, Portal — but **not** the veBTC NFT contract, lock contract, fee distributor, or gauge contracts. Please publish these for Mezo Chain mainnet (chain 31612).
2. **Aggregate TVL function.** veBTC is an NFT, so `totalSupply()` returns count of NFTs, not BTC locked. Is there a `totalLockedBtc()` (or similar) aggregator on the lock contract?
3. **APR methodology.** The dashboard displays a single "X% APR" number. We assume that's the max-boost / max-duration estimate. Can you confirm — and publish the formula (so we can match it on-chain)?
4. **Fee distributor.** Per docs, yield comes from swap fees, MUSD lending revenue, and bridging/transaction fees. Is there a single fee-distributor contract that accumulates these, that we can read for per-epoch yield-to-veBTC numbers?
5. **Epoch boundary.** Epochs are 7 days, Thursday 00:00 UTC. Is there a published "current epoch" view function?

---

## 🟢 Stacks ecosystem — `stacks`, `stacks-dual-stacking`, `stacks-dual-stacking-boosted`, `zest-protocol`

**What we track:** TVL + APR via Hiro API and Stacks contract reads.

**Open questions / asks:**
1. **DegenLab API stability.** We pull cycle data from DegenLab v3 (`next_cycle_*` fields). Is this considered stable for production use? Any rate limits we should know about?
2. **sBTC supply** is read from the canonical Stacks contracts; is there a single sBTC ledger contract or are we summing balances?
3. **Forward APR vs realized.** We use "next-cycle" APR — confirm this matches what your dashboards display.

---

## 🟢 Lightning (`lightning-network`, `amboss`, `amboss-magma`)

**What we track:** Network-level Lightning TVL (mempool.space) + node-routing yield (Amboss).

**Open questions / asks for Amboss team:**
1. **Magma yield methodology.** Your two-query GraphQL gives us a yield figure — is it a 30d trailing rate, forward-looking estimate, or something else?
2. **Capacity changes.** How quickly do channel-capacity-based yields adjust to liquidity shifts?
3. **API key rotation.** What's your policy on long-lived API keys (we're using `BITCOINYIELD_AMBOSS_API_KEY`)?

---

## 🟡 Morpho Gauntlet WBTC Core

**What we track:** Hybrid adapter (May 2026 rewrite).
- **TVL on-chain** via `totalAssets()` on vault `0x443d…f9b2` (matches Morpho UI's `$5.62M` / 69.23 WBTC within ~1%).
- **APR from Morpho's GraphQL API** (`vaultByAddress.state.netApy`) — matches Morpho's UI exactly (1.21%).
- **Realized 30d** kept as `metadata.apy30dRealized` (currently 2.09%) for transparency / drift detection.

**Why hybrid:** this is a lending vault with variable utilization. The vault holds idle liquidity (~$3.2M) + active loans (~$2.4M). When utilization shifts, the realized 30d share-price growth diverges from the forward Net APY:
- Realized = "what depositors earned over the past 30 days"
- Forward (Morpho's API) = "what new depositors will earn at current utilization"

For lending vaults, the forward number is what users care about and what every aggregator (including Morpho's own UI) displays. The on-chain share-price delta — which works perfectly for pure-strategy vaults like Acre/Botanix/Yield Basis where there's no idle cash drag — gives a misleading "wrong number" for lending vaults.

**Open questions / asks for Gauntlet team:**
1. **Strategy curator methodology.** Published methodology for risk parameters, vault allocations, and rebalancing decisions?
2. **Performance fee disclosure.** What % of yield does Gauntlet take as curator fee? It's already netted out of `netApy` but worth publishing.
3. **List of underlying markets.** Which Morpho Blue markets does this vault currently route into? Helps users understand what's actually generating their yield.

**Future engineering note:** on-chain Net APY reconstruction is **possible** but expensive. Would require reading the vault's supplyQueue + position(marketId) per market, looking up each Morpho Blue market's borrowRate via its IRM contract, weighting by supplied amount, and subtracting `vault.fee()`. ~150 LOC + three contract ABIs (MetaMorpho, Morpho Blue singleton, IRM interface). **Not worth it for one vault**, but if we onboard 3+ MetaMorpho-curated products (other Gauntlet vaults, Steakhouse, Re7, etc.), build a shared `morphoVaultSupplyRate()` helper and switch all of them off the API at once.

---

## 🔴 Starknet BTC Staking

**What we track:** TVL + APR via Voyager API (third-party, requires API key).

**Open questions / asks for Starknet / Voyager teams:**
1. **Official Starknet data source.** Voyager is a block explorer — is there an official Starknet Foundation endpoint for staking stats?
2. **Voyager key rotation.** Same as Amboss — policy on long-lived keys.
3. **Backup data source.** If Voyager goes down, what's the next-best source?

---

## 🟡 zenBTC (Zenrock)

**What we track:** TVL, APR, exchange rate from
`backend-api.diamond.zenrocklabs.io`.

**Open questions / asks for Zenrock team:**
1. **Solana mint address.** zenBTC lives on Solana (CA: `9hX59xHHnaZXLU6quvm5uGY2iDiT3jczaReHy6A6TYKw`). Can we read totalSupply directly from the SPL mint to cross-check your API's `tokenSupply` field?
2. **Yield mechanism.** Docs state yield is "paid directly in sats on the Bitcoin blockchain, distributed daily." What Bitcoin addresses do payouts originate from? With those, we could verify historical APR independently.
3. **Exchange rate semantics.** Your API returns `exchangeRate` ~1.013. Does the zenBTC mint price grow with this, or does it stay at 1:1 and yield is purely external?
4. **Custody.** Marked as MPC — what's the signer set?

---

## 🟡 Coinbase BTC Yield Fund + Sypher Capital

**What we track:** Manual constants (no API, no on-chain).

**Open questions / asks:**
1. **Official APR endpoint or disclosure cadence.** What's the canonical source we should poll quarterly (or monthly) for the latest APR?
2. **AUM / TVL.** Same question.
3. **Performance fee structure.** Disclosed?
4. **Audit/attestation.** For Coinbase, BPM PFA attestations exist — link to latest. For Sypher Capital, what's the equivalent?

---

## 🟢 Acre Mezo (`acre-mezo`)

See Acre BTC section above — same protocol. Slug name `acre-mezo` is
historical from Acre V1 era (used to route through Mezo); V2 routes through
Midas. Renaming the slug would be a main-app migration, deferred.

---

## Summary table — quick triage

| Adapter | Status | Primary missing data |
|---|---|---|
| acre-mezo | 🟢 working on-chain | strategy %, queue wait time, oracle SLA |
| botanix | 🟢 working on-chain | yield-source narrative (fees vs Morpho?), pBTC peg mechanism |
| yb-* (×6) | 🟢 working on-chain | $YB emission schedule, gauge vs LT staked discrepancy |
| lombard-finance | 🟡 hybrid | LBTC APR definition, multi-chain supply |
| lombard-earn | 🟡 hybrid | on-chain NAV function, breakdown semantics |
| hermetica-hbtc | 🟡 hybrid (API) | price-vs-rate discrepancy, capacity reopen signal |
| solv-btc-plus | 🟡 hybrid | per-token NAV oracle, strategy allocations |
| solv-btc-bbn (not yet adapted) | 🟡 needs separation | mechanics distinct from BTC+ |
| maple-bitcoinyield | 🔴 APR is proxy | BTC-Yield-specific APR endpoint |
| babylon | 🟢 API working | slashing history, max-APR realization |
| merlin-btc | 🔴 stale APR | Seal status, partner-protocol weighted yield |
| mezo-earn | 🔴 contracts not published | veBTC address, TVL aggregator, APR formula |
| stacks-* | 🟢 working on-chain | DegenLab stability |
| zest-protocol | 🟢 working on-chain | — |
| lightning, amboss, amboss-magma | 🟢 working | yield methodology |
| morpho-gauntlet | 🟢 hybrid (TVL on-chain, APR from API) | strategy methodology, fee disclosure |
| starknet | 🟡 third-party API | official Starknet data source |
| zenrock-zenbtc | 🟡 API only | Solana mint cross-check, BTC payout addresses |
| coinbase-btc-yield-fund | 🟡 manual | official polling endpoint |
| sypher-capital | 🟡 manual | official polling endpoint |

---

## What "good" looks like

For us to switch any adapter from `🟡 hybrid` or `🔴 blocked` to `🟢 fully
on-chain`, a protocol needs to expose at least:

1. **TVL** — either an aggregator view function (preferred) or a documented
   API endpoint with a stable schema.
2. **APR** — either share-price-growth-derivable, an emissions feed with
   gauge weights, OR a clean API endpoint with documented methodology.
3. **Capacity + paused state** — `maxDeposit()` and `paused()` are the
   gold standard.
4. **Custody disclosure** — multisig threshold, signers, audits, pause
   authority.

The companion document `new-protocol-onboarding-checklist.md` formalizes
this as a checklist new protocols can fill in upfront.

---

## Framework lesson learned: vault type determines the right APR pattern

After building all 24 adapters, an important nuance: **share-price-delta
APR works perfectly for some vault types and is misleading for others.**

| Vault type | Right APR source | Why |
|---|---|---|
| **Strategy vault** (Acre, Botanix, Yield Basis) | On-chain share-price delta | Every asset is always deployed in the strategy. No idle cash drag. Realized over 30d ≈ what new depositors will earn. |
| **Lending vault** (Morpho Gauntlet) | Protocol's forward-rate API | Vault holds idle liquidity + active loans. Utilization shifts cause realized 30d to diverge from current rate. The forward rate is what users care about. |
| **Off-chain strategy** (SolvBTC+, Maple BTC Yield, Coinbase) | Protocol's API | Yield comes from off-chain venues; no on-chain share-price growth to read. |
| **Wrapper-only** (LBTC, M-BTC) | Downstream product's API or `apr: 0` | Yield doesn't accrue to the wrapper itself; user has to opt into a yield-bearing destination. |
| **veToken NFT** (Mezo Earn) | Complex — emissions × gauge weights / locked supply | Requires the protocol's lock contract addresses + per-epoch reward distribution data. |

When extending the framework with new adapters, **classify the vault type
first**, then pick the matching pattern. Mixing methodologies in the same
APR column across protocols is misleading to users comparing across rows.
