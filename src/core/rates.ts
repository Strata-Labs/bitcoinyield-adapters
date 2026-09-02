import Decimal from "decimal.js";

export type RateType = "apr" | "apy";
export type RateBasis = "calculated" | "reported" | "advertised" | "target";
export type CompoundingEvidenceKind =
  | "unit_value"
  | "nav"
  | "exchange_rate"
  | "protocol_accounting";

export interface CompoundingEvidence {
  kind: CompoundingEvidenceKind;
  /** Pollable field or method whose value accrues into the held position. */
  field: string;
  /** Contract, endpoint, or document that lets us reproduce the observation. */
  reference: string;
}

export interface AutomaticCompounding {
  method: "automatic";
  evidence: CompoundingEvidence;
}

interface BaseRateInput {
  /** Percentage points: 4.2 means 4.2%. */
  value: number;
  basis: RateBasis;
  source: string;
  windowDays?: number;
  observedAt?: string;
  /** Optional linear comparison for a compounded unit-value observation. */
  simpleAprPercent?: number;
}

export interface AprRateInput extends BaseRateInput {
  type: "apr";
  compounding?: { method: "none" | "unknown" };
}

export interface ApyRateInput extends BaseRateInput {
  type: "apy";
  compounding: AutomaticCompounding;
}

export type RateInput = AprRateInput | ApyRateInput;
export type Rate = Readonly<RateInput>;

export interface UnitValueRateInput {
  valueThen: number | string;
  valueNow: number | string;
  periodStart: string;
  periodEnd: string;
  source: string;
  evidence: CompoundingEvidence;
}

const MS_PER_DAY = 86_400_000;

/**
 * Runtime validation for protocol-reported or already-calculated rates.
 * The discriminated input also makes compounding evidence mandatory for APY
 * at compile time; runtime validation protects JavaScript callers and JSON.
 */
export function createRate(input: RateInput): Rate {
  const candidate = input as Partial<RateInput> & {
    compounding?: Partial<AutomaticCompounding>;
  };

  if (candidate.type !== "apr" && candidate.type !== "apy") {
    throw new Error(
      `Rate type must be apr or apy, got ${String(candidate.type)}`,
    );
  }
  requireFinite(candidate.value, "rate.value");
  requireText(candidate.source, "rate.source");

  if (
    candidate.windowDays !== undefined &&
    (!Number.isFinite(candidate.windowDays) || candidate.windowDays <= 0)
  ) {
    throw new Error(
      `rate.windowDays must be positive, got ${candidate.windowDays}`,
    );
  }

  if (candidate.type === "apy") {
    const compounding = candidate.compounding;
    if (
      compounding?.method !== "automatic" ||
      !compounding.evidence ||
      typeof compounding.evidence !== "object"
    ) {
      throw new Error("APY requires automatic compounding evidence");
    }
    requireText(compounding.evidence.field, "rate.compounding.evidence.field");
    requireText(
      compounding.evidence.reference,
      "rate.compounding.evidence.reference",
    );
  }

  return Object.freeze({ ...input });
}

/**
 * Resolve observable value-per-position growth. Because the gain is already
 * retained in the held position, APY is the canonical output. The simple APR
 * annualization is retained only as a comparison, never as the headline.
 */
export function calculateUnitValueRate(input: UnitValueRateInput): Rate {
  const valueThen = new Decimal(input.valueThen);
  const valueNow = new Decimal(input.valueNow);
  if (!valueThen.isFinite() || valueThen.lte(0)) {
    throw new Error(`valueThen must be positive, got ${input.valueThen}`);
  }
  if (!valueNow.isFinite() || valueNow.lte(0)) {
    throw new Error(`valueNow must be positive, got ${input.valueNow}`);
  }

  const startMs = Date.parse(input.periodStart);
  const endMs = Date.parse(input.periodEnd);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    throw new Error(
      `Invalid unit-value period: ${input.periodStart} -> ${input.periodEnd}`,
    );
  }

  const windowDays = (endMs - startMs) / MS_PER_DAY;
  const annualization = new Decimal(365).div(windowDays);
  const growth = valueNow.div(valueThen);
  const periodReturn = growth.minus(1);
  const simpleAprPercent = periodReturn.mul(annualization).mul(100).toNumber();
  const apyPercent = growth.pow(annualization).minus(1).mul(100).toNumber();

  return createRate({
    type: "apy",
    value: apyPercent,
    basis: "calculated",
    source: input.source,
    windowDays,
    observedAt: input.periodEnd,
    simpleAprPercent,
    compounding: {
      method: "automatic",
      evidence: input.evidence,
    },
  });
}

function requireFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite, got ${String(value)}`);
  }
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
}
