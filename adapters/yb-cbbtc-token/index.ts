/**
 * Staked Token Yield earns YB emissions only. The paired yield-bearing
 * adapter owns the unstaked yb-cbBTC trading-fee yield.
 */

import type { Address } from "viem";

import {
  createYieldBasisTokenAdapter,
  type YieldBasisTokenConfig,
} from "../yieldbasis/token-adapter.js";

export const config = {
  slug: "yb-cbbtc-token",
  name: "Yield Basis YB-cbBTC (Staked)",
  symbol: "yb-cbBTC-staked",
  ltAddress: "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9" as Address,
  gaugeAddress: "0xF8764cBcdb15a9E4c7CA1b0b8a578d9ebEEC1b6f" as Address,
  gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21" as Address,
  assetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
  assetDecimals: 8,
} satisfies YieldBasisTokenConfig;

export default createYieldBasisTokenAdapter(config);
