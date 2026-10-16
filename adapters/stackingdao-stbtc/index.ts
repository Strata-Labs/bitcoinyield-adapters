/**
 * Stacking DAO stBTC adapter — on-chain Stacks reads.
 *
 * stBTC is an 8-decimal share token over sBTC held by `stbtc-reserve`
 * (idle balance plus principal deployed to bonds).
 *
 * TVL: `stbtc-reserve.get-total-sbtc`, gross of sBTC locked for pending
 *      withdrawals — the figure the app shows as stBTC TVL.
 * APY: 30-day compounded growth of `data-stbtc-v1.get-sbtc-per-stbtc`, read
 *      at the latest block and at the last block 30 days earlier (historical
 *      `tip` read). A losing window comes out negative and is published as-is.
 */

import {
  defineAdapter,
  math,
  requirePositive,
  stacks,
} from "@bitcoinyield/adapters";

const DEPLOYER = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG";
const RESERVE = `${DEPLOYER}.stbtc-reserve`;
const TOKEN = `${DEPLOYER}.stbtc-token`;
const DATA = `${DEPLOYER}.data-stbtc-v1`;

const APY_WINDOW_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

/** A bare uint decodes to a bigint; `(ok uint)` to `{ type, value }`. */
function uint(value: unknown, name: string): number {
  const raw =
    typeof value === "object" && value !== null && "value" in value
      ? value.value
      : value;
  return requirePositive(Number(raw), name);
}

export default defineAdapter({
  slug: "stackingdao-stbtc",
  name: "Stacking DAO stBTC",
  url: "https://app.stackingdao.com",
  category: "yield-bearing",
  custody: "multisig",
  requires: { stacks: true },

  async fetch() {
    const latest = await stacks.getBlock("latest");
    const baseline = await stacks.findBlockAtTime(
      latest.time - APY_WINDOW_DAYS * SECONDS_PER_DAY,
      latest,
    );
    const read = (contract: string, functionName: string, tip: string) =>
      stacks.callReadOnly({ contract, functionName, tip });

    const [totalRaw, rateNowRaw, rateThenRaw, supplyThenRaw] =
      await Promise.all([
        read(RESERVE, "get-total-sbtc", latest.indexBlockHash),
        read(DATA, "get-sbtc-per-stbtc", latest.indexBlockHash),
        read(DATA, "get-sbtc-per-stbtc", baseline.indexBlockHash),
        // The ratio is pinned to exactly 1.0 while no stBTC exists, so a
        // pre-launch baseline would pass as real growth.
        read(TOKEN, "get-total-supply", baseline.indexBlockHash),
      ]);

    const rateNow = uint(rateNowRaw, "get-sbtc-per-stbtc");
    const rateThen = uint(rateThenRaw, "get-sbtc-per-stbtc@baseline");
    uint(supplyThenRaw, "get-total-supply@baseline");
    const windowDays = (latest.time - baseline.time) / SECONDS_PER_DAY;

    const apy = math.mul(
      math.sub(Math.pow(math.div(rateNow, rateThen), 365 / windowDays), 1),
      100,
    );

    return [
      {
        symbol: "stBTC",
        tvlBtc: math.fromUnits(uint(totalRaw, "get-total-sbtc"), 8),
        rate: apy,
        rateType: "apy",
        metadata: {
          reserveContract: RESERVE,
          sbtcPerStbtc: math.fromUnits(rateNow, 8),
          sbtcPerStbtcThen: math.fromUnits(rateThen, 8),
          blockHeight: latest.height,
          baselineBlockHeight: baseline.height,
          windowDays,
          rateSource: "onchain-30d-sbtc-per-stbtc-apy",
        },
      },
    ];
  },
});
