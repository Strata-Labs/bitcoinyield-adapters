/**
 * Babylon adapter — Bitcoin staking protocol.
 *
 * TVL: `total_active_tvl` from staking-api.babylonlabs.io (in satoshis).
 * APR: `btc_staking_apr` (decimal rate, scaled to percent).
 */

import {
  defineAdapter,
  http,
  math,
  requirePositive,
} from "@bitcoinyield/adapters";

const BABYLON_API = "https://staking-api.babylonlabs.io/v2/stats";

interface BabylonResponse {
  data: {
    active_tvl: number;
    total_active_tvl: number;
    btc_staking_apr: number;
    max_staking_apr: number;
    active_finality_providers: number;
    total_finality_providers: number;
    active_delegations: number;
  };
}

export default defineAdapter({
  slug: "babylon",
  name: "Babylon",
  url: "https://babylonlabs.io",
  category: "staking",
  custody: "self",

  async fetch() {
    const response = await http.get<BabylonResponse>(BABYLON_API, {
      headers: { Accept: "application/json" },
    });

    if (!response.data)
      throw new Error("Invalid Babylon API response: missing data");

    const tvlSatoshis = requirePositive(
      response.data.total_active_tvl,
      "total_active_tvl",
    );
    const rawApr = requirePositive(
      response.data.btc_staking_apr,
      "btc_staking_apr",
    );

    // Never negative in a healthy state; clamp to 0 in case the API drifts.
    const pendingSatoshis = Math.max(
      0,
      response.data.total_active_tvl - response.data.active_tvl,
    );

    return [
      {
        symbol: "BTC",
        tvlBtc: math.fromUnits(tvlSatoshis, 8),
        apr: math.toPercent(rawApr),
        metadata: {
          maxAprPercent: math.toPercent(response.data.max_staking_apr),
          activeFinalityProviders: response.data.active_finality_providers,
          totalFinalityProviders: response.data.total_finality_providers,
          activeDelegations: response.data.active_delegations,
          pendingTvlBtc: math.fromUnits(pendingSatoshis, 8),
        },
      },
    ];
  },
});
