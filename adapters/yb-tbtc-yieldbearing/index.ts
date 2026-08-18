import type { Address } from "viem";

import {
  createYieldBasisYieldBearingAdapter,
  type YieldBasisYieldBearingConfig,
} from "../yieldbasis/yield-bearing-adapter.js";

export const config = {
  slug: "yb-tbtc-yieldbearing",
  name: "Yield Basis YB-tBTC (Yield Bearing)",
  symbol: "yb-tBTC",
  marketId: "9",
  ltAddress: "0x771F7290428d830ECd41E980745c327e507823Ec" as Address,
  assetAddress: "0x18084fbA666a33d37592fA2633fD49a74DD93a88" as Address,
  assetDecimals: 18,
} satisfies YieldBasisYieldBearingConfig;

export default createYieldBasisYieldBearingAdapter(config);
