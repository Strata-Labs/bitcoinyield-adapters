/**
 * Shared Yield Basis Real Yield adapter.
 *
 * APR is Yield Basis's official 7-day fundamental trading APY
 * (`tradingApy1w`). That is the same trailing window most BitcoinYield
 * adapters publish, and it avoids ranking the all-time / inception figure
 * that the dashboard still shows as FT APY. TVL stays on-chain.
 */

import type { Address } from "viem";

import { defineAdapter } from "../../src/core/defineAdapter.js";
import type { Adapter } from "../../src/core/types.js";
import * as ethereum from "../../src/core/utils/chains/ethereum.js";
import * as http from "../../src/core/utils/http.js";
import * as math from "../../src/core/utils/math.js";
import { requirePositive } from "../../src/core/utils/validators.js";

const YIELDBASIS_API = "https://api.yieldbasis.com";
const RATE_DECIMALS = 18;
const FORMULA_VERSION = "yieldbasis-trading-apy-1w-v1";

const yieldBasisLtAbi = [
  {
    inputs: [],
    name: "pricePerShare",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "updated_balances",
    outputs: [
      { name: "supply", type: "uint256" },
      { name: "staked", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface YieldBasisYieldBearingConfig {
  slug: string;
  name: string;
  symbol: string;
  marketId: string;
  ltAddress: Address;
  assetAddress: Address;
  assetDecimals: number;
}

export interface YieldBasisSevenDayApy {
  marketId: string;
  bucketStart: number;
  apyRaw: string;
  sourceTimestamp: string;
}

export interface YieldBasisYieldBearingDependencies {
  readBalances(ltAddress: Address): Promise<readonly [bigint, bigint]>;
  readSharePrice(ltAddress: Address): Promise<bigint>;
  getSevenDayApy(marketId: string): Promise<YieldBasisSevenDayApy>;
}

interface YieldBasisTradingApyResponse {
  success: boolean;
  data: Array<{
    bucketStart: number;
    marketId: string;
    tradingApy1w?: string | null;
  }>;
  timestamp: string;
}

export function selectLatestSevenDayApy(
  response: YieldBasisTradingApyResponse,
  marketId: string,
): YieldBasisSevenDayApy {
  if (!response.success || response.data.length === 0) {
    throw new Error(`YieldBasis market ${marketId}: no trading APY data`);
  }

  const rows = response.data.filter((row) => row.marketId === marketId);
  if (rows.length === 0) {
    throw new Error(`YieldBasis market ${marketId}: no trading APY data`);
  }

  const latest = rows.reduce((current, row) =>
    row.bucketStart > current.bucketStart ? row : current,
  );
  if (latest.tradingApy1w == null || latest.tradingApy1w === "") {
    throw new Error(`YieldBasis market ${marketId}: 7d APY is missing`);
  }

  return {
    marketId: latest.marketId,
    bucketStart: latest.bucketStart,
    apyRaw: latest.tradingApy1w,
    sourceTimestamp: response.timestamp,
  };
}

export const productionYieldBasisYieldBearingDependencies: YieldBasisYieldBearingDependencies =
  {
    async readBalances(ltAddress) {
      return await ethereum.getClient().readContract({
        address: ltAddress,
        abi: yieldBasisLtAbi,
        functionName: "updated_balances",
      });
    },
    async readSharePrice(ltAddress) {
      return await ethereum.getClient().readContract({
        address: ltAddress,
        abi: yieldBasisLtAbi,
        functionName: "pricePerShare",
      });
    },
    async getSevenDayApy(marketId) {
      const response = await http.get<YieldBasisTradingApyResponse>(
        `${YIELDBASIS_API}/v1/analytics/markets/trading-apy`,
      );
      return selectLatestSevenDayApy(response, marketId);
    },
  };

export function createYieldBasisYieldBearingAdapter(
  config: YieldBasisYieldBearingConfig,
  dependencies: YieldBasisYieldBearingDependencies = productionYieldBasisYieldBearingDependencies,
): Adapter {
  return defineAdapter({
    slug: config.slug,
    name: config.name,
    url: "https://yieldbasis.com",
    category: "lp",
    custody: "multisig",
    requires: { rpc: ["ethereum"], apis: ["yieldbasis"] },

    async fetch() {
      const [balances, pricePerShareRaw, sevenDayApy] = await Promise.all([
        dependencies.readBalances(config.ltAddress),
        dependencies.readSharePrice(config.ltAddress),
        dependencies.getSevenDayApy(config.marketId),
      ]);

      if (sevenDayApy.marketId !== config.marketId) {
        throw new Error(
          `${config.slug}: requested market ${config.marketId}, ` +
            `but source returned market ${sevenDayApy.marketId}`,
        );
      }

      const [supplyRaw, stakedRaw] = balances;
      const totalSupply = math.fromUnits(supplyRaw, 18);
      const stakedSupply = math.fromUnits(stakedRaw, 18);
      const yieldBearingShares = math.fromUnits(supplyRaw - stakedRaw, 18);
      const sharePrice = math.fromUnits(pricePerShareRaw, 18);
      requirePositive(yieldBearingShares, "yieldBearingShares");
      requirePositive(sharePrice, "sharePrice");

      const tvlBtc = math.mul(yieldBearingShares, sharePrice);
      requirePositive(tvlBtc, "tvlBtc");

      const rawApr7d = math.toPercent(
        math.fromUnits(sevenDayApy.apyRaw, RATE_DECIMALS),
      );
      const apr = Math.max(rawApr7d, 0);

      return [
        {
          symbol: config.symbol,
          tvlBtc,
          apr,
          metadata: {
            ...(rawApr7d < 0 && { allowZeroApr: true }),
            aprSource: "yieldbasis-api-trading-apy-1w",
            rateWindow: "7d",
            marketId: config.marketId,
            bucketStart: sevenDayApy.bucketStart,
            sourceTimestamp: sevenDayApy.sourceTimestamp,
            rawApy: sevenDayApy.apyRaw,
            rawApr7d,
            ltAddress: config.ltAddress,
            assetAddress: config.assetAddress,
            assetDecimals: config.assetDecimals,
            sharePrice,
            totalSupply,
            stakedSupply,
            yieldBearingShares,
            formulaVersion: FORMULA_VERSION,
          },
        },
      ];
    },
  });
}
