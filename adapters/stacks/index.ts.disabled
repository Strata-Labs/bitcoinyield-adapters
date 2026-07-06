/**
 * Stacks adapter — STX stacking that pays out BTC.
 *
 * Distinct from the sBTC dual-stacking adapters: this measures the bitcoin
 * sitting in the canonical Stacks reserve address that gets distributed to
 * stackers. APR is the sum of base + max-defi APRs from DegenLab v2.
 */

import {
  defineAdapter,
  http,
  math,
  requireNumber,
  requirePositive,
} from "@bitcoinyield/adapters";

const STACKS_RESERVE =
  "bc1prcs82tvrz70jk8u79uekwdfjhd0qhs2mva6e526arycu7fu25zsqhyztuy";
const SBTC_YIELD_API =
  "https://dual-stacking-v3-server.degenlab.io/dual-stacking-server/last-cycle-aprs";
const BLOCKCHAIN_INFO = "https://blockchain.info/q/addressbalance";

interface YieldResponse {
  max_defi_apr: string;
  base_apr: string;
}

export default defineAdapter({
  slug: "stacks",
  name: "Stacks",
  url: "https://www.stacks.co",
  category: "staking",
  custody: "self",

  async fetch() {
    const [yieldData, balanceText] = await Promise.all([
      http.get<YieldResponse>(SBTC_YIELD_API),
      http.getText(`${BLOCKCHAIN_INFO}/${STACKS_RESERVE}`),
    ]);

    const maxDefiApr = requireNumber(yieldData.max_defi_apr, "max_defi_apr");
    const baseApr = requireNumber(yieldData.base_apr, "base_apr");
    const sats = requirePositive(Number(balanceText), "btc-balance-sats");

    return [
      {
        symbol: "BTC",
        tvlBtc: math.fromUnits(sats, 8),
        apr: math.add(maxDefiApr, baseApr),
        metadata: { baseApr, maxDefiApr, reserveAddress: STACKS_RESERVE },
      },
    ];
  },
});
