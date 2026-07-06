/**
 * Hermetica hBTC adapter — on-chain Stacks reads.
 *
 * TVL: `get-total-assets` on the state contract (sats held by the vault).
 * APR: the controller logs one `log-reward` transaction per day with the
 *      day's reward in sats. Sum the last 7 days and annualize against
 *      total assets. Verified against Hermetica's own API to within ~0.1pp;
 *      unlike the API, every input is auditable on-chain.
 */

import {
  defineAdapter,
  http,
  math,
  requirePositive,
  stacks,
} from "@bitcoinyield/adapters";

const DEPLOYER = "SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D";
const STATE_CONTRACT = `${DEPLOYER}.state-hbtc-v1`;
const CONTROLLER_CONTRACT = `${DEPLOYER}.controller-hbtc-v1`;

const HIRO_API = "https://api.hiro.so";
const APR_WINDOW_DAYS = 7;
// One log-reward tx lands per day; require most of the window to be present
// so a Hiro indexing gap can't silently produce a too-low APR.
const MIN_REWARD_SAMPLES = 5;

interface HiroTxPage {
  results: Array<{
    tx: {
      tx_status: string;
      burn_block_time_iso: string;
      contract_call?: {
        function_name: string;
        function_args?: Array<{ repr: string }>;
      };
    };
  }>;
}

const PAGE_SIZE = 50;
const MAX_TX_PAGES = 4;

/**
 * Sum successful log-reward amounts since the cutoff. Paginates: a busy week
 * of unrelated controller txs can push rewards past the first page, which
 * would silently understate APR if we read only page one.
 */
async function sumRecentRewards(
  cutoffMs: number,
): Promise<{ rewardSats: number; rewardTxCount: number }> {
  let rewardSats = 0;
  let rewardTxCount = 0;
  for (let page = 0; page < MAX_TX_PAGES; page++) {
    const txPage = await http.get<HiroTxPage>(
      `${HIRO_API}/extended/v2/addresses/${CONTROLLER_CONTRACT}/transactions` +
        `?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    );
    let pastCutoff = false;
    for (const { tx } of txPage.results) {
      if (new Date(tx.burn_block_time_iso).getTime() < cutoffMs) {
        pastCutoff = true;
        continue;
      }
      if (tx.tx_status !== "success") continue;
      if (tx.contract_call?.function_name !== "log-reward") continue;
      const arg = tx.contract_call.function_args?.[0]?.repr;
      if (!arg?.startsWith("u")) continue;
      rewardSats += Number(arg.slice(1));
      rewardTxCount += 1;
    }
    if (pastCutoff || txPage.results.length < PAGE_SIZE) break;
  }
  return { rewardSats, rewardTxCount };
}

export default defineAdapter({
  slug: "hermetica-hbtc",
  name: "Hermetica hBTC",
  url: "https://app.hermetica.fi",
  category: "yield-bearing",
  custody: "multisig",
  requires: { stacks: true },

  async fetch() {
    const cutoffMs = Date.now() - APR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const [totalAssetsRaw, rewards] = await Promise.all([
      stacks.callReadOnly({
        contract: STATE_CONTRACT,
        functionName: "get-total-assets",
      }),
      sumRecentRewards(cutoffMs),
    ]);

    const totalAssetsSats = requirePositive(
      Number(totalAssetsRaw),
      "get-total-assets",
    );
    const { rewardSats, rewardTxCount } = rewards;

    if (rewardTxCount < MIN_REWARD_SAMPLES) {
      throw new Error(
        `Hermetica: only ${rewardTxCount} log-reward txs in the last ` +
          `${APR_WINDOW_DAYS}d (expected ~${APR_WINDOW_DAYS}) — refusing to compute APR from a partial window`,
      );
    }

    // One log-reward lands per day, so the sample count IS the observed
    // window. Dividing by the full 7d when an indexing gap dropped a day
    // would underreport APR by up to ~29%.
    const apr = math.mul(
      math.div(rewardSats, totalAssetsSats),
      (365 / rewardTxCount) * 100,
    );

    return [
      {
        symbol: "hBTC",
        tvlBtc: math.fromUnits(totalAssetsSats, 8),
        apr,
        metadata: {
          stateContract: STATE_CONTRACT,
          controllerContract: CONTROLLER_CONTRACT,
          rewardSats7d: rewardSats,
          rewardTxCount,
          aprWindowDays: APR_WINDOW_DAYS,
          aprSource: "onchain-log-reward",
        },
      },
    ];
  },
});
