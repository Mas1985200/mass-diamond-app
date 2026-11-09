// src/features/video/videoCard.ts
// Pure helpers for the video card shown under an answer in the video mode:
// reading the card the server sent, reading the video function's answer,
// choosing what the card shows, how long to wait before asking again, and the
// texts. No React, no DOM, no network, so every rule is tested.
//
// Nothing the server sends is trusted: addresses must be https, numbers are
// clamped, unknown words become safe defaults.

export type Lang = "fa" | "en";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Quality = "draft" | "standard" | "high";

export interface VideoCardData {
  readonly t: "video";
  readonly lang: Lang;
  readonly jobId: string;
  readonly aspectRatio: AspectRatio;
  readonly durationSeconds: number;
  readonly quality: Quality;
}

export type JobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";

export interface VideoJob {
  readonly id: string;
  readonly status: JobStatus;
  readonly progress: number;
  readonly errorCode: string | null;
  readonly videoUrl: string | null;
  readonly thumbnailUrl: string | null;
}

export type JobAnswer =
  | { readonly ok: true; readonly job: VideoJob }
  | {
      readonly ok: false;
      readonly code: string;
      readonly retryable: boolean;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly JobStatus[] = ["queued", "processing", "succeeded", "failed", "canceled"];
export const MAX_CARD_SECONDS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asAspectRatio(value: unknown): AspectRatio {
  return value === "9:16" || value === "1:1" ? value : "16:9";
}

export function asQuality(value: unknown): Quality {
  return value === "draft" || value === "high" ? value : "standard";
}

// The card from the server (see the server's {t:"video"} card). A card with no
// valid job id is dropped, never shown half-made.
export function parseVideoCard(value: Record<string, unknown>): VideoCardData | null {
  const jobId = typeof value.jobId === "string" ? value.jobId.toLowerCase() : "";
  if (!UUID.test(jobId)) return null;

  const seconds =
    typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds)
      ? Math.min(MAX_CARD_SECONDS, Math.max(1, Math.round(value.durationSeconds)))
      : 5;

  return {
    t: "video",
    lang: value.lang === "en" ? "en" : "fa",
    jobId,
    aspectRatio: asAspectRatio(value.aspectRatio),
    durationSeconds: seconds,
    quality: asQuality(value.quality),
  };
}

// Only plain https addresses without spaces or quotes are ever used for the
// player and the download.
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (!/^https:\/\/[^\s"'<>]+$/i.test(value)) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

// What the video function answered: {ok:true, job} or {ok:false, error}.
export function parseJobAnswer(body: unknown): JobAnswer {
  if (isRecord(body) && body.ok === true && isRecord(body.job)) {
    const job = body.job;
    const id = typeof job.id === "string" ? job.id : "";
    const status = STATUSES.find((s) => s === job.status);
    if (UUID.test(id) && status) {
      const progress =
        typeof job.progress === "number" && Number.isFinite(job.progress)
          ? Math.min(100, Math.max(0, Math.round(job.progress)))
          : 0;
      return {
        ok: true,
        job: {
          id,
          status,
          progress,
          errorCode:
            status === "failed" && typeof job.errorCode === "string" && job.errorCode
              ? job.errorCode.slice(0, 64)
              : null,
          videoUrl: status === "succeeded" ? safeHttpsUrl(job.videoUrl) : null,
          thumbnailUrl: status === "succeeded" ? safeHttpsUrl(job.thumbnailUrl) : null,
        },
      };
    }
  }

  if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    const code = typeof body.error.code === "string" ? body.error.code.slice(0, 64) : "UNKNOWN";
    return { ok: false, code, retryable: body.error.retryable === true };
  }

  return { ok: false, code: "UNKNOWN", retryable: true };
}

// ---- what the card shows -------------------------------------------------

export type CardView =
  | { readonly kind: "starting" }
  | { readonly kind: "queued" }
  | { readonly kind: "working"; readonly progress: number }
  | { readonly kind: "ready"; readonly videoUrl: string; readonly posterUrl: string | null }
  | { readonly kind: "failed"; readonly code: string }
  | { readonly kind: "canceled" }
  | { readonly kind: "missing" };

// `job` is the last answer for the job (null before the first answer).
// A finished job with no usable address is shown as failed, never as ready.
export function viewOf(job: VideoJob | null, missing: boolean): CardView {
  if (missing) return { kind: "missing" };
  if (!job) return { kind: "starting" };
  switch (job.status) {
    case "queued":
      return { kind: "queued" };
    case "processing":
      return { kind: "working", progress: job.progress };
    case "succeeded":
      return job.videoUrl
        ? { kind: "ready", videoUrl: job.videoUrl, posterUrl: job.thumbnailUrl }
        : { kind: "failed", code: "no_video" };
    case "failed":
      return { kind: "failed", code: job.errorCode ?? "unknown" };
    case "canceled":
      return { kind: "canceled" };
  }
}

export function isFinishedView(view: CardView): boolean {
  return view.kind === "ready" || view.kind === "failed" || view.kind === "canceled" || view.kind === "missing";
}

// ---- when to ask again ---------------------------------------------------

export interface PollInput {
  // The answers so far that said "still working" (0 before the first).
  readonly workingAnswers: number;
  // Asks in a row that did not get an answer (no internet, server error).
  readonly failuresInRow: number;
  // The page is hidden (another tab, the screen is off).
  readonly hidden: boolean;
}

export const POLL_FIRST_MS = 3_000;
export const POLL_MAX_MS = 15_000;
export const POLL_HIDDEN_MS = 60_000;
export const POLL_FAIL_MAX_MS = 60_000;

// Quick at the start, calmer later; slow after failures so a weak or cut
// connection is not hammered; very slow while nobody is looking.
export function nextPollDelayMs(input: PollInput): number {
  const failures = Math.max(0, Math.floor(input.failuresInRow) || 0);
  const answers = Math.max(0, Math.floor(input.workingAnswers) || 0);

  let delay =
    failures > 0
      ? Math.min(POLL_FAIL_MAX_MS, 5_000 * 2 ** (failures - 1))
      : Math.min(POLL_MAX_MS, POLL_FIRST_MS + answers * 1_000);

  if (input.hidden) delay = Math.max(delay, POLL_HIDDEN_MS);
  return delay;
}

// A job id that the server says does not exist is final; so is a refusal that
// is not retryable. Everything else is tried again later.
export function isFinalAnswerError(code: string, retryable: boolean): boolean {
  return code === "JOB_NOT_FOUND" || code === "AUTH_REQUIRED" || !retryable;
}

// ---- texts ---------------------------------------------------------------

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function formatNumber(value: number, lang: Lang): string {
  const text = String(Math.round(value));
  return lang === "fa"
    ? text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)])
    : text;
}

