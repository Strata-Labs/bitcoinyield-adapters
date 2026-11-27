import { pathToFileURL } from "node:url";
import { get } from "../../src/core/utils/http.js";
import { add, fromUnits, toPercent } from "../../src/core/utils/math.js";
import { VAULT_ADDRESS, WBTC_ADDRESS, ZAMA_ADDRESS } from "./morpho.js";

const HOUR = 3600;
const DAY = HOUR * 24;
const HOURS = 30 * 24;
const VAULT_URL = `https://api.morpho.org/v0/vaults-v2/1:${VAULT_ADDRESS}`;
const MERKL_URL = "https://api.merkl.xyz/v4";
const OPPORTUNITY = "1180195578045120503";
const REQUEST = { timeout: 10_000, retries: 1 };

interface Campaign {
  id: string;
  opportunityId: string;
  computeChainId: number;
  params: { targetToken: string };
  rewardToken: { chainId: number; address: string; symbol: string };
}

interface AprRecord {
  timestamp: string | number;
  avg: number;
  samples: number;
  hasUntrustedContribution: boolean;
}

interface StateSnapshot {
  timestamp: number;
  share_price_ray: string;
  total_assets: string;
}

interface DirectRewardCoverage {
  observedHours: number;
  expectedHours: number;
  directZamaAprPct: number | null;
}

export interface DirectRewardComparison extends DirectRewardCoverage {
  windowStart: number;
  windowEnd: number;
  observedAt: number;
  tvlBtc: number;
  startSharePrice: number;
  endSharePrice: number;
  nativeApyPct: number;
  nativePlusDirectZamaPct: number | null;
}

// The APR records are opportunity aggregates without token IDs. Check the
// complete campaign list before identifying those observations as ZAMA.
async function verifyCampaigns() {
  const url = `${MERKL_URL}/campaigns?opportunityId=${OPPORTUNITY}&items=100`;
  const ids = new Set<string>();
  for (let page = 0; ; page++) {
    const campaigns = await get<Campaign[]>(`${url}&page=${page}`, REQUEST);
    if (!Array.isArray(campaigns) || campaigns.length > 100)
      throw new Error("Merkl: invalid campaign page");
    for (const campaign of campaigns) {
      if (
        typeof campaign?.id !== "string" ||
        campaign.id.length === 0 ||
        ids.has(campaign.id) ||
        campaign.opportunityId !== OPPORTUNITY ||
        campaign.computeChainId !== 1 ||
        campaign.params?.targetToken?.toLowerCase() !==
          VAULT_ADDRESS.toLowerCase() ||
        campaign.rewardToken?.chainId !== 1 ||
        campaign.rewardToken.address?.toLowerCase() !==
          ZAMA_ADDRESS.toLowerCase() ||
        campaign.rewardToken.symbol !== "ZAMA"
      ) {
        throw new Error(
          "Merkl: duplicate, missing, or unexpected campaign identity or reward asset",
        );
      }
      ids.add(campaign.id);
    }
    if (campaigns.length < 100) break;
  }
  if (!ids.size)
    throw new Error("Merkl: no campaigns to establish the reward asset");
}

/** Average 720 complete trusted hourly observations on the public vault only. */
export async function fetchMerklRewardApr(
  windowEnd: number,
): Promise<DirectRewardCoverage> {
  const start = windowEnd - HOURS * HOUR;
  if (
    !Number.isSafeInteger(windowEnd) ||
    windowEnd % HOUR !== 0 ||
    start < 0 ||
    windowEnd > Math.floor(Date.now() / 1000)
  )
    throw new Error("Merkl: window must end at a completed UTC hour");
  await verifyCampaigns();

  // Merkl's from and to are inclusive. The closing hour belongs to the next window.
  const url = `${MERKL_URL}/opportunities/${OPPORTUNITY}/apr-records?from=${start}&to=${windowEnd - 1}&grain=HOUR&items=200`;
  const hours = new Set<number>();
  let sum = 0;
  for (let page = 0; ; page++) {
    const records = await get<AprRecord[]>(`${url}&page=${page}`, REQUEST);
    if (!Array.isArray(records) || records.length > 200)
      throw new Error("Merkl: invalid hourly APR page");
    for (const record of records) {
      const rawTime = record?.timestamp;
      const time =
        typeof rawTime === "string" && /^\d+$/.test(rawTime)
          ? Number(rawTime)
          : rawTime;
      if (
        typeof time !== "number" ||
        !Number.isSafeInteger(time) ||
        time < start ||
        time >= windowEnd ||
        time % HOUR !== 0 ||
        hours.has(time)
      )
        throw new Error(`Merkl: invalid or duplicate hour ${time}`);
      if (
        record.hasUntrustedContribution !== false ||
        !Number.isSafeInteger(record.samples) ||
        record.samples <= 0 ||
        !Number.isFinite(record.avg) ||
        record.avg < 0
      )
        throw new Error(`Merkl: missing or untrusted ZAMA APR at ${time}`);
      sum += record.avg;
      hours.add(time);
    }
    if (records.length < 200) break;
  }
  return {
    observedHours: hours.size,
    expectedHours: HOURS,
    directZamaAprPct: hours.size === HOURS ? sum / HOURS : null,
  };
}

