# Lombard

Adapter for [Lombard Finance](https://www.lombard.finance), issuer of LBTC — a yield-bearing Bitcoin wrapper. LBTC yield originally came from Babylon staking; in August 2026 Lombard moved it to an institutional covered-call options strategy managed by Bitwise Investment Manager (target 2.5% net APY in BTC terms), with yield accruing through a rising LBTC/BTC exchange rate rather than rebasing or payouts.

## Data sources

Everything comes from the LBTC ERC-20 contract (`0x8236...4494`) on Ethereum mainnet — no Lombard API dependency:

- **TVL**: `totalSupply()` valued at the LBTC/BTC exchange rate from the token's own `getRate()` (BTC per LBTC, 18 decimals; `ratio()` is the inverse). This is **circulating LBTC on Ethereum only**, not the protocol-wide total BTC backing. See "Why this approach" below.
- **APY**: 30-day annualized growth of `getRate()` via `readShareGrowth` archive reads — we measure holder-experienced yield ourselves rather than trusting a reported figure. The 7-day window is recorded in metadata as a shadow metric; if the 30d archive read fails, 7d serves as fallback (`metadata.rateWindow` records which was used).
- **BTC price**: from the framework's `prices.getBtc()` (CoinGecko, cached)

The previous APY source (`/api/v1/analytics/estimated-apy` → `lbtc_estimated_apy`) was gutted in the covered-call transition — it now returns `{}`, which is what broke the adapter on 2026-08-28. Cross-checks for the on-chain rate: Lombard's transparency API (`https://api.lombard.finance/v2/transparency/reports/latest`, Bitwise-signed daily records, human-viewable at [lombard.finance/transparency/lbtc](https://www.lombard.finance/transparency/lbtc)) and the Chainlink LBTC/BTC feed on mainnet. Note the rate is still *posted* by Lombard's consortium oracle — on-chain reads change the transport, not the publisher.

## APR floor

During the strategy's deployment ramp (staged from a $10M pilot the week of 2026-08-17 toward 50–60% of TVL), the measured figure can legitimately be ~0 or slightly negative (single-day re-marks against near-zero accrual). The adapter floors `apr` at 0, keeps the raw figure in `metadata.rawApy`, and sets `metadata.allowZeroApr` only when the raw figure is negative — so a frozen rate reading exactly 0 growth still fails loudly in normalize. The 2.5% target is recorded as `metadata.targetApyPct`, never used as the headline figure.

## Required environment

- `BITCOINYIELD_RPC_ETHEREUM` — any Ethereum JSON-RPC endpoint. Falls back to `https://cloudflare-eth.com` (rate-limited but works for testing).

## Cost estimate

~3 requests per hour:
- 1 multicall (totalSupply + decimals via one batched call)
- 1 HTTP call to Lombard's API
- 1 BTC price fetch (cached across all adapters in the same run)

Free tier on Alchemy/Infura easily covers this.

## Why this approach

We read Ethereum `totalSupply` directly because it's a simple, dependency-free
on-chain read. The tradeoff is that it **undercounts**: LBTC is natively issued
cross-chain (Base, BNB, Sonic, Sui, …) via CCIP burn-and-mint, so Ethereum holds
only part of the circulating supply.

The protocol-wide figure (~$960M) is the total custodied BTC backing all LBTC
across every chain. That **cannot** be reproduced from EVM `totalSupply` reads:
summing all EVM chains (Ethereum + Base + BNB + Sonic) still only reaches ~$673M;
the rest is on non-EVM chains (Sui). The authoritative way to get it is Lombard's
own `/api/v1/addresses` custody list — page every BTC deposit address and sum its
on-chain balance.

This adapter is intentionally left Ethereum-only rather than take on that work
(a Bitcoin-indexer dependency + custody-address paging + blacklist maintenance).
If the protocol-wide number is needed later, build it from the Lombard custody
addresses above.
