# Solv BTC+

This adapter reads Solv BTC+ directly from Solv's deployed on-chain oracle
contracts instead of the retired `https://rest.sft-api.com/stats/btcplus`
endpoint.

## Contract sources

Solv publishes the BTC+ yield-token deployment map and oracle interface in the
SolvBTC repository:

- [`20399_export_SolvBTCYTV3Infos.js`](https://github.com/solv-finance/SolvBTC/blob/main/deploy/SolvBTCYieldToken/20399_export_SolvBTCYTV3Infos.js)
- [`SolvBTCYieldTokenOracleForSFT.sol`](https://github.com/solv-finance/SolvBTC/blob/main/contracts/oracle/SolvBTCYieldTokenOracleForSFT.sol)

For each supported chain, the adapter reads:

- BTC+ ERC-20 `totalSupply()`
- `SolvBTCYieldTokenOracleForSFT.navDecimals(token)`
- `SolvBTCYieldTokenOracleForSFT.sftOracles(token)`
- the resolved SFT NAV oracle's `getSubscribeNav(poolId, timestamp)`

## Rate calculation

`apr` is the trailing seven-day NAV APY:

```text
((current_nav / nav_7d_ago) ^ (365 / elapsed_days) - 1) * 100
```

The public adapter schema calls the field `apr`, so this adapter stores the
NAV-derived APY there and includes `metadata.rateKind = "nav-apy"`.

## TVL calculation

TVL is BTC-denominated and computed per deployment:

```text
BTC+ totalSupply * current NAV
```

The headline TVL sums all successful configured deployments. The headline rate
is TVL-weighted across fresh NAV feeds only. Smaller deployments with stale NAV
feeds remain in TVL when their contracts respond, but they do not dilute the
headline APY.

Primary deployments are Ethereum, BNB Chain, Base, and Arbitrum. If any primary
deployment cannot be read, the adapter fails so the runner can retry instead of
persisting a partial headline rate.

Optional RPC overrides:

- `BITCOINYIELD_RPC_ETHEREUM`
- `BITCOINYIELD_RPC_BSC`
- `BITCOINYIELD_RPC_BASE`
- `BITCOINYIELD_RPC_ARBITRUM`
- `BITCOINYIELD_RPC_AVALANCHE`
- `BITCOINYIELD_RPC_BOB`
- `BITCOINYIELD_RPC_BERACHAIN`
- `BITCOINYIELD_RPC_HYPEREVM`
