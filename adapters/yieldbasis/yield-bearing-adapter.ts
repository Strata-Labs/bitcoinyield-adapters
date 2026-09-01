/**
 * Shared Yield Basis Real Yield adapter.
 *
 * APR is Yield Basis's official 30-day fundamental trading APY
 * (`tradingApy`). That is the unlabeled field on
 * `/v1/analytics/markets/trading-apy` and matches the dashboard's
 * FT APY (30D) column. TVL stays on-chain.
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
const FORMULA_VERSION = "yieldbasis-trading-apy-30d-v1";

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

export interface YieldBasisThirtyDayApy {
  marketId: string;
  bucketStart: number;
  apyRaw: string;
  sourceTimestamp: string;
}

export interface YieldBasisYieldBearingDependencies {
  readBalances(ltAddress: Address): Promise<readonly [bigint, bigint]>;
  readSharePrice(ltAddress: Address): Promise<bigint>;
  getThirtyDayApy(marketId: string): Promise<YieldBasisThirtyDayApy>;
}

interface YieldBasisTradingApyResponse {
  success: boolean;
  data: Array<{
    bucketStart: number;
    marketId: string;
    tradingApy?: string | null;
  }>;
  timestamp: string;
}

export function selectLatestThirtyDayApy(
  response: YieldBasisTradingApyResponse,
  marketId: string,
): YieldBasisThirtyDayApy {
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
  if (latest.tradingApy == null || latest.tradingApy === "") {
    throw new Error(`YieldBasis market ${marketId}: 30d APY is missing`);
  }

  return {
    marketId: latest.marketId,
    bucketStart: latest.bucketStart,
    apyRaw: latest.tradingApy,
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
    async getThirtyDayApy(marketId) {
      const response = await http.get<YieldBasisTradingApyResponse>(
        `${YIELDBASIS_API}/v1/analytics/markets/trading-apy`,
      );
      return selectLatestThirtyDayApy(response, marketId);
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
      const [balances, pricePerShareRaw, thirtyDayApy] = await Promise.all([
        dependencies.readBalances(config.ltAddress),
        dependencies.readSharePrice(config.ltAddress),
        dependencies.getThirtyDayApy(config.marketId),
      ]);

      if (thirtyDayApy.marketId !== config.marketId) {
        throw new Error(
          `${config.slug}: requested market ${config.marketId}, ` +
            `but source returned market ${thirtyDayApy.marketId}`,
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

      const rawApr30d = math.toPercent(
        math.fromUnits(thirtyDayApy.apyRaw, RATE_DECIMALS),
      );
      const apr = Math.max(rawApr30d, 0);

      return [
        {
          symbol: config.symbol,
          tvlBtc,
          apr,
          metadata: {
            ...(rawApr30d < 0 && { allowZeroApr: true }),
            aprSource: "yieldbasis-api-trading-apy-30d",
            rateWindow: "30d",
            marketId: config.marketId,
            bucketStart: thirtyDayApy.bucketStart,
            sourceTimestamp: thirtyDayApy.sourceTimestamp,
            rawApy: thirtyDayApy.apyRaw,
            rawApr30d,
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
