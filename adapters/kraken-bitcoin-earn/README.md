# Kraken Bitcoin Earn

Adapter for [Kraken Bitcoin Earn](https://www.kraken.com/earn) — Kraken's
custodial BTC yield product, implemented as a BoringVault on Ink L2
(Kraken's own chain, id 57073).

## Data sources

- **TVL**: `vault.totalSupply()` × `accountant.getRate()` — shares
  outstanding times BTC-per-share rate, both read on-chain.
  - BoringVault: `0x7Dee0120739b7ec048B469939EFB178ADbbB19B2`
  - Accountant: `0x4Bb6C416a00561ad6657110b76552c42d55Ff1d6`
- **APR**: 7-day annualized growth of `getRate()` (via `readShareGrowth`),
  matching the "Net APY (7D)" window Kraken's public Dune dashboard uses.
  Requires an archive read at ~604,800 blocks back (Ink ≈ 1 block/sec).
- **BTC price**: framework's `prices.getBtc()` (CoinGecko, cached).

## Required environment

- `BITCOINYIELD_RPC_INK` — dedicated Ink RPC. Falls back to public
  endpoints (`rpc-gel.inkonchain.com`, drpc); without archive support the
  APR falls back to a seed value and `metadata.aprSource` reports
  `seed-fallback` instead of `onchain-7d`.

## Cost estimate

~7 RPC reads per hour (3 current-state reads, plus readShareGrowth's two
block headers and two rate reads) and one cached BTC price fetch. Free tier
on any provider covers this.
