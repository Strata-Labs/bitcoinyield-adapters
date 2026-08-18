/**
 * Shared Yield Basis Real Yield adapter for current (non-legacy) markets.
 *
 * Yield Basis displays Fundamental Trading APY since the current market's
 * inception. Reading a fixed 30-day on-chain window can cross a migration
 * boundary and rank the legacy market instead, so APR comes from the
 * protocol's official per-market analytics feed. TVL remains on-chain.
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

export interface YieldBasisInceptionApy {
  marketId: string;
  bucketStart: number;
  apyRaw: string;
  sourceTimestamp: string;
}

export interface YieldBasisYieldBearingDependencies {
  readBalances(ltAddress: Address): Promise<readonly [bigint, bigint]>;
  readSharePrice(ltAddress: Address): Promise<bigint>;
  getInceptionApy(marketId: string): Promise<YieldBasisInceptionApy>;
}

interface YieldBasisTradingApyResponse {
  success: boolean;
  data: Array<{
    bucketStart: number;
    marketId: string;
    tradingApyAllTime: string;
  }>;
  timestamp: string;
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
    async getInceptionApy(marketId) {
      const response = await http.get<YieldBasisTradingApyResponse>(
        `${YIELDBASIS_API}/v1/analytics/markets/trading-apy/1/${marketId}`,
      );
      if (!response.success || response.data.length === 0) {
        throw new Error(`YieldBasis market ${marketId}: no trading APY data`);
      }

      const latest = response.data.reduce((current, row) =>
        row.bucketStart > current.bucketStart ? row : current,
      );
      if (!latest.tradingApyAllTime) {
        throw new Error(
          `YieldBasis market ${marketId}: inception APY is missing`,
        );
      }

      return {
        marketId: latest.marketId,
        bucketStart: latest.bucketStart,
        apyRaw: latest.tradingApyAllTime,
        sourceTimestamp: response.timestamp,
      };
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
      const [balances, pricePerShareRaw, inceptionApy] = await Promise.all([
        dependencies.readBalances(config.ltAddress),
        dependencies.readSharePrice(config.ltAddress),
        dependencies.getInceptionApy(config.marketId),
      ]);

      if (inceptionApy.marketId !== config.marketId) {
        throw new Error(
          `${config.slug}: requested market ${config.marketId}, ` +
            `but source returned market ${inceptionApy.marketId}`,
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

      const rawApy = math.toPercent(
        math.fromUnits(inceptionApy.apyRaw, RATE_DECIMALS),
      );
      const apr = Math.max(rawApy, 0);

      return [
        {
          symbol: config.symbol,
          tvlBtc,
          apr,
          metadata: {
            ...(rawApy < 0 && { allowZeroApr: true }),
            aprSource: "yieldbasis-api-inception-apy",
            rateWindow: "inception",
            marketId: config.marketId,
            bucketStart: inceptionApy.bucketStart,
            sourceTimestamp: inceptionApy.sourceTimestamp,
            rawApy: inceptionApy.apyRaw,
            ltAddress: config.ltAddress,
            assetAddress: config.assetAddress,
            assetDecimals: config.assetDecimals,
            sharePrice,
            totalSupply,
            stakedSupply,
            yieldBearingShares,
          },
        },
      ];
    },
  });
}
