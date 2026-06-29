# Kraken Advanced Strategies BTC

Tracks Kraken Advanced Strategies BTC (`sentoraBTC`) on Ink directly from the vault and accountant contracts.

## Data sources

- **Chain**: Ink mainnet (`chainId = 57073`)
- **Vault**: `0x7Dee0120739b7ec048B469939EFB178ADbbB19B2`
- **Accountant**: `0x4Bb6C416a00561ad6657110b76552c42d55Ff1d6`
- **Public RPC fallbacks**:
  - `https://rpc-gel.inkonchain.com`
  - `https://rpc-qnd.inkonchain.com`

## TVL

TVL is read from the BoringVault share supply and the accountant exchange rate:

```text
tvlRaw = vault.totalSupply() * accountant.getRate() / 1e8
tvlBtc = tvlRaw / 1e8
```

Both the vault share token and accountant rate currently report 8 decimals. The adapter still reads decimals on-chain and uses the returned values.

## APY

The headline `apr` field is the 7-day compounded APY because the adapter schema stores the headline rate in `apr`.

The adapter reads:

- `accountant.getRate()` at latest block
- `accountant.getRate()` at `latestBlock - 604,800`

Ink currently produces one block per second, so `604,800` blocks is approximately seven days. The adapter also reads both block timestamps and uses the actual elapsed days in the annualization:

```text
growth = currentRate / historicalRate
compoundedApy7d = (growth ^ (365 / actualElapsedDays) - 1) * 100
```

This avoids `eth_getLogs` range limits and does not need stored adapter history.

## Environment

Optional:

```bash
BITCOINYIELD_RPC_INK=https://your-ink-rpc.example
```

The adapter declares `requires.secrets = ["RPC_INK"]`, so the runner exposes this value as `ctx.env.RPC_INK`. If unset, it uses Ink's public RPCs.

## Cost estimate

Roughly 8 JSON-RPC calls per run:

- latest block
- historical block
- vault decimals
- accountant decimals
- vault total supply
- latest accountant rate
- historical accountant rate
- accountant state

The accountant state call is metadata-only but useful for sanity checks such as pause state and fee settings.
