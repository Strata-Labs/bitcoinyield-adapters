/**
 * Staked Token Yield earns YB emissions only. The paired yield-bearing
 * adapter owns the unstaked yb-WBTC trading-fee yield.
 *
 * The denominator is LT.updated_balances().staked, not gauge.totalSupply():
 * the gauge wraps yb-WBTC, and its boost/share math can make them diverge.
 */

import type { Address } from "viem";

import {
  createYieldBasisTokenAdapter,
  type YieldBasisTokenConfig,
} from "../yieldbasis/token-adapter.js";

export const config = {
  slug: "yb-wbtc-token",
  name: "Yield Basis YB-WBTC (Staked)",
  symbol: "yb-WBTC-staked",
  ltAddress: "0x651D4b8168488FA163D85304662E8278d4c55BAa" as Address,
  gaugeAddress: "0xAa0b1d265F23972eafB7d088e963BD31403A58F5" as Address,
  gaugeController: "0x1Be14811A3a06F6aF4fA64310a636e1Df04c1c21" as Address,
  assetAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address,
  assetDecimals: 8,
} satisfies YieldBasisTokenConfig;

export default createYieldBasisTokenAdapter(config);
