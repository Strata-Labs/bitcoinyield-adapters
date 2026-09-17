/**
 * Lombard Earn adapter (LBTCv vault).
 * APY: Lombard analytics. TVL/total_assets: Sevenseas vault feed.
 */

import {
  defineAdapter,
  http,
  math,
  parseNumber,
  requirePositive,
} from "@bitcoinyield/adapters";

const APY_URL =
  "https://mainnet.prod.lombard.finance/api/v1/analytics/btce/apy/summary";
const VAULT_URL =
  "https://bff.prod.lombard-fi.com/sevenseas-api/daily-data/all/0x5401b8620E5FB570064CA9114fd1e135fd77D57c/0/latest";

const VAULT_ADDRESS = "0x5401b8620E5FB570064CA9114fd1e135fd77D57c";

interface ApySummary {
  snapshot?: {
    total_apy?: number;
    breakdown?: Array<{ apy: number; asset: string }>;
  };
}

interface VaultEntry {
  tvl: string;
  total_assets: string;
  price_usd: string;
  share_price: string;
}

export default defineAdapter({
  slug: "lombard-earn",
  name: "Lombard Earn",
  url: "https://www.lombard.finance/app/earn/",
  category: "yield-bearing",
  custody: "multisig",

  async fetch() {
    const [apyData, vaultData] = await Promise.all([
      http.get<ApySummary>(APY_URL),
      http.get<VaultEntry[]>(VAULT_URL),
    ]);

    const totalApyDecimal = apyData?.snapshot?.total_apy;
    const breakdown = apyData?.snapshot?.breakdown;
    const latestVault = Array.isArray(vaultData) ? vaultData[0] : null;

    if (!latestVault) throw new Error("Lombard Earn vault feed returned empty");

    const tvlUsd = requirePositive(latestVault.tvl, "lombard-earn.tvl");
    const tvlBtc = requirePositive(
      latestVault.total_assets,
      "lombard-earn.total_assets",
    );
    const reportedApy = math.toPercent(
      requirePositive(totalApyDecimal, "lombard-earn.total_apy"),
    );

    return [
      {
        symbol: "LBTCv",
        tvlBtc,
        tvlUsd,
        rate: null,
        rateUnavailableReason:
          "Reported total APY mixes vault accrual and separate BARD rewards",
        metadata: {
          sourceRate: {
            type: "apy",
            value: reportedApy,
            basis: "reported",
            source: APY_URL,
          },
          apyBreakdown: breakdown?.map((b) => ({
            asset: b.asset,
            apy: math.toPercent(b.apy),
          })),
          vaultAddress: VAULT_ADDRESS,
          sharePrice: parseNumber(latestVault.share_price),
          vaultPriceUsd: parseNumber(latestVault.price_usd),
        },
      },
    ];
  },
});
