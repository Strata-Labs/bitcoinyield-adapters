import type { Address } from "viem";

import {
  createYieldBasisYieldBearingAdapter,
  type YieldBasisYieldBearingConfig,
} from "../yieldbasis/yield-bearing-adapter.js";

export const config = {
  slug: "yb-cbbtc-yieldbearing",
  name: "Yield Basis YB-cbBTC (Yield Bearing)",
  symbol: "yb-cbBTC",
  marketId: "8",
  ltAddress: "0x722FC3640BA007C3E9867CCdB0dCa59F2e2F29F9" as Address,
  assetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address,
  assetDecimals: 8,
} satisfies YieldBasisYieldBearingConfig;

export default createYieldBasisYieldBearingAdapter(config);
