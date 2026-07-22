/**
 * Staked Token Yield earns YB emissions only. The paired yield-bearing
 * adapter owns the unstaked yb-tBTC trading-fee yield.
 */

import type { Address } from "viem";

import {
  createYieldBasisTokenAdapter,
  type YieldBasisTokenConfig,
} from "../yieldbasis/token-adapter.js";

export const config = {
  slug: "yb-tbtc-token",
  name: "Yield Basis YB-tBTC (Staked)",
  symbol: "yb-tBTC-staked",
  ltAddress: "0x771F7290428d830ECd41E980745c327e507823Ec" as Address,
  gaugeAddress: "0xe83D888FE3213DD3471DE0bC1957E0f94F038483" as Address,
  gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21" as Address,
  assetAddress: "0x18084fbA666a33d37592fA2633fD49a74DD93a88" as Address,
  assetDecimals: 18,
} satisfies YieldBasisTokenConfig;

export default createYieldBasisTokenAdapter(config);
