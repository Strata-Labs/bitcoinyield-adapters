import type { Address } from "viem";

import {
  createYieldBasisYieldBearingAdapter,
  type YieldBasisYieldBearingConfig,
} from "../yieldbasis/yield-bearing-adapter.js";

export const config = {
  slug: "yb-wbtc-yieldbearing",
  name: "Yield Basis YB-WBTC (Yield Bearing)",
  symbol: "yb-WBTC",
  marketId: "7",
  ltAddress: "0x651D4b8168488FA163D85304662E8278d4c55BAa" as Address,
  assetAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address,
  assetDecimals: 8,
} satisfies YieldBasisYieldBearingConfig;

export default createYieldBasisYieldBearingAdapter(config);
