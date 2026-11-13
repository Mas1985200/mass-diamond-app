// supabase/functions/video-engine/providers/fal-video.ts
// A paid, dependable video engine: fal.ai running Wan 2.2 (text to video).
// The video is made straight from the text, in fal's queue, so this engine
// does not need the picture step the free engine needs.
//
// How it works: submit puts the job into fal's queue and returns at once.
// fal answers with two links (status and result). They are kept inside the
// job handle, so later polls never have to guess an address. Every link is
// checked to be a fal.run address before the key is sent to it.
//
// Secrets: FAL_KEY (required). Optional: FAL_VIDEO_MODEL (default below).
// Nothing here ever invents a video; every failure has a clear code.

import {
  ProviderError,
  type PollResult,
  type ProviderCapabilities,
  type SubmitResult,
  type VideoProvider,
  type VideoQuality,
  type VideoRequest,
} from "./types.ts";

export const FAL_PROVIDER_ID = "fal-wan22";
export const DEFAULT_FAL_MODEL = "fal-ai/wan/v2.2-5b/text-to-video";

const QUEUE_BASE = "https://queue.fal.run";
const MIN_SECONDS = 1;
const MAX_SECONDS = 5;
const FPS = 24;
const MIN_FRAMES = 17;
const MAX_FRAMES = 161;
const SUBMIT_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 15_000;

// Price: fal lists about 0.15 US dollars for one default video (81 frames at
// 24 fps, 3.4 s). Per second that is about 44,000 millionths of a dollar.
// Used for cost tracking only, never for what the person is charged.
const COST_MICRO_USD_PER_SECOND = 45_000;

const NEGATIVE_PROMPT =
  "blurry, low quality, distorted, deformed, extra fingers, bad hands, bad face, static image, no motion, jpeg artifacts, watermark, subtitles, text, logo";

const STEPS: Record<VideoQuality, number> = { draft: 20, standard: 30, high: 40 };
const RESOLUTION: Record<VideoQuality, string> = {
  draft: "580p",
  standard: "720p",
  high: "720p",
};

export const FAL_CAPABILITIES: ProviderCapabilities = {
  id: FAL_PROVIDER_ID,
  label: "Wan 2.2",
  kinds: ["text_to_video"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  maxDurationSeconds: MAX_SECONDS,
  free: false,
  costMicroUsdPerSecond: COST_MICRO_USD_PER_SECOND,
};

type Env = Readonly<Record<string, string | undefined>>;

export interface FalConfig {
  key: string;
  model: string;
}

// A model id looks like "fal-ai/wan/v2.2-5b/text-to-video": letters, numbers,
// dots, dashes and underscores, in at least two parts split by "/".
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;
// A key is one piece of visible characters. Anything else (a space, a line
// break, an invisible mark from copying) would break the request header.
const KEY_PATTERN = /^[\x21-\x7E]+$/;

export function readFalConfig(env: Env): FalConfig | null {
  const key = env.FAL_KEY?.trim();
  if (!key || !KEY_PATTERN.test(key)) return null;
  const wanted = env.FAL_VIDEO_MODEL?.trim();
  const model = wanted && MODEL_PATTERN.test(wanted) ? wanted : DEFAULT_FAL_MODEL;
  return { key, model };
}

// The JSON body for fal. The same rules for every request.
export function buildFalInput(request: VideoRequest): Record<string, unknown> {
  const seconds = Number.isFinite(request.durationSeconds)
    ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, request.durationSeconds))
    : MAX_SECONDS;
  const frames = Math.min(
    MAX_FRAMES,
    Math.max(MIN_FRAMES, Math.round(seconds * FPS) + 1),
  );
  const seed =
    request.seed !== undefined && Number.isFinite(request.seed)
      ? Math.abs(Math.floor(request.seed)) % 2_147_483_647
      : undefined;
  return {
    prompt: request.prompt.trim(),
    negative_prompt: NEGATIVE_PROMPT,
    num_frames: frames,
    frames_per_second: FPS,
    resolution: RESOLUTION[request.quality],
    aspect_ratio: request.aspectRatio,
    num_inference_steps: STEPS[request.quality],
    enable_safety_checker: true,
    enable_output_safety_checker: true,
    ...(seed !== undefined ? { seed } : {}),
  };
}

// The two links fal gives for a queued job, kept inside the job handle.
export interface FalHandle {
  statusUrl: string;
  resultUrl: string;
}

// Only fal's own queue addresses are trusted: the key is sent to them.
export function isFalUrl(link: unknown): link is string {
  if (typeof link !== "string") return false;
  try {
    const url = new URL(link);
    return (
      url.protocol === "https:" &&
      (url.hostname === "queue.fal.run" || url.hostname.endsWith(".fal.run"))
    );
  } catch {
    return false;
  }
}

export function encodeHandle(handle: FalHandle): string {
  return JSON.stringify({ s: handle.statusUrl, r: handle.resultUrl });
}

export function decodeHandle(text: string): FalHandle | null {
  try {
    const value = JSON.parse(text) as { s?: unknown; r?: unknown };
    if (isFalUrl(value.s) && isFalUrl(value.r)) {
      return { statusUrl: value.s, resultUrl: value.r };
    }
  } catch {
    // not a handle
  }
  return null;
}

// A short, safe description of why a call failed (never the key or the body).
function reasonOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return String(error).slice(0, 160);
}

// The words of a fal error answer: {"detail": "text"} or
// {"detail": [{"msg": "text", "type": "..."}]}.
export function falErrorText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const { msg, type } = item as { msg?: unknown; type?: unknown };
        return [type, msg].filter((part) => typeof part === "string").join(": ");
      })
      .filter(Boolean)
      .join("; ");
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

