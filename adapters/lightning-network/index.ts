/**
 * Lightning Network adapter.
 * TVL: total_capacity in satoshis from mempool.space.
 * APR: fixed at 1.0% (no canonical yield source for Lightning).
 */

import {
  defineAdapter,
  http,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const MEMPOOL_API = "https://mempool.space/api/v1/lightning/statistics/latest";

interface MempoolResponse {
  latest: { total_capacity: number };
}

export default defineAdapter({
  slug: "lightning-network",
  name: "Lightning Network",
  url: "https://lightning.network",
  category: "lp",
  custody: "self",

  async fetch() {
    const data = await http.get<MempoolResponse>(MEMPOOL_API);
    const capacitySats = requirePositive(
      data?.latest?.total_capacity,
      "latest.total_capacity",
    );

    return [
      {
        symbol: "BTC",
        tvlBtc: math.fromUnits(capacitySats, 8),
        apr: 1.0,
      },
    ];
  },
});
