import assert from "node:assert/strict";
import { test } from "node:test";

import { config as cbBtcConfig } from "../adapters/yb-cbbtc-yieldbearing/index.js";
import { config as tBtcConfig } from "../adapters/yb-tbtc-yieldbearing/index.js";
import { config as wBtcConfig } from "../adapters/yb-wbtc-yieldbearing/index.js";
import {
  createYieldBasisYieldBearingAdapter,
  type YieldBasisYieldBearingDependencies,
} from "../adapters/yieldbasis/yield-bearing-adapter.js";

const ONE_ETHER = 10n ** 18n;

const EXPECTED_CONFIGS = [
  {
    config: cbBtcConfig,
    expected: {
      slug: "yb-cbbtc-yieldbearing",
      name: "Yield Basis YB-cbBTC (Yield Bearing)",
      symbol: "yb-cbBTC",
      marketId: "8",
      ltAddress: "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9",
      assetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      assetDecimals: 8,
    },
    officialApyRaw: "26749738758512787",
    expectedApr: 2.6749738758512787,
  },
  {
    config: tBtcConfig,
    expected: {
      slug: "yb-tbtc-yieldbearing",
      name: "Yield Basis YB-tBTC (Yield Bearing)",
      symbol: "yb-tBTC",
      marketId: "9",
      ltAddress: "0x771F7290428d830ECd41E980745c327e507823Ec",
      assetAddress: "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
      assetDecimals: 18,
    },
    officialApyRaw: "16764952016710488",
    expectedApr: 1.6764952016710488,
  },
  {
    config: wBtcConfig,
    expected: {
      slug: "yb-wbtc-yieldbearing",
      name: "Yield Basis YB-WBTC (Yield Bearing)",
      symbol: "yb-WBTC",
      marketId: "7",
      ltAddress: "0x651D4b8168488FA163D85304662E8278d4c55BAa",
      assetAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      assetDecimals: 8,
    },
    officialApyRaw: "31722547323403834",
    expectedApr: 3.1722547323403834,
  },
] as const;

for (const {
  config,
  expected,
  officialApyRaw,
  expectedApr,
} of EXPECTED_CONFIGS) {
  test(`${expected.slug} publishes the current market inception APY`, async () => {
    assert.deepEqual(config, expected);

    const calls: string[] = [];
    const dependencies: YieldBasisYieldBearingDependencies = {
      async readBalances(ltAddress) {
        calls.push(`balances:${ltAddress}`);
        return [20n * ONE_ETHER, 8n * ONE_ETHER];
      },
      async readSharePrice(ltAddress) {
        calls.push(`share-price:${ltAddress}`);
        return 1_050_000_000_000_000_000n;
      },
      async getInceptionApy(marketId) {
        calls.push(`apy:${marketId}`);
        return {
          marketId,
          bucketStart: 1_787_011_200,
          apyRaw: officialApyRaw,
          sourceTimestamp: "2026-08-18T17:30:46.208Z",
        };
      },
    };

    const adapter = createYieldBasisYieldBearingAdapter(config, dependencies);
    const rows = await adapter.fetch({ env: {} });
    const row = rows[0];
    assert.ok(row);
    assert.ok(Math.abs(row.apr - expectedApr) < 1e-12);
    assert.equal(row.tvlBtc, 12.6);
    assert.deepEqual(calls, [
      `balances:${expected.ltAddress}`,
      `share-price:${expected.ltAddress}`,
      `apy:${expected.marketId}`,
    ]);
    assert.deepEqual(row.metadata, {
      aprSource: "yieldbasis-api-inception-apy",
      rateWindow: "inception",
      marketId: expected.marketId,
      bucketStart: 1_787_011_200,
      sourceTimestamp: "2026-08-18T17:30:46.208Z",
      rawApy: officialApyRaw,
      ltAddress: expected.ltAddress,
      assetAddress: expected.assetAddress,
      assetDecimals: expected.assetDecimals,
      sharePrice: 1.05,
      totalSupply: 20,
      stakedSupply: 8,
      yieldBearingShares: 12,
    });
  });
}

test("rejects an official APY row for the wrong market", async () => {
  const dependencies: YieldBasisYieldBearingDependencies = {
    async readBalances() {
      return [20n * ONE_ETHER, 8n * ONE_ETHER];
    },
    async readSharePrice() {
      return ONE_ETHER;
    },
    async getInceptionApy() {
      return {
        marketId: "3",
        bucketStart: 1_787_011_200,
        apyRaw: "42031487075072267",
        sourceTimestamp: "2026-08-18T17:30:46.208Z",
      };
    },
  };

  const adapter = createYieldBasisYieldBearingAdapter(wBtcConfig, dependencies);
  await assert.rejects(() => adapter.fetch({ env: {} }), /market 7.*market 3/);
});
