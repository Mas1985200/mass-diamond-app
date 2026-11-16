// src/features/video/videoCredits.ts
// Pure rules of the credit display in the video chooser: reading the video
// function's answer about this month's credits, how many videos they are
// enough for, and the words shown. No React, no DOM, no network, so every rule
// is tested. Nothing the server sends is trusted: a number that is not a
// whole count, an unknown plan or a bad date makes the whole answer "not ok",
// so the app shows nothing instead of a wrong number.

import type { Lang } from "./videoCard.ts";
import {
  creditsForVideo,
  DEFAULT_CREDITS_PER_SECOND,
  type CreditsPerSecond,
} from "./videoModels.ts";

export interface CreditsStatus {
  readonly plan: "free" | "pro";
  readonly used: number;
  readonly quota: number;
  readonly remaining: number;
  // When the credits begin again (an ISO date).
  readonly resetsAt: string;
}

export type CreditsAnswer =
  | { readonly ok: true; readonly credits: CreditsStatus }
  | { readonly ok: false };

// The video the remaining credits are counted in: a standard one of 5 seconds.
export const SAMPLE_SECONDS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// The video function's answer to {"action":"credits"}.
export function parseCreditsAnswer(body: unknown): CreditsAnswer {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.credits)) {
    return { ok: false };
  }

  const raw = body.credits;

  if (
    (raw.plan !== "free" && raw.plan !== "pro") ||
    !isCount(raw.used) ||
    !isCount(raw.quota) ||
    !isCount(raw.remaining) ||
    typeof raw.resetsAt !== "string" ||
    !Number.isFinite(Date.parse(raw.resetsAt))
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    credits: {
      plan: raw.plan,
      used: raw.used,
      quota: raw.quota,
      remaining: Math.min(raw.remaining, raw.quota),
      resetsAt: new Date(raw.resetsAt).toISOString(),
    },
  };
}

// How many standard videos of SAMPLE_SECONDS the remaining credits pay for.
export function videosLeft(
  remaining: number,
  prices: CreditsPerSecond = DEFAULT_CREDITS_PER_SECOND,
): number {
  const price = creditsForVideo(SAMPLE_SECONDS, "standard", prices);

  return price > 0 ? Math.floor(Math.max(0, remaining) / price) : 0;
}

export const CREDITS_TEXT: Record<Lang, {
  readonly title: string;
  readonly left: (remaining: number, quota: number) => string;
  readonly videos: (count: number) => string;
  readonly none: string;
  readonly plans: Readonly<Record<"free" | "pro", string>>;
}> = {
  fa: {
    title: "اعتبار این ماه",
    left: (remaining, quota) =>
      `${remaining.toLocaleString("fa-IR")} از ${quota.toLocaleString("fa-IR")} اعتبار باقی است`,
    videos: (count) =>
      `برای ${count.toLocaleString("fa-IR")} ویدیوی ${SAMPLE_SECONDS.toLocaleString("fa-IR")} ثانیه‌ای استاندارد کافی است`,
    none: "اعتبار این ماه تمام شده است",
    plans: { free: "طرح رایگان", pro: "طرح حرفه‌ای" },
  },
  en: {
    title: "Credits this month",
    left: (remaining, quota) =>
      `${remaining.toLocaleString("en-US")} of ${quota.toLocaleString("en-US")} credits left`,
    videos: (count) =>
      `Enough for ${count.toLocaleString("en-US")} standard video${count === 1 ? "" : "s"} of ${SAMPLE_SECONDS} seconds`,
    none: "This month's credits are used up",
    plans: { free: "Free plan", pro: "Pro plan" },
  },
};

export interface CreditLines {
  readonly title: string;
  readonly left: string;
  // What the credits are enough for, or that they are used up.
  readonly detail: string;
  readonly plan: string;
}

// The lines shown for a status, in the given language.
export function creditLines(
  status: CreditsStatus,
  prices: CreditsPerSecond = DEFAULT_CREDITS_PER_SECOND,
  lang: Lang = "fa",
): CreditLines {
  const text = CREDITS_TEXT[lang];
  const count = videosLeft(status.remaining, prices);

  return {
    title: text.title,
    left: text.left(status.remaining, status.quota),
    detail: status.remaining <= 0 || count <= 0 ? text.none : text.videos(count),
    plan: text.plans[status.plan],
  };
}

// end of videoCredits.ts
