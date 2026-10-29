# Zest Protocol

Adapter for [Zest Protocol](https://zestprotocol.com), a Bitcoin lending market built on Stacks. Users supply sBTC and earn Zest's on-chain lending APY.

## Data sources

- **TVL**: `get-total-assets` on the Stacks Market V2 sBTC vault (`v0-vault-sbtc`) — lent-out plus idle sBTC, the "Total Supplied" figure on Zest's sBTC page. Converted from satoshis (8 decimals) to BTC. The vault's token balance is only the idle slice (~0.2% at current utilization), so it isn't used. Excluded: non-rehypothecated collateral (not lent, earns nothing) and the V1 `pool-vault` (closed to new activity, 0% supply APY).
- **Supply APY**: read directly from the `v0-rates` Clarity contract (`get-rates-sbtc` function) on Stacks. Spot rate, reported as `apy`; the read throws if it's missing or zero.
- **BTC price**: framework's `prices.getBtc()`. sBTC is treated as BTC 1:1 for USD valuation.

## Rate

Supply APY only. Until 2026-09-22 the adapter added DegenLab's sBTC dual-stacking APR on top; that was dropped when the adapter was re-enabled on 2026-10-29.

## File structure

- `index.ts` — adapter entry, wires everything together
- `vaults.ts` — reads total sBTC supplied to the V2 vault
- `rates.ts` — fetches supply APY (on-chain)
- `constants.ts` — addresses + token identifiers

This split is purely for readability — the framework treats it as one adapter (only `index.ts` matters; the framework's loader follows the default export).

## Required environment

None for the public Hiro API. Optionally:

- `BITCOINYIELD_STACKS_API` — override Hiro's base URL (default `https://api.hiro.so`)

## Cost estimate

~3 requests per hour:

- 2 Hiro read-only contract calls (vault total assets, rates)
- 1 BTC price (cached across all adapters)
