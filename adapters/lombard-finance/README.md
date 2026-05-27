# Lombard

Adapter for [Lombard Finance](https://www.lombard.finance), a Bitcoin liquid staking protocol that issues LBTC against staked Bitcoin.

## Data sources

- **TVL**: `totalSupply()` on the LBTC ERC-20 contract (`0x8236...4494`) at Ethereum mainnet, divided by `decimals()`. This is **circulating LBTC on Ethereum only** (~$650M), not the protocol-wide total BTC backing (~$960M). See "Why this approach" below.
- **APY**: `lbtc_estimated_apy` from `https://mainnet.prod.lombard.finance/api/v1/analytics/estimated-apy`
- **BTC price**: from the framework's `prices.getBtc()` (CoinGecko, cached)

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
