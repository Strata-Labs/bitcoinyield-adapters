import {
  defineAdapter,
  http,
  math,
  requireNumber,
  requirePositive,
} from "@bitcoinyield/adapters";

// Syntetika serves its API from this hostname despite the "backup" label —
// api.syntetika.io 404s for these routes (checked 2026-09-16).
const API_BASE = "https://api.backup.syntetika.io";
const MERKL_API = "https://api.merkl.xyz/v4";
const VAULT_ID = "75142b34-9345-48b3-80e5-765b81e75302";
const CHAIN_ID = 8453; // Base
const VAULT_ADDRESS = "0x9C2dCDbDB3F0A0F628D1112bBCABD9AE75353df3";
const VAULT_ADDRESS_LC = VAULT_ADDRESS.toLowerCase();
const ASSET_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

interface VaultResponse {
  address?: string;
  share_symbol?: string;
  asset_symbol?: string;
  tvl: string | number;
  tvl_usd: string | number;
  share_price: string | number;
  exchange_rate: string | number;
  current_apr: string | number;
  rewards_apy: string | number;
}

interface MerklOpportunity {
  chainId: number;
  identifier: string;
  status: string;
  apr: number;
}

/**
 * Live Merkl campaign APR for the vault, read from Merkl directly so it is
 * independent of Syntetika's self-reported figures. Returns null when Merkl
 * is unreachable or the payload shape is unexpected (caller falls back to
 * the provider-reported rate); an empty campaign list is a real zero.
 */
async function fetchMerklIncentiveApr(): Promise<number | null> {
  try {
    const opportunities = await http.get<MerklOpportunity[]>(
      `${MERKL_API}/opportunities?chainId=${CHAIN_ID}&identifier=${VAULT_ADDRESS}`,
      { retries: 1, timeout: 5_000 },
    );
    if (!Array.isArray(opportunities)) {
      throw new Error("expected an array of opportunities");
    }
    const live = opportunities.filter(
      (o) =>
        o.chainId === CHAIN_ID &&
        typeof o.identifier === "string" &&
        o.identifier.toLowerCase() === VAULT_ADDRESS_LC &&
        typeof o.status === "string" &&
        o.status.toUpperCase() === "LIVE",
    );
    return math.add(...live.map((o) => requireNumber(o.apr, "Merkl apr")));
  } catch (error) {
    console.warn(
      `[syntetika-hbtc] Merkl incentive unavailable, falling back to provider rate: ${error}`,
    );
    return null;
  }
}

export default defineAdapter({
  slug: "syntetika-hbtc",
  name: "Syntetika hBTC",
  url: "https://syntetika.io",
  category: "yield-bearing",
  custody: "custodial",

  async fetch() {
    const [vault, merklApr] = await Promise.all([
      http.get<VaultResponse>(`${API_BASE}/vault/${VAULT_ID}`),
      fetchMerklIncentiveApr(),
    ]);

    if (vault.address?.toLowerCase() !== VAULT_ADDRESS_LC) {
      throw new Error(`Unexpected vault address: ${vault.address}`);
    }
    if (vault.share_symbol?.toLowerCase() !== "hbtc") {
      throw new Error(`Unexpected share symbol: ${vault.share_symbol}`);
    }
    if (vault.asset_symbol?.toLowerCase() !== "cbbtc") {
      throw new Error(`Unexpected asset symbol: ${vault.asset_symbol}`);
    }

    const tvlBtc = requirePositive(vault.tvl, "tvl");
    const tvlUsd = requirePositive(vault.tvl_usd, "tvl_usd");
    const currentApr = requirePositive(vault.current_apr, "current_apr");
    const providerIncentiveRate = requireNumber(
      vault.rewards_apy,
      "rewards_apy",
    );
    const sharePrice = requirePositive(vault.share_price, "share_price");
    const exchangeRate = requirePositive(vault.exchange_rate, "exchange_rate");

    // Syntetika's current APR includes its provider-reported reward component
    // (rewards_apy mirrors the Merkl campaign rate). Preserve the residual
    // strategy APR, floored at 0 with the raw figure kept in metadata, then
    // replace rewards with the live Merkl rate so an ended campaign
    // contributes zero.
    const rawStrategyApr = math.sub(currentApr, providerIncentiveRate);
    const strategyApr = Math.max(rawStrategyApr, 0);
    const incentiveApr = merklApr ?? providerIncentiveRate;
    const apr = math.add(strategyApr, incentiveApr);

    return [
      {
        symbol: "hBTC",
        tvlBtc,
        tvlUsd,
        rate: apr,
        rateType: "apr",
        metadata: {
          chain: "Base",
          chainId: CHAIN_ID,
          vaultAddress: VAULT_ADDRESS,
          assetAddress: ASSET_ADDRESS,
          assetSymbol: "cbBTC",
          rateSource:
            merklApr !== null
              ? "syntetika-residual+merkl-live"
              : "syntetika-residual+provider-rewards-fallback",
          sharePriceCbBtcPerHBtc: sharePrice,
          exchangeRateHBtcPerCbBtc: exchangeRate,
          strategyApr,
          rawStrategyApr,
          incentiveApr,
          ...(merklApr === 0 && rawStrategyApr <= 0 && { allowZeroRate: true }),
        },
      },
    ];
  },
});
