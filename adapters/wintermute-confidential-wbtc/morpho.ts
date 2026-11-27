import { post } from "../../src/core/utils/http.js";
import * as math from "../../src/core/utils/math.js";
import {
  requireNumber,
  requirePositive,
} from "../../src/core/utils/validators.js";

export const VAULT_ADDRESS = "0x3d5EcCb62974178236A768A7ef14D3ce468Fbe91";
export const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
export const ZAMA_ADDRESS = "0xA12CC123ba206d4031D1c7f6223D1C2Ec249f4f3";
export const MORPHO_GRAPHQL_URL = "https://api.morpho.org/graphql";

const HOUR = 3600;
const DAYS = 30;
const HOURS = DAYS * 24;
const QUERY = `
  query WintermuteWindow($start: Int!, $end: Int!) {
    vaultV2ByAddress(address: "${VAULT_ADDRESS}", chainId: 1) {
      address chain { id } asset { address symbol decimals } totalAssets
      netApy netApyExcludingRewards rewards { asset { address symbol } supplyApr }
      historicalState {
        sharePrice(options: {startTimestamp: $start, endTimestamp: $end, interval: HOUR}) { x y }
        inclusiveOneHour: avgNetApy(lookbackHours: 1, options: {startTimestamp: $start, endTimestamp: $end, interval: HOUR}) { x y }
        nativeOneHour: avgApy(lookbackHours: 1, options: {startTimestamp: $start, endTimestamp: $end, interval: HOUR}) { x y }
      }
    }
  }
`;

interface Point {
  x: number;
  y: number | null;
}

interface Vault {
  address: string;
  chain: { id: number };
  asset: { address: string; symbol: string; decimals: number };
  totalAssets: number | string | null;
  netApy: number | null;
  netApyExcludingRewards: number | null;
  rewards:
    | { asset: { address: string; symbol: string }; supplyApr: number | null }[]
    | null;
  historicalState: {
    sharePrice: Point[];
    inclusiveOneHour: Point[];
    nativeOneHour: Point[];
  };
}

export interface MorphoWindow {
  windowStart: number;
  windowEnd: number;
  observedAt: number;
  tvlBtc: number;
  nativeApyPct: number;
  rewardAprPct: number;
  totalApyPct: number;
  startSharePrice: number;
  endSharePrice: number;
  observedHours: number;
  expectedHours: number;
  spotNativeApyPct: number | null;
  spotZamaAprPct: number | null;
  spotTotalApyPct: number | null;
}

/** The source answered but did not establish a valid observation for this window. */
export class MorphoDataError extends Error {
  override name = "MorphoDataError";
}

function hourlyPoints(
  points: Point[],
  field: string,
  start: number,
  end: number,
) {
  if (!Array.isArray(points))
    throw new Error(`Morpho: missing ${field} history`);
  const values = new Map<number, number | null>();
  for (const point of points) {
    if (
      !Number.isSafeInteger(point?.x) ||
      point.x % HOUR !== 0 ||
      point.x < start ||
      point.x > end
    ) {
      throw new Error(`Morpho: invalid ${field} timestamp`);
    }
    if (values.has(point.x))
      throw new Error(`Morpho: duplicate ${field} at ${point.x}`);
    values.set(point.x, point.y);
  }
  return values;
}

function spotPercent(rate: number | null | undefined): number | null {
  return rate == null
    ? null
    : math.toPercent(requireNumber(rate, "Morpho spot rate"));
}

function zamaReward(rewards: Vault["rewards"]): number | null {
  if (!Array.isArray(rewards)) return null;
  if (rewards.some((r) => !/^0x[0-9a-fA-F]{40}$/.test(r?.asset?.address)))
    return null;
  const matches = rewards.filter(
    (r) => r.asset.address.toLowerCase() === ZAMA_ADDRESS.toLowerCase(),
  );
  if (matches.length === 0) return 0;
  const reward = matches[0]!;
  if (
    matches.length !== 1 ||
    reward.asset.symbol !== "ZAMA" ||
    reward.supplyApr == null ||
    reward.supplyApr < 0
  )
    return null;
  return spotPercent(reward.supplyApr);
}

