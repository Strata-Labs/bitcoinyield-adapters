# Stacking DAO stBTC

Liquid sBTC staking on Stacks. stBTC is an 8-decimal share token over sBTC held by `stbtc-reserve` and deployed to protocol bonds. This adapter covers **stBTC only** — not stSTX, stSTXbtc, or protocol-wide TVL.

## Data sources

All reads are on-chain, via Hiro. Deployer: `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG`.

- **TVL:** `stbtc-reserve.get-total-sbtc` (sats) — idle reserve balance plus staked principal, gross of sBTC locked for pending withdrawals. This is the figure the Stacking DAO app shows as stBTC TVL.
- **APY:** 30-day compounded growth of `data-stbtc-v1.get-sbtc-per-stbtc` (1e8-scaled), `rateType: "apy"`. The current read and the baseline read are both pinned to a block with `callReadOnly({ tip })`; the baseline is the last block at or before `latest − 30 days`, found by `stacks.findBlockAtTime`. The window uses the two blocks' actual timestamps.

The contract computes the ratio as active backing (total minus withdrawal reserves) over active supply (supply minus pending withdrawal shares), so the adapter doesn't re-derive it. When no stBTC exists that ratio is pinned to exactly 1.0, so the adapter also requires a positive `stbtc-token.get-total-supply` at the baseline block; otherwise a pre-launch baseline would read as growth.

A losing window is published negative. A flat window (rate exactly 0) fails normalize on purpose: a ratio that hasn't moved in 30 days means rewards stopped flowing, and that should page rather than store 0%.

## Cost

One latest-block read, around ten block reads for the baseline search (9 on the October 16, 2026 run), and four read-only calls. No secrets. Set `BITCOINYIELD_STACKS_API` to route through a keyed Hiro endpoint.

Custody is `multisig`: sBTC rests on the sBTC signer set, and the reserve is administered by Stacking DAO's DAO-controlled contracts.
