/**
 * Amboss Lightning Liquidity adapter.
 * Pulls deployed Lightning liquidity (BTC) via Amboss's GraphQL API.
 * APR is fixed at 1% (no canonical yield endpoint available).
 *
 * Requires AMBOSS_API_KEY (set via BITCOINYIELD_AMBOSS_API_KEY in production).
 */

import { defineAdapter, http, requirePositive } from "@bitcoinyield/adapters";

const AMBOSS_API = "https://api.amboss.space/graphql";

const QUERY = `query GetDeployedLiquidity {
  rails {
    stats {
      total_btc_graph {
        data { deployed_liquidity { btc sats } date }
      }
    }
  }
}`;

interface AmbossData {
  rails?: {
    stats?: {
      total_btc_graph?: {
        data?: Array<{ deployed_liquidity: { btc: string }; date: string }>;
      };
    };
  };
}

export default defineAdapter({
  slug: "amboss",
  name: "Amboss",
  url: "https://amboss.space",
  category: "lp",
  custody: "self",
  requires: { secrets: ["AMBOSS_API_KEY"] },

  async fetch(ctx) {
    const apiKey = ctx.env.AMBOSS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AMBOSS_API_KEY is required (set BITCOINYIELD_AMBOSS_API_KEY)",
      );
    }

    const data = await http.graphql<AmbossData>(
      AMBOSS_API,
      QUERY,
      {},
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    const points = data.rails?.stats?.total_btc_graph?.data;
    if (!Array.isArray(points) || points.length === 0) {
      throw new Error("Invalid Amboss response: empty graph data");
    }

    // Pick by date instead of assuming the series' sort order — reading a
    // fixed end of the array reports a stale datapoint forever if the API's
    // ordering isn't what we guessed.
    const latest = points.reduce((a, b) =>
      new Date(b.date).getTime() > new Date(a.date).getTime() ? b : a,
    );
    const tvlBtc = requirePositive(
      latest.deployed_liquidity.btc,
      "deployed_liquidity.btc",
    );

    return [
      {
        symbol: "BTC",
        tvlBtc,
        rate: null,
        rateUnavailableReason:
          "RAILS capacity does not expose a verifiable aggregate product yield",
      },
    ];
  },
});