/** Window timestamps are Unix seconds. Spot rates and TVL describe the time of retrieval. */
export async function fetchMorphoWindow(
  endTimestamp: number,
): Promise<MorphoWindow> {
  const windowStart = endTimestamp - HOURS * HOUR;
  if (
    !Number.isSafeInteger(endTimestamp) ||
    endTimestamp % HOUR !== 0 ||
    windowStart < 0 ||
    endTimestamp > Math.floor(Date.now() / 1000)
  ) {
    throw new MorphoDataError(
      "Morpho: window must end at a completed UTC hour",
    );
  }
  const response = await post<{
    data?: { vaultV2ByAddress?: Vault | null };
    errors?: { message?: string }[];
  }>(
    MORPHO_GRAPHQL_URL,
    { query: QUERY, variables: { start: windowStart, end: endTimestamp } },
    { timeout: 15_000, retries: 1 },
  );
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    throw new Error(`Morpho GraphQL error: ${JSON.stringify(response.errors)}`);
  }
  try {
    return parseWindow(
      response?.data?.vaultV2ByAddress,
      windowStart,
      endTimestamp,
    );
  } catch (cause) {
    throw new MorphoDataError(
      cause instanceof Error ? cause.message : "Morpho: invalid observation",
      { cause },
    );
  }
}

function parseWindow(
  vault: Vault | null | undefined,
  windowStart: number,
  endTimestamp: number,
): MorphoWindow {
  if (
    vault?.address?.toLowerCase() !== VAULT_ADDRESS.toLowerCase() ||
    vault.chain?.id !== 1 ||
    vault.asset?.address?.toLowerCase() !== WBTC_ADDRESS.toLowerCase() ||
    vault.asset.symbol !== "WBTC" ||
    vault.asset.decimals !== 8
  ) {
    throw new Error("Morpho: unexpected vault, chain or WBTC underlying");
  }
  const raw = vault.totalAssets;
  if (
    !(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) &&
    !(typeof raw === "string" && /^\d+$/.test(raw))
  ) {
    throw new Error("Morpho: missing or invalid raw WBTC totalAssets");
  }
  const history = vault.historicalState;
  if (!history) throw new Error("Morpho: missing vault history");
  const prices = hourlyPoints(
    history.sharePrice,
    "share price",
    windowStart,
    endTimestamp,
  );
  const inclusive = hourlyPoints(
    history.inclusiveOneHour,
    "inclusive APY",
    windowStart,
    endTimestamp,
  );
  const native = hourlyPoints(
    history.nativeOneHour,
    "native APY",
    windowStart,
    endTimestamp,
  );
  const startSharePrice = requirePositive(
    prices.get(windowStart),
    "Morpho opening WBTC share price",
  );
  const endSharePrice = requirePositive(
    prices.get(endTimestamp),
    "Morpho closing WBTC share price",
  );

  // Morpho's timeseries bounds are inclusive. The annualized incentive mean uses
  // [start, end); only the closing share price belongs to the endpoint itself.
  let rewardSum = 0;
  let observedHours = 0;
  for (let t = windowStart; t < endTimestamp; t += HOUR) {
    const withRewards = requireNumber(
      inclusive.get(t),
      `Morpho inclusive APY at ${t}`,
    );
    const withoutRewards = requireNumber(
      native.get(t),
      `Morpho native APY at ${t}`,
    );
    const incentive = withRewards - withoutRewards;
    if (incentive < 0)
      throw new Error(`Morpho: negative implied incentive at ${t}`);
    rewardSum += incentive;
    observedHours++;
  }
  const nativeApyPct = math.toPercent(
    Math.expm1(Math.log(endSharePrice / startSharePrice) * (365 / DAYS)),
  );
  const rewardAprPct = math.toPercent(rewardSum / HOURS);
  return {
    windowStart,
    windowEnd: endTimestamp,
    observedAt: Math.floor(Date.now() / 1000),
    tvlBtc: math.fromUnits(raw, vault.asset.decimals),
    nativeApyPct,
    rewardAprPct,
    totalApyPct: math.add(nativeApyPct, rewardAprPct),
    startSharePrice,
    endSharePrice,
    observedHours,
    expectedHours: HOURS,
    spotNativeApyPct: spotPercent(vault.netApyExcludingRewards),
    spotZamaAprPct: zamaReward(vault.rewards),
    spotTotalApyPct: spotPercent(vault.netApy),
  };
}
