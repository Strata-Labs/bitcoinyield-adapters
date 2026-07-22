import assert from "node:assert/strict";
import { test } from "node:test";

import { config as cbBtcConfig } from "../adapters/yb-cbbtc-token/index.js";
import { config as tBtcConfig } from "../adapters/yb-tbtc-token/index.js";
import { config as wBtcConfig } from "../adapters/yb-wbtc-token/index.js";
import {
  calculateYieldBasisTokenMetrics,
  createYieldBasisTokenAdapter,
  EMISSIONS_WINDOW_SECONDS,
  type YieldBasisTokenDependencies,
} from "../adapters/yieldbasis/token-adapter.js";

const ONE_ETHER = 10n ** 18n;
const SOURCE_BLOCK_NUMBER = 22_222_222n;
const SOURCE_BLOCK_TIMESTAMP = 1_750_000_000n;

const EXPECTED_CONFIGS = [
  {
    config: cbBtcConfig,
    expected: {
      slug: "yb-cbbtc-token",
      name: "Yield Basis YB-cbBTC (Staked)",
      symbol: "yb-cbBTC-staked",
      ltAddress: "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9",
      gaugeAddress: "0xF8764cBcdb15a9E4c7CA1b0b8a578d9ebEEC1b6f",
      gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21",
      assetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      assetDecimals: 8,
    },
  },
  {
    config: tBtcConfig,
    expected: {
      slug: "yb-tbtc-token",
      name: "Yield Basis YB-tBTC (Staked)",
      symbol: "yb-tBTC-staked",
      ltAddress: "0x771F7290428d830ECd41E980745c327e507823Ec",
      gaugeAddress: "0xe83D888FE3213DD3471DE0bC1957E0f94F038483",
      gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21",
      assetAddress: "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
      assetDecimals: 18,
    },
  },
  {
    config: wBtcConfig,
    expected: {
      slug: "yb-wbtc-token",
      name: "Yield Basis YB-WBTC (Staked)",
      symbol: "yb-WBTC-staked",
      ltAddress: "0x651D4b8168488FA163D85304662E8278d4c55BAa",
      gaugeAddress: "0xAa0b1d265F23972eafB7d088e963BD31403A58F5",
      gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21",
      assetAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      assetDecimals: 8,
    },
  },
] as const;

interface DependencyCall {
  blockNumber: bigint;
  address?: string;
  controller?: string;
  gauge?: string;
  atTime?: bigint;
}

function makeDependencies(): {
  dependencies: YieldBasisTokenDependencies;
  calls: {
    balances: DependencyCall[];
    sharePrice: DependencyCall[];
    emissions: DependencyCall[];
  };
} {
  const calls = {
    balances: [] as DependencyCall[],
    sharePrice: [] as DependencyCall[],
    emissions: [] as DependencyCall[],
  };

  const dependencies: YieldBasisTokenDependencies = {
    async getLatestBlock() {
      return {
        number: SOURCE_BLOCK_NUMBER,
        timestamp: SOURCE_BLOCK_TIMESTAMP,
      };
    },
    async readBalances(address, blockNumber) {
      calls.balances.push({ address, blockNumber });
      return [20n * ONE_ETHER, 10n * ONE_ETHER];
    },
    async readSharePrice(address, blockNumber) {
      calls.sharePrice.push({ address, blockNumber });
      return ONE_ETHER;
    },
    async previewEmissions(controller, gauge, atTime, blockNumber) {
      calls.emissions.push({ controller, gauge, atTime, blockNumber });
      if (atTime === SOURCE_BLOCK_TIMESTAMP) return 100n * ONE_ETHER;
      if (
        atTime ===
        SOURCE_BLOCK_TIMESTAMP + BigInt(EMISSIONS_WINDOW_SECONDS)
      ) {
        return 101n * ONE_ETHER;
      }
      throw new Error(`Unexpected emissions timestamp: ${atTime}`);
    },
    async getYbPriceUsd() {
      return 2;
    },
    async getBtcPriceUsd() {
      return 100;
    },
  };

  return { dependencies, calls };
}

