import { defineAdapter } from "../../src/core/defineAdapter.js";
import { fetchMorphoWindow, VAULT_ADDRESS, ZAMA_ADDRESS } from "./morpho.js";

export default defineAdapter({
  slug: "wintermute-confidential-wbtc",
  name: "Wintermute Confidential WBTC",
  url: `https://app.morpho.org/ethereum/vault/${VAULT_ADDRESS}/wintermute-confidential-wbtc`,
  category: "lending",
  requires: { apis: ["api.morpho.org"] },

  async fetch({ timestamp }) {
    const asOf = timestamp?.getTime() ?? Date.now();
    const end = Math.floor(asOf / 3_600_000) * 3600;
    const { totalApyPct, tvlBtc, ...observations } =
      await fetchMorphoWindow(end);
    return [
      {
        symbol: "WBTC",
        tvlBtc,
        rate: totalApyPct,
        rateType: "apy",
        metadata: {
          ...observations,
          vaultAddress: VAULT_ADDRESS,
          windowDays: 30,
          rateSource: "morpho-graphql",
          rewardBasis: "vault-implied-quote",
          spotZamaTokenAddress: ZAMA_ADDRESS,
          ...(totalApyPct === 0 && { allowZeroRate: true }),
        },
      },
    ];
  },
});
