# Lombard

Adapter for [Lombard Finance](https://www.lombard.finance), a Bitcoin liquid staking protocol that issues LBTC against staked Bitcoin.

## Data sources

- **TVL**: `totalSupply()` on the LBTC ERC-20 contract (`0x8236...4494`) at Ethereum mainnet, divided by `decimals()`. This is the canonical on-chain supply, not an aggregator's cached estimate.
- **APY**: `lbtc_estimated_apy` from `https://mainnet.prod.lombard.finance/api/v1/analytics/estimated-apy`
- **BTC price**: from the framework's `prices.getBtc()` (DefiLlama coins API, cached)

## Required environment

- `BITCOINYIELD_RPC_ETHEREUM` — any Ethereum JSON-RPC endpoint. Falls back to `https://cloudflare-eth.com` (rate-limited but works for testing).

## Cost estimate

~3 requests per hour:
- 1 multicall (totalSupply + decimals via one batched call)
- 1 HTTP call to Lombard's API
- 1 BTC price fetch (cached across all adapters in the same run)

Free tier on Alchemy/Infura easily covers this.

## Why this approach

Earlier the adapter pulled TVL from `defillama-datasets.llama.fi/lite/v2/protocols`, which aggregated multiple buckets and reported ~$1.6B vs the actual ~$1.03B on-chain (a ~$600M overestimate). Reading `totalSupply` directly from the ERC-20 is authoritative.
