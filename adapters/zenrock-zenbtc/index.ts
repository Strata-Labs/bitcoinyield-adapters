/**
 * Zenrock zenBTC adapter — Bitcoin yield via Zenrock's Diamond protocol.
 * Single HTTP endpoint returns supply (sats), exchange rate, and APY.
 */

import { defineAdapter, http, math, parseNumber } from "@bitcoinyield/adapters";

const ZENROCK_API =
  "https://backend-api.diamond.zenrocklabs.io/api/v1/zenbtc/yield?limit=10&offset=0";

interface ZenrockResponse {
  tokenSupply: string;
  exchangeRate: string;
  stats: {
    totalBtcYielded: number;
    exchangeRate: string;
    yieldAPY: number;
  };
}

export default defineAdapter({
  slug: "zenrock-zenbtc",
  name: "Zenrock zenBTC",
  url: "https://zenrocklabs.io",
  category: "yield-bearing",
  custody: "mpc",

  async fetch() {
    const data = await http.get<ZenrockResponse>(ZENROCK_API, {
      headers: { Accept: "application/json" },
    });

    return [
      {
        symbol: "zenBTC",
        tvlBtc: math.fromUnits(parseNumber(data.tokenSupply, 0), 8),
        apr: data.stats?.yieldAPY ?? 0,
        metadata: {
          exchangeRate: data.exchangeRate,
          totalBtcYielded: data.stats?.totalBtcYielded,
        },
      },
    ];
  },
});