// Sorts a failed answer into a clear, honest error.
export function falError(status: number, text: string, where: string): ProviderError {
  const lower = text.toLowerCase();
  if (/content[_ ]policy|nsfw|safety|moderation|not allowed/.test(lower)) {
    return new ProviderError("content_rejected", `${where}: the request was refused by the safety filter`, false);
  }
  if (/balance|insufficient|exhausted|billing|locked|credit/.test(lower) || status === 402) {
    return new ProviderError("quota_exhausted", `${where}: the account has no balance`, false);
  }
  if (status === 401 || status === 403) {
    return new ProviderError("engine_error", `${where}: access refused (${status})`, false);
  }
  if (status === 429) {
    return new ProviderError("rate_limited", `${where}: too many requests`, true);
  }
  if (status === 422 || status === 400) {
    return new ProviderError(
      "unsupported_request",
      `${where}: the engine did not accept the request (${status})${text ? `: ${text.slice(0, 120)}` : ""}`,
      false,
    );
  }
  if (status >= 500) {
    return new ProviderError("engine_busy", `${where}: engine unavailable (${status})`, true);
  }
  return new ProviderError("engine_error", `${where}: unexpected status ${status}`, false);
}

// The video link in fal's result: {"video": {"url": "..."}}.
export function extractFalVideoUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const video = (body as { video?: unknown }).video;
  const url =
    video && typeof video === "object"
      ? (video as { url?: unknown }).url
      : undefined;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// One call with a time limit and the caller's own stop signal (no
// AbortSignal.any, so it works in every runtime).
async function call(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  limitMs: number,
  where: string,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limitMs);
  const onStop = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onStop, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ProviderError(
      "timeout",
      `${where}: no answer from the engine (${timedOut ? "waited too long" : reasonOf(error)})`,
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onStop);
  }
}

export function createFalVideoProvider(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): VideoProvider {
  const config = readFalConfig(env);
  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    Authorization: `Key ${config!.key}`,
  });

  return {
    capabilities: FAL_CAPABILITIES,

    isConfigured(e) {
      return readFalConfig(e) !== null;
    },

    async submit(request, signal): Promise<SubmitResult> {
      if (!config) {
        throw new ProviderError("not_configured", "FAL_KEY is not set", false);
      }
      if (request.kind !== "text_to_video") {
        throw new ProviderError("unsupported_request", "this kind of video is not supported", false);
      }
      const response = await call(
        fetchImpl,
        `${QUEUE_BASE}/${config.model}`,
        { method: "POST", headers: headers(), body: JSON.stringify(buildFalInput(request)) },
        SUBMIT_TIMEOUT_MS,
        "submit",
        signal,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw falError(response.status, falErrorText(body), "submit");
      }
      const body = (await response.json().catch(() => null)) as
        | { request_id?: unknown; status_url?: unknown; response_url?: unknown }
        | null;
      const id = typeof body?.request_id === "string" ? body.request_id : "";
      // fal gives the exact links; build them only if it did not.
      const statusUrl = isFalUrl(body?.status_url)
        ? body.status_url
        : id
          ? `${QUEUE_BASE}/${config.model}/requests/${encodeURIComponent(id)}/status`
          : "";
      const resultUrl = isFalUrl(body?.response_url)
        ? body.response_url
        : id
          ? `${QUEUE_BASE}/${config.model}/requests/${encodeURIComponent(id)}`
          : "";
      if (!isFalUrl(statusUrl) || !isFalUrl(resultUrl)) {
        throw new ProviderError("bad_response", "submit: no job links in the answer", true);
      }
      return { providerJobId: encodeHandle({ statusUrl, resultUrl }) };
    },

    async poll(providerJobId, signal): Promise<PollResult> {
      if (!config) {
        throw new ProviderError("not_configured", "FAL_KEY is not set", false);
      }
      const handle = decodeHandle(providerJobId);
      if (!handle) {
        return {
          state: "failed",
          code: "bad_response",
          message: "poll: the job handle is not readable",
          retryable: false,
        };
      }

      const statusResponse = await call(
        fetchImpl,
        handle.statusUrl,
        { headers: headers() },
        POLL_TIMEOUT_MS,
        "poll",
        signal,
      );
      if (!statusResponse.ok) {
        const body = await statusResponse.json().catch(() => null);
        throw falError(statusResponse.status, falErrorText(body), "poll");
      }
      const status = (await statusResponse.json().catch(() => null)) as
        | { status?: unknown; queue_position?: unknown }
        | null;
      const state = typeof status?.status === "string" ? status.status.toUpperCase() : "";

      if (state === "IN_QUEUE" || state === "IN_PROGRESS") {
        return { state: "running" };
      }
      if (state !== "COMPLETED") {
        throw new ProviderError("bad_response", "poll: unknown status from the engine", true);
      }

      // Finished: a failed job also reports COMPLETED, and the result call
      // then answers with the error.
      const resultResponse = await call(
        fetchImpl,
        handle.resultUrl,
        { headers: headers() },
        POLL_TIMEOUT_MS,
        "result",
        signal,
      );
      if (!resultResponse.ok) {
        const body = await resultResponse.json().catch(() => null);
        const error = falError(resultResponse.status, falErrorText(body), "result");
        return {
          state: "failed",
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        };
      }
      const result = await resultResponse.json().catch(() => null);
      const url = extractFalVideoUrl(result);
      if (!url) {
        return {
          state: "failed",
          code: "bad_response",
          message: "result: the answer had no video file",
          retryable: true,
        };
      }
      return { state: "succeeded", videoUrl: url };
    },
  };
}

// end of fal-video.ts
