import assert from "node:assert/strict";
import { test } from "node:test";

import { config as cbBtcConfig } from "../adapters/yb-cbbtc-yieldbearing/index.js";
import { config as tBtcConfig } from "../adapters/yb-tbtc-yieldbearing/index.js";
import { config as wBtcConfig } from "../adapters/yb-wbtc-yieldbearing/index.js";
import {
  createYieldBasisYieldBearingAdapter,
  selectLatestThirtyDayApy,
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
    officialApyRaw: "-11320570079601498",
    expectedApr: 0,
    expectedRawApr30d: -1.1320570079601498,
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
    officialApyRaw: "-5327043249151938",
    expectedApr: 0,
    expectedRawApr30d: -0.5327043249151938,
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
    officialApyRaw: "9126729331648391",
    expectedApr: 0.9126729331648391,
    expectedRawApr30d: 0.9126729331648391,
  },
] as const;

for (const {
  config,
  expected,
  officialApyRaw,
  expectedApr,
  expectedRawApr30d,
} of EXPECTED_CONFIGS) {
  test(`${expected.slug} publishes the official 30d trading APY`, async () => {
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
      async getThirtyDayApy(marketId) {
        calls.push(`apy:${marketId}`);
        return {
          marketId,
          bucketStart: 1_788_220_800,
          apyRaw: officialApyRaw,
          sourceTimestamp: "2026-09-01T17:01:46.302Z",
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
    const { rawApr30d, ...metadata } = row.metadata ?? {};
    assert.ok(typeof rawApr30d === "number");
    assert.ok(Math.abs(rawApr30d - expectedRawApr30d) < 1e-12);
    assert.deepEqual(metadata, {
      ...(expectedRawApr30d < 0 && { allowZeroApr: true }),
      aprSource: "yieldbasis-api-trading-apy-30d",
      rateWindow: "30d",
      marketId: expected.marketId,
      bucketStart: 1_788_220_800,
      sourceTimestamp: "2026-09-01T17:01:46.302Z",
      rawApy: officialApyRaw,
      ltAddress: expected.ltAddress,
      assetAddress: expected.assetAddress,
      assetDecimals: expected.assetDecimals,
      sharePrice: 1.05,
      totalSupply: 20,
      stakedSupply: 8,
      yieldBearingShares: 12,
      formulaVersion: "yieldbasis-trading-apy-30d-v1",
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
    async getThirtyDayApy() {
      return {
        marketId: "3",
        bucketStart: 1_788_220_800,
        apyRaw: "9126729331648391",
        sourceTimestamp: "2026-09-01T17:01:46.302Z",
      };
    },
  };

  const adapter = createYieldBasisYieldBearingAdapter(wBtcConfig, dependencies);
  await assert.rejects(() => adapter.fetch({ env: {} }), /market 7.*market 3/);
});

test("selects tradingApy from the latest matching market row", () => {
  const selected = selectLatestThirtyDayApy(
    {
      success: true,
      timestamp: "2026-09-01T17:01:46.302Z",
      data: [
        {
          bucketStart: 1_788_134_400,
          marketId: "7",
          tradingApy: "10000000000000000",
        },
        {
          bucketStart: 1_788_220_800,
          marketId: "8",
          tradingApy: "-11320570079601498",
        },
        {
          bucketStart: 1_788_220_800,
          marketId: "7",
          tradingApy: "9126729331648391",
        },
      ],
    },
    "7",
  );

  assert.deepEqual(selected, {
    marketId: "7",
    bucketStart: 1_788_220_800,
    apyRaw: "9126729331648391",
    sourceTimestamp: "2026-09-01T17:01:46.302Z",
  });
});
