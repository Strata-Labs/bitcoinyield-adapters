
import {
  defineAdapter,
  math,
  http,
  parseNumber,
  requirePositive,
} from "@bitcoinyield/adapters";

const SOLV_STATS = "https://api.solvprotocol.org/btcplus/stats";

interface SolvResponse {
  tvl: string;
  tvlUsd: string;
  baseApy: string;
  rewardApy: string;
}

export default defineAdapter({
  slug: "solv-btc-plus",
  name: "Solv BTC+",
  url: "https://solv.finance",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const data = await http.get<SolvResponse>(SOLV_STATS);

    const baseApy = requirePositive(data.baseApy, "baseApy");
    const rewardApy = parseNumber(data.rewardApy, 0);

    return [
      {
        symbol: "BTC+",
        tvlBtc: requirePositive(data.tvl, "tvl"),
        tvlUsd: requirePositive(data.tvlUsd, "tvlUsd"),
        apr: math.add(baseApy, rewardApy),
        metadata: { baseApy, rewardApy },
      },
    ];
  },
});
