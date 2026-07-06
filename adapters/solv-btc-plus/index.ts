/**
 * Solv BTC+ adapter — single HTTP endpoint returns apy + tvl.
 */

import {
  defineAdapter,
  http,
  math,
  prices,
  requirePositive,
} from "@bitcoinyield/adapters";

const SOLV_STATS = "https://rest.sft-api.com/stats/btcplus";

interface SolvResponse {
  apy: string;
  tvl: string;
}

export default defineAdapter({
  slug: "solv-btc-plus",
  name: "Solv BTC+",
  url: "https://solv.finance",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const [data, btcPrice] = await Promise.all([
      http.get<SolvResponse>(SOLV_STATS),
      prices.getBtc(),
    ]);

    const apr = requirePositive(data.apy, "apy");
    const tvlUsd = requirePositive(data.tvl, "tvl");

    return [
      {
        symbol: "BTC+",
        tvlBtc: math.div(tvlUsd, btcPrice),
        tvlUsd,
        apr,
      },
    ];
  },
});