test("annualizes one YB per day against a 10 BTC staked TVL", () => {
  const metrics = calculateYieldBasisTokenMetrics({
    stakedSharesRaw: 10n * ONE_ETHER,
    pricePerShareRaw: ONE_ETHER,
    emissionsNowRaw: 100n * ONE_ETHER,
    emissionsFutureRaw: 101n * ONE_ETHER,
    ybPriceUsd: 2,
    btcPriceUsd: 100,
  });

  assert.equal(metrics.stakedShares, 10);
  assert.equal(metrics.sharePrice, 1);
  assert.equal(metrics.tvlBtc, 10);
  assert.equal(metrics.ybPerYear, 365);
  assert.equal(metrics.emissionsApr, 73);
});

for (const { config, expected } of EXPECTED_CONFIGS) {
  test(`${expected.slug} reports only pinned YB emissions`, async () => {
    assert.deepEqual(config, expected);

    const { dependencies, calls } = makeDependencies();
    const adapter = createYieldBasisTokenAdapter(config, dependencies);
    const rows = await adapter.fetch({ env: {} });
    const row = rows[0];
    assert.ok(row);
    assert.equal(row.apr, 73);
    assert.equal(row.tvlBtc, 10);

    const metadata = row.metadata;
    assert.ok(metadata);
    assert.deepEqual(Object.keys(metadata).sort(), [
      "assetAddress",
      "assetDecimals",
      "btcPriceUsd",
      "emissionsApr",
      "emissionsWindowSeconds",
      "formulaVersion",
      "gaugeAddress",
      "gaugeController",
      "ltAddress",
      "sharePrice",
      "sourceBlockNumber",
      "sourceBlockTimestamp",
      "stakedShares",
      "ybPerYear",
      "ybPriceUsd",
    ]);
    assert.equal(metadata.emissionsApr, 73);
    assert.equal(metadata.formulaVersion, "yieldbasis-token-emissions-v1");
    assert.equal(metadata.sourceBlockNumber, SOURCE_BLOCK_NUMBER.toString());
    assert.equal(
      metadata.sourceBlockTimestamp,
      SOURCE_BLOCK_TIMESTAMP.toString(),
    );
    assert.equal(metadata.emissionsWindowSeconds, 86_400);
    assert.equal("baseApr" in metadata, false);
    assert.equal("apy30dBase" in metadata, false);
    assert.equal("sharePrice30dAgo" in metadata, false);

    assert.deepEqual(calls.balances, [
      {
        address: expected.ltAddress,
        blockNumber: SOURCE_BLOCK_NUMBER,
      },
    ]);
    assert.deepEqual(calls.sharePrice, [
      {
        address: expected.ltAddress,
        blockNumber: SOURCE_BLOCK_NUMBER,
      },
    ]);
    assert.deepEqual(calls.emissions, [
      {
        controller: expected.gaugeController,
        gauge: expected.gaugeAddress,
        atTime: SOURCE_BLOCK_TIMESTAMP,
        blockNumber: SOURCE_BLOCK_NUMBER,
      },
      {
        controller: expected.gaugeController,
        gauge: expected.gaugeAddress,
        atTime: SOURCE_BLOCK_TIMESTAMP + BigInt(EMISSIONS_WINDOW_SECONDS),
        blockNumber: SOURCE_BLOCK_NUMBER,
      },
    ]);

    for (const call of [
      ...calls.balances,
      ...calls.sharePrice,
      ...calls.emissions,
    ]) {
      assert.equal(call.blockNumber, SOURCE_BLOCK_NUMBER);
    }
  });
}

test("rejects flat or decreasing cumulative emissions", () => {
  for (const emissionsFutureRaw of [100n * ONE_ETHER, 99n * ONE_ETHER]) {
    assert.throws(
      () =>
        calculateYieldBasisTokenMetrics({
          stakedSharesRaw: 10n * ONE_ETHER,
          pricePerShareRaw: ONE_ETHER,
          emissionsNowRaw: 100n * ONE_ETHER,
          emissionsFutureRaw,
          ybPriceUsd: 2,
          btcPriceUsd: 100,
        }),
      /emissionsFuture.*greater than emissionsNow/,
    );
  }
});