export function formatPercent(value: number, lang: Lang): string {
  return lang === "fa"
    ? `${formatNumber(value, lang)}٪`
    : `${formatNumber(value, lang)}%`;
}

interface Texts {
  readonly title: string;
  readonly starting: string;
  readonly queued: string;
  readonly working: string;
  readonly patience: string;
  readonly canceled: string;
  readonly missing: string;
  readonly offline: string;
  readonly retry: string;
  readonly cancel: string;
  readonly download: string;
  readonly share: string;
  readonly playerFailed: string;
  readonly seconds: string;
  readonly qualities: Readonly<Record<Quality, string>>;
}

export const VIDEO_CARD_TEXT: Readonly<Record<Lang, Texts>> = {
  fa: {
    title: "ویدیو",
    starting: "در حال شروع…",
    queued: "در صف ساخت…",
    working: "در حال ساخت ویدیو",
    patience: "ساخت ویدیو چند دقیقه طول می‌کشد؛ می‌توانی صفحه را باز بگذاری.",
    canceled: "ساخت این ویدیو لغو شد.",
    missing: "این ویدیو پیدا نشد.",
    offline: "اینترنت ضعیف است؛ دوباره تلاش می‌کنم…",
    retry: "تلاش دوباره",
    cancel: "لغو",
    download: "دانلود",
    share: "اشتراک‌گذاری",
    playerFailed: "پخش ویدیو انجام نشد.",
    seconds: "ثانیه",
    qualities: { draft: "پیش‌نویس", standard: "استاندارد", high: "بالا" },
  },
  en: {
    title: "Video",
    starting: "Starting…",
    queued: "Waiting in the queue…",
    working: "Making your video",
    patience: "A video takes a few minutes; you can leave this page open.",
    canceled: "This video was canceled.",
    missing: "This video was not found.",
    offline: "The connection is weak; trying again…",
    retry: "Try again",
    cancel: "Cancel",
    download: "Download",
    share: "Share",
    playerFailed: "The video could not be played.",
    seconds: "s",
    qualities: { draft: "Draft", standard: "Standard", high: "High" },
  },
};

const FAILURE_TEXT: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  fa: {
    content_rejected: "این درخواست توسط موتور ویدیو پذیرفته نشد. توصیف دیگری امتحان کن.",
    unsupported_request: "این ترکیب (طول یا اندازه) پشتیبانی نمی‌شود. تنظیمات ساده‌تری امتحان کن.",
    timeout: "ساخت ویدیو بیش از حد طول کشید و متوقف شد. اعتبار برگردانده شد.",
    no_engine: "فعلاً موتور ساخت ویدیو در دسترس نیست. کمی بعد دوباره تلاش کن.",
    not_configured: "فعلاً موتور ساخت ویدیو در دسترس نیست. کمی بعد دوباره تلاش کن.",
    quota_exhausted: "ظرفیت موتور ویدیو فعلاً پر است. کمی بعد دوباره تلاش کن.",
    rate_limited: "درخواست‌ها زیاد است. کمی بعد دوباره تلاش کن.",
    engine_busy: "موتور ویدیو الان مشغول است. کمی بعد دوباره تلاش کن.",
    no_video: "ویدیو ساخته شد ولی آدرس آن در دسترس نیست. دوباره تلاش کن.",
  },
  en: {
    content_rejected: "The video engine did not accept this request. Try a different description.",
    unsupported_request: "This combination (length or shape) is not supported. Try simpler settings.",
    timeout: "The video took too long and was stopped. Your credits were returned.",
    no_engine: "The video engine is not available right now. Try again in a little while.",
    not_configured: "The video engine is not available right now. Try again in a little while.",
    quota_exhausted: "The video engine is full for now. Try again in a little while.",
    rate_limited: "There are too many requests. Try again in a little while.",
    engine_busy: "The video engine is busy right now. Try again in a little while.",
    no_video: "The video was made but its link is not available. Try again.",
  },
};

const FAILURE_DEFAULT: Readonly<Record<Lang, string>> = {
  fa: "ساخت ویدیو انجام نشد و اعتبار شما برگردانده شد. دوباره تلاش کن.",
  en: "The video could not be made and your credits were returned. Please try again.",
};

export function failureText(code: string, lang: Lang): string {
  return FAILURE_TEXT[lang][code] ?? FAILURE_DEFAULT[lang];
}

// "9 / 16" for the CSS aspect-ratio of the player box.
export function cssRatio(aspect: AspectRatio): string {
  return aspect.replace(":", " / ");
}

// A safe file name for the download.
export function downloadName(jobId: string): string {
  const short = jobId.replace(/[^0-9a-z]/gi, "").slice(0, 8) || "video";
  return `mass-diamond-${short}.mp4`;
}
