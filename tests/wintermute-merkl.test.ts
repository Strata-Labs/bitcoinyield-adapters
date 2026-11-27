import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  VAULT_ADDRESS,
  WBTC_ADDRESS,
  ZAMA_ADDRESS,
} from "../adapters/wintermute-confidential-wbtc/morpho.js";
import { fetchRestWindow } from "../adapters/wintermute-confidential-wbtc/rest.js";

const END = Date.parse("2026-11-27T00:00:00Z") / 1000;
const START = END - 720 * 3600;
const OPPORTUNITY = "1180195578045120503";
const NOW = new Date((END + 12 * 3600) * 1000);

function hourlyRecords() {
  return Array.from({ length: 720 }, (_, i) => ({
    timestamp: String(START + i * 3600),
    avg: i % 2 === 0 ? 0 : 8,
    samples: i % 2 === 0 ? 1 : 5,
    hasUntrustedContribution: false,
  }));
}

function mockSources(
  t: TestContext,
  records: ReturnType<typeof hourlyRecords>,
  rewardToken = ZAMA_ADDRESS,
) {
  t.mock.method(Date, "now", () => NOW.getTime());
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    const { pathname, searchParams } = url;
    if (url.host === "api.merkl.xyz" && pathname === "/v4/campaigns") {
      assert.equal(searchParams.get("opportunityId"), OPPORTUNITY);
      return Response.json([
        {
          id: "campaign",
          opportunityId: OPPORTUNITY,
          computeChainId: 1,
          params: { targetToken: VAULT_ADDRESS },
          rewardToken: { chainId: 1, address: rewardToken, symbol: "ZAMA" },
        },
      ]);
    }
    if (
      url.host === "api.merkl.xyz" &&
      pathname === `/v4/opportunities/${OPPORTUNITY}/apr-records`
    ) {
      assert.equal(searchParams.get("from"), String(START));
      assert.equal(searchParams.get("to"), String(END - 1));
      assert.equal(searchParams.get("grain"), "HOUR");
      const offset = Number(searchParams.get("page")) * 200;
      return Response.json(records.slice(offset, offset + 200));
    }
    assert.equal(url.host, "api.morpho.org");
    const vaultPath = `/v0/vaults-v2/1:${VAULT_ADDRESS}`;
    if (pathname === vaultPath)
      return Response.json({
        data: {
          chain_id: 1,
          address: VAULT_ADDRESS,
          asset: { address: WBTC_ADDRESS, decimals: 8 },
        },
      });
    assert.equal(pathname, vaultPath + "/state/history");
    assert.equal(searchParams.get("lookback"), "thirty_days");
    const ray = 10n ** 27n;
    return Response.json({
      params: { chain_id: "1", vault_address: VAULT_ADDRESS },
      data: [
        {
          timestamp: START,
          share_price_ray: String(ray),
          total_assets: "9000000000",
        },
        {
          timestamp: END,
          share_price_ray: String((ray * 1001n) / 1000n),
          total_assets: "9188906808",
        },
        {
          timestamp: END + 1800,
          share_price_ray: String(ray),
          total_assets: "100000000",
        },
      ],
    });
  });
}

test("direct ZAMA comparison averages all 720 sampled hours equally at the REST midnight close", async (t) => {
  mockSources(t, hourlyRecords());
  const quote = await fetchRestWindow(NOW);
  assert.equal(quote.windowEnd, END);
  assert.equal(quote.observedAt, NOW.getTime() / 1000);
  assert.equal(quote.tvlBtc, 91.88906808);
  assert.equal(quote.directZamaAprPct, 4);
  assert.ok(
    Math.abs(
      quote.nativePlusDirectZamaPct! - ((1.001 ** (365 / 30) - 1) * 100 + 4),
    ) < 1e-9,
  );
});

test("692 hours preserve coverage and native yield while leaving the incentive and total missing", async (t) => {
  mockSources(t, hourlyRecords().slice(28));
  const quote = await fetchRestWindow(NOW);
  assert.equal(quote.observedHours, 692);
  assert.equal(quote.expectedHours, 720);
  assert.ok(quote.nativeApyPct > 0);
  assert.equal(quote.directZamaAprPct, null);
  assert.equal(quote.nativePlusDirectZamaPct, null);
});

test("untrusted observations cannot establish a direct ZAMA rate", async (t) => {
  const records = hourlyRecords();
  records[201]!.hasUntrustedContribution = true;
  mockSources(t, records);
  await assert.rejects(fetchRestWindow(NOW), /untrusted/);
});

test("a campaign for a different token cannot be attributed to ZAMA", async (t) => {
  mockSources(t, hourlyRecords(), WBTC_ADDRESS);
  await assert.rejects(fetchRestWindow(NOW), /reward asset/);
});
