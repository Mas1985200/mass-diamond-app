// supabase/functions/video-engine/admission.ts
// The doorman of the video queue: decides whether a new video may enter now.
// Two rules keep the engine alive on a day when very many people ask at once:
//  - one person may have only a few videos in the queue at the same time
//    (nobody can fill the queue alone), and
//  - the whole queue has a size limit that matches the GPUs we have; when it is
//    full the person is told to come back in a moment, instead of waiting in a
//    line that never moves.
// Both limits come from secrets, so they can change in a minute without a new
// release. Pure code (no network, no Deno), tested directly.

import { parseLimit } from "./credits.ts";

export const DEFAULT_MAX_ACTIVE_PER_USER = 2;
export const DEFAULT_MAX_QUEUE = 200;

// How long the app is told to wait before it asks again.
export const RETRY_AFTER_TOO_MANY_ACTIVE_SECONDS = 30;
export const RETRY_AFTER_QUEUE_FULL_SECONDS = 120;

export interface AdmissionLimits {
  // Videos of one person that may be waiting or being made at the same time.
  readonly maxActivePerUser: number;
  // Videos of everybody that may be waiting or being made at the same time.
  // 0 closes the door for new videos (a switch for maintenance or an emergency).
  readonly maxQueue: number;
}

export interface QueueCounts {
  // The person's own videos that are queued or being made.
  readonly userActive: number;
  // Everybody's videos that are queued or being made.
  readonly totalActive: number;
}

export type AdmissionDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "too_many_active" | "queue_full";
      readonly retryAfterSeconds: number;
      // The limit that was reached, so the app can say it.
      readonly limit: number;
    };

export function readAdmissionLimits(
  getEnv: (name: string) => string | undefined,
): AdmissionLimits {
  return {
    maxActivePerUser: parseLimit(
      getEnv("VIDEO_MAX_ACTIVE_PER_USER"),
      DEFAULT_MAX_ACTIVE_PER_USER,
    ),
    maxQueue: parseLimit(getEnv("VIDEO_MAX_QUEUE"), DEFAULT_MAX_QUEUE),
  };
}

// A count from the database is a whole number of 0 or more, or it is unknown
// (null): the caller must not guess a number.
export function parseCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function decideAdmission(
  counts: QueueCounts,
  limits: AdmissionLimits,
): AdmissionDecision {
  if (counts.userActive >= limits.maxActivePerUser) {
    return {
      ok: false,
      code: "too_many_active",
      retryAfterSeconds: RETRY_AFTER_TOO_MANY_ACTIVE_SECONDS,
      limit: limits.maxActivePerUser,
    };
  }

  if (counts.totalActive >= limits.maxQueue) {
    return {
      ok: false,
      code: "queue_full",
      retryAfterSeconds: RETRY_AFTER_QUEUE_FULL_SECONDS,
      limit: limits.maxQueue,
    };
  }

  return { ok: true };
}

// end of admission.ts
