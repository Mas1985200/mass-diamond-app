// supabase/functions/ai-chat/quota/limits.ts
// Daily fair-use limits of the AI assistant. Pure code (no network, no Deno),
// so it is tested directly. The numbers come from secrets, so they can be
// changed without a new release.

export const DEFAULT_FREE_DAILY_MESSAGES = 20;
export const DEFAULT_PRO_DAILY_MESSAGES = 500;

// A typo in a secret must never turn into an unlimited or a broken limit.
const MAX_LIMIT = 100_000;

export interface Limits {
  readonly free: number;
  readonly pro: number;
}

export interface QuotaDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly quota: number;
  readonly plan: "free" | "pro";
}

export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    return fallback;
  }

  const value = Number(raw.trim());

  return Number.isSafeInteger(value) && value <= MAX_LIMIT ? value : fallback;
}

export function readLimits(
  getEnv: (name: string) => string | undefined,
): Limits {
  return {
    free: parseLimit(
      getEnv("AI_FREE_DAILY_MESSAGES"),
      DEFAULT_FREE_DAILY_MESSAGES,
    ),
    pro: parseLimit(getEnv("AI_PRO_DAILY_MESSAGES"), DEFAULT_PRO_DAILY_MESSAGES),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// The database function answers with a list that holds one row. Anything
// else is "unknown" (null), never a guess.
export function parseDecision(data: unknown): QuotaDecision | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;

  if (typeof row !== "object" || row === null) {
    return null;
  }

  const record = row as Record<string, unknown>;

  if (
    typeof record.allowed !== "boolean" ||
    !isCount(record.used) ||
    !isCount(record.quota) ||
    (record.plan !== "free" && record.plan !== "pro")
  ) {
    return null;
  }

  return {
    allowed: record.allowed,
    used: record.used,
    quota: record.quota,
    plan: record.plan,
  };
}
