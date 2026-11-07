// supabase/functions/video-engine/credits.ts
// The price of a video in credits, the monthly credits of each plan, and the
// reading of the database's answer when credits are taken. Pure code (no
// network, no Deno), so it is tested directly. The plan sizes come from
// secrets, so they can change without a new release.

import type { VideoQuality } from "./providers/types.ts";

export const DEFAULT_FREE_MONTHLY_CREDITS = 20;
export const DEFAULT_PRO_MONTHLY_CREDITS = 300;

// A typo in a secret must never turn into an unlimited or a broken limit.
const MAX_LIMIT = 1_000_000;

// Credits per second of video. Better quality costs the engine more.
export const CREDITS_PER_SECOND: Readonly<Record<VideoQuality, number>> = {
  draft: 1,
  standard: 2,
  high: 3,
};

export interface VideoLimits {
  readonly free: number;
  readonly pro: number;
}

export interface CreditDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly quota: number;
  readonly plan: "free" | "pro";
}

// The price of one video. Always a whole number of at least 1.
export function creditsFor(
  durationSeconds: number,
  quality: VideoQuality,
): number {
  const seconds = Number.isFinite(durationSeconds)
    ? Math.max(1, Math.ceil(durationSeconds))
    : 1;
  return seconds * CREDITS_PER_SECOND[quality];
}

export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    return fallback;
  }

  const value = Number(raw.trim());

  return Number.isSafeInteger(value) && value <= MAX_LIMIT ? value : fallback;
}

export function readVideoLimits(
  getEnv: (name: string) => string | undefined,
): VideoLimits {
  return {
    free: parseLimit(
      getEnv("VIDEO_FREE_MONTHLY_CREDITS"),
      DEFAULT_FREE_MONTHLY_CREDITS,
    ),
    pro: parseLimit(
      getEnv("VIDEO_PRO_MONTHLY_CREDITS"),
      DEFAULT_PRO_MONTHLY_CREDITS,
    ),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// The database function answers with a list that holds one row. Anything
// else is "unknown" (null), never a guess.
export function parseCreditDecision(data: unknown): CreditDecision | null {
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
