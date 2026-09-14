import { defineAdapter, http } from "@bitcoinyield/adapters";

const API_BASE = "https://api.backup.syntetika.io";
const VAULT_ID = "75142b34-9345-48b3-80e5-765b81e75302";
const CHAIN_ID = 8453;
const VAULT_ADDRESS = "0x9C2dCDbDB3F0A0F628D1112bBCABD9AE75353df3";
const ASSET_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

interface VaultResponse {
  name: string;
  address: string;
  share_symbol: string;
  asset_symbol: string;
  tvl: string | number;
  tvl_usd: string | number;
  share_price: string | number;
  exchange_rate: string | number;
  current_apr: string | number;
  net_apy: string | number;
  rewards_apy: string | number;
  performance_fee?: string | number;
  fund_management_fee?: string | number;
  fund_performance_fee?: string | number;
}

interface MerklOpportunity {
  opportunityId: string;
  chainId: number;
  identifier: string;
  status: string;
  apr: number;
  dailyRewards?: number;
  lastSynced?: string;
}

interface MerklResponse {
  opportunities?: MerklOpportunity[];
}

function requireFinite(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function requireNonNegative(value: string | number, label: string): number {
  const parsed = requireFinite(value, label);
  if (parsed < 0) {
    throw new Error(`${label} must be non-negative: ${value}`);
  }
  return parsed;
}

export default defineAdapter({
  slug: "syntetika-hbtc",
  name: "Syntetika hBTC",
  url: "https://syntetika.io",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    const vault = await http.get<VaultResponse>(
      `${API_BASE}/vault/${VAULT_ID}`,
    );
    const merkl = await http
      .get<MerklResponse>(`${API_BASE}/merkl/apr?vault=${VAULT_ID}`)
      .then((data) => ({ data, available: true as const }))
      .catch(() => ({ data: null, available: false as const }));

    if (vault.address.toLowerCase() !== VAULT_ADDRESS.toLowerCase()) {
      throw new Error(`Unexpected vault address: ${vault.address}`);
    }
    if (vault.share_symbol.toLowerCase() !== "hbtc") {
      throw new Error(`Unexpected share symbol: ${vault.share_symbol}`);
    }
    if (vault.asset_symbol.toLowerCase() !== "cbbtc") {
      throw new Error(`Unexpected asset symbol: ${vault.asset_symbol}`);
    }

    const tvlBtc = requireNonNegative(vault.tvl, "tvl");
    const tvlUsd = requireNonNegative(vault.tvl_usd, "tvl_usd");
    const currentApr = requireNonNegative(vault.current_apr, "current_apr");
    const displayedNetApy = requireNonNegative(vault.net_apy, "net_apy");
    const providerIncentiveRate = requireNonNegative(
      vault.rewards_apy,
      "rewards_apy",
    );
    const sharePrice = requireNonNegative(vault.share_price, "share_price");
    const exchangeRate = requireNonNegative(
      vault.exchange_rate,
      "exchange_rate",
    );

    // Syntetika's current APR includes its provider-reported reward component.
    // Preserve the residual strategy APR, then replace rewards with the live
    // Merkl campaign rate so an ended campaign contributes zero.
    const strategyApr = Math.max(0, currentApr - providerIncentiveRate);
    const strategyApy = Math.max(0, displayedNetApy - providerIncentiveRate);

    const matchingCampaigns =
      merkl.data?.opportunities?.filter(
        (opportunity) =>
          opportunity.chainId === CHAIN_ID &&
          opportunity.identifier.toLowerCase() === VAULT_ADDRESS.toLowerCase(),
      ) ?? [];
    const activeCampaigns = matchingCampaigns.filter(
      (opportunity) => opportunity.status.toUpperCase() === "LIVE",
    );

    const incentiveApr = merkl.available
      ? activeCampaigns.reduce(
          (sum, opportunity) =>
            sum + requireNonNegative(opportunity.apr, "Merkl APR"),
          0,
        )
      : providerIncentiveRate;
    const combinedApr = strategyApr + incentiveApr;

    return [
      {
        symbol: "hBTC",
        tvlBtc,
        tvlUsd,
        apr: combinedApr,
        metadata: {
          chain: "Base",
          chainId: CHAIN_ID,
          vaultAddress: VAULT_ADDRESS,
          assetAddress: ASSET_ADDRESS,
          assetSymbol: "cbBTC",
          rateWindow: "current provider estimate",
          sharePriceCbBtcPerHBtc: sharePrice,
          exchangeRateHBtcPerCbBtc: exchangeRate,
          components: {
            strategyApr,
            incentiveApr,
            incentiveStatus: merkl.available
              ? activeCampaigns.length > 0
                ? "live"
                : "inactive"
              : "provider fallback",
            incentiveSource: merkl.available
              ? "Merkl API"
              : "Syntetika API fallback",
          },
          provider: {
            displayedNetApy,
            estimatedStrategyApy: strategyApy,
            reportedRewardsRate: providerIncentiveRate,
            reportedCurrentApr: currentApr,
          },
          campaigns: activeCampaigns.map((campaign) => ({
            opportunityId: campaign.opportunityId,
            apr: campaign.apr,
            dailyRewardsUsd: campaign.dailyRewards,
            lastSynced: campaign.lastSynced,
          })),
          fees: {
            performanceFeeRate:
              vault.performance_fee !== undefined
                ? requireNonNegative(vault.performance_fee, "performance_fee")
                : undefined,
            fundManagementFeePct:
              vault.fund_management_fee !== undefined
                ? requireNonNegative(
                    vault.fund_management_fee,
                    "fund_management_fee",
                  )
                : undefined,
            fundPerformanceFeePct:
              vault.fund_performance_fee !== undefined
                ? requireNonNegative(
                    vault.fund_performance_fee,
                    "fund_performance_fee",
                  )
                : undefined,
          },
        },
      },
    ];
  },
});