function snapshotAt(rows: StateSnapshot[], timestamp: number) {
  const matches = rows.filter((row) => row?.timestamp === timestamp);
  const snapshot = matches[0];
  if (
    matches.length !== 1 ||
    !snapshot ||
    typeof snapshot.share_price_ray !== "string" ||
    !/^\d+$/.test(snapshot.share_price_ray) ||
    typeof snapshot.total_assets !== "string" ||
    !/^\d+$/.test(snapshot.total_assets)
  )
    throw new Error(
      `Morpho REST: missing, invalid or duplicate snapshot at ${timestamp}`,
    );

  const price = fromUnits(snapshot.share_price_ray, 27);
  if (price <= 0)
    throw new Error(
      `Morpho REST: nonpositive WBTC share price at ${timestamp}`,
    );
  return { price, tvlBtc: fromUnits(snapshot.total_assets, 8) };
}

/**
 * REST state history has daily midnight boundaries and an extra intraday
 * observation. Use the explicit midnight pair for both returns and closing TVL.
 */
export async function fetchRestWindow(
  now: Date = new Date(),
): Promise<DirectRewardComparison> {
  const windowEnd = Math.floor(now.getTime() / (DAY * 1000)) * DAY;
  const windowStart = windowEnd - HOURS * HOUR;
  const [identity, state, coverage] = await Promise.all([
    get<{
      data: {
        chain_id: number;
        address: string;
        asset: { address: string; decimals: number };
      };
    }>(VAULT_URL, REQUEST),
    get<{
      params: { chain_id: string; vault_address: string };
      data: StateSnapshot[];
    }>(`${VAULT_URL}/state/history?lookback=thirty_days`, REQUEST),
    fetchMerklRewardApr(windowEnd),
  ]);
  const vault = identity?.data;
  if (
    vault?.chain_id !== 1 ||
    vault.address?.toLowerCase() !== VAULT_ADDRESS.toLowerCase() ||
    vault.asset?.address?.toLowerCase() !== WBTC_ADDRESS.toLowerCase() ||
    vault.asset.decimals !== 8 ||
    state?.params?.chain_id !== "1" ||
    state.params.vault_address?.toLowerCase() !== VAULT_ADDRESS.toLowerCase() ||
    !Array.isArray(state.data)
  )
    throw new Error(
      "Morpho REST: unexpected vault, chain, underlying or history",
    );

  const opening = snapshotAt(state.data, windowStart);
  const closing = snapshotAt(state.data, windowEnd);
  const nativeApyPct = toPercent(
    Math.expm1(Math.log(closing.price / opening.price) * (365 / 30)),
  );
  return {
    windowStart,
    windowEnd,
    observedAt: Math.floor(Date.now() / 1000),
    tvlBtc: closing.tvlBtc,
    nativeApyPct,
    ...coverage,
    nativePlusDirectZamaPct:
      coverage.directZamaAprPct === null
        ? null
        : add(nativeApyPct, coverage.directZamaAprPct),
    startSharePrice: opening.price,
    endSharePrice: closing.price,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const comparison = await fetchRestWindow();
    console.log(
      JSON.stringify(
        {
          scope: "WBTC share growth plus direct vault ZAMA incentives only",
          rates: "annualized percent",
          timestamps: "Unix seconds (UTC)",
          sharePrices: "WBTC per share",
          tvl: "WBTC at windowEnd",
          morphoSource: `${VAULT_URL}/state/history?lookback=thirty_days`,
          merklSource: `${MERKL_URL}/opportunities/${OPPORTUNITY}/apr-records`,
          ...comparison,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
