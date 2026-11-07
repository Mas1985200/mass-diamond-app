// supabase/functions/video-engine/providers/wan-space.ts
// The free test engine: the Wan2.2 (TI2V-5B) video model running in a Hugging
// Face Space (ZeroGPU), called over plain HTTP with the project's own token.
//
// It follows the documented "Spaces as API endpoints" protocol:
//   submit  POST {space}/gradio_api/call/{api}   body {"data":[...]}  -> {"event_id"}
//   poll    GET  {space}/gradio_api/call/{api}/{event_id}  (server-sent events)
// A video takes 2-3 minutes, so poll() listens for a short time only and
// answers "running" when nothing has finished yet; the worker asks again.
//
// Free ZeroGPU time is small (a few minutes of GPU per day for the whole
// token), so this engine is for testing and light use. Every failure is
// reported with a clear code so the queue can retry, use another engine or
// give the credits back. Nothing here pretends: a bad or unexpected answer is
// an error, never a made-up video.
//
// Secrets: HF_TOKEN (required). Optional: HF_VIDEO_SPACE_URL (default below),
// HF_VIDEO_API_NAME (default "generate_video").

import {
  ProviderError,
  type AspectRatio,
  type PollResult,
  type ProviderCapabilities,
  type SubmitResult,
  type VideoProvider,
  type VideoQuality,
  type VideoRequest,
} from "./types.ts";

export const WAN_PROVIDER_ID = "hf-wan22-space";
export const DEFAULT_SPACE_URL = "https://smikke-wan2-video-generation.hf.space";
export const DEFAULT_API_NAME = "generate_video";

const FPS = 24;
const MIN_FRAMES = 25;
const MAX_FRAMES = 145;
const SUBMIT_TIMEOUT_MS = 15_000;
const POLL_LISTEN_MS = 20_000;
const GUIDANCE_SCALE = 5;

const CAPABILITIES: ProviderCapabilities = {
  id: WAN_PROVIDER_ID,
  label: "Wan 2.2 (free)",
  kinds: ["text_to_video", "image_to_video"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  // The Space stops at 145 frames; 5 s keeps a generation inside the free
  // 3-minute GPU limit.
  maxDurationSeconds: 5,
  free: true,
  costMicroUsdPerSecond: 0,
};

// Sizes the Space accepts (width 512-1920, height 512-1080), multiples of 32.
const SIZES: Record<VideoQuality, Record<AspectRatio, [number, number]>> = {
  draft: { "16:9": [896, 512], "9:16": [512, 896], "1:1": [512, 512] },
  standard: { "16:9": [896, 512], "9:16": [512, 896], "1:1": [512, 512] },
  high: { "16:9": [1024, 576], "9:16": [576, 1024], "1:1": [768, 768] },
};

const STEPS: Record<VideoQuality, number> = {
  draft: 20,
  standard: 30,
  high: 40,
};

export interface WanInputs {
  prompt: string;
  imageUrl: string | null;
  width: number;
  height: number;
  numFrames: number;
  steps: number;
  guidance: number;
  seed: number;
}

// Turns the request into the Space's settings. The same rules for every request.
export function buildWanInputs(request: VideoRequest): WanInputs {
  const [width, height] = SIZES[request.quality][request.aspectRatio];
  const frames = Math.round(request.durationSeconds * FPS) + 1;
  return {
    prompt: request.prompt,
    imageUrl:
      request.kind === "image_to_video" ? (request.imageUrls[0] ?? null) : null,
    width,
    height,
    numFrames: Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, frames)),
    steps: STEPS[request.quality],
    guidance: GUIDANCE_SCALE,
    seed: request.seed ?? Math.floor(Math.random() * 2_147_483_647),
  };
}

// The positional list the Space expects, in the order of its API description:
// prompt, image, width, height, num_frames, num_inference_steps,
// guidance_scale, seed.
export function buildCallData(inputs: WanInputs): unknown[] {
  const image = inputs.imageUrl
    ? {
        path: inputs.imageUrl,
        url: inputs.imageUrl,
        meta: { _type: "gradio.FileData" },
      }
    : null;
  return [
    inputs.prompt,
    image,
    inputs.width,
    inputs.height,
    inputs.numFrames,
    inputs.steps,
    inputs.guidance,
    inputs.seed,
  ];
}

export interface SseEvent {
  event: string;
  data: string;
}

// Reads the finished blocks of a server-sent-events text. A block that is not
// finished yet (no blank line after it) is left out.
export function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
  blocks.pop(); // the last piece is unfinished (or empty)
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0 || event !== "message") {
      events.push({ event, data: data.join("\n") });
    }
  }
  return events;
}

// Finds the video link in the Space's answer: [{video:{url|path}}, "status"].
export function extractVideoUrl(
  payload: unknown,
  spaceUrl: string,
): string | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const file =
    first && typeof first === "object" && "video" in first
      ? (first as { video: unknown }).video
      : first;
  if (typeof file === "string") return absolute(file, spaceUrl);
  if (file && typeof file === "object") {
    const { url, path } = file as { url?: unknown; path?: unknown };
    if (typeof url === "string" && url) return absolute(url, spaceUrl);
    if (typeof path === "string" && path) {
      return absolute(`/gradio_api/file=${path}`, spaceUrl);
    }
  }
  return null;
}

function absolute(link: string, spaceUrl: string): string | null {
  try {
    return new URL(link, `${spaceUrl}/`).toString();
  } catch {
    return null;
  }
}

// Sorts an error text from the Space into a clear, honest code.
export function classifyEngineError(text: string): {
  code: "quota_exhausted" | "engine_busy" | "content_rejected" | "engine_error";
  retryable: boolean;
} {
  const lower = text.toLowerCase();
  if (/quota|zerogpu|gpu (time|limit)|exceeded/.test(lower)) {
    return { code: "quota_exhausted", retryable: true };
  }
  if (/queue|busy|overload|too many|capacity/.test(lower)) {
    return { code: "engine_busy", retryable: true };
  }
  if (/nsfw|safety|not allowed|policy/.test(lower)) {
    return { code: "content_rejected", retryable: false };
  }
  return { code: "engine_error", retryable: true };
}

export interface WanConfig {
  token: string;
  spaceUrl: string;
  apiName: string;
}

export function readWanConfig(
  env: Readonly<Record<string, string | undefined>>,
): WanConfig | null {
  const token = env.HF_TOKEN?.trim();
  if (!token) return null;
  const spaceUrl = (env.HF_VIDEO_SPACE_URL?.trim() || DEFAULT_SPACE_URL)
    .replace(/\/+$/, "");
  const apiName = (env.HF_VIDEO_API_NAME?.trim() || DEFAULT_API_NAME)
    .replace(/^\/+/, "");
  return { token, spaceUrl, apiName };
}

function statusError(status: number, where: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("engine_error", `${where}: access refused (${status})`, false);
  }
  if (status === 429) {
    return new ProviderError("rate_limited", `${where}: too many requests`, true);
  }
  if (status === 503 || status === 502 || status === 504) {
    return new ProviderError("engine_busy", `${where}: engine unavailable (${status})`, true);
  }
  return new ProviderError("engine_error", `${where}: unexpected status ${status}`, status >= 500);
}

export function createWanSpaceProvider(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
): VideoProvider {
  const config = readWanConfig(env);

  const callUrl = (): string =>
    `${config!.spaceUrl}/gradio_api/call/${config!.apiName}`;

  return {
    capabilities: CAPABILITIES,

    isConfigured(e) {
      return readWanConfig(e) !== null;
    },

    async submit(request, signal): Promise<SubmitResult> {
      if (!config) {
        throw new ProviderError("not_configured", "HF_TOKEN is not set", false);
      }
      const timeout = AbortSignal.timeout(SUBMIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(callUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({ data: buildCallData(buildWanInputs(request)) }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch {
        throw new ProviderError("timeout", "submit: no answer from the engine", true);
      }
      if (!response.ok) throw statusError(response.status, "submit");
      const body = (await response.json().catch(() => null)) as
        | { event_id?: unknown }
        | null;
      const eventId = body?.event_id;
      if (typeof eventId !== "string" || !eventId) {
        throw new ProviderError("bad_response", "submit: no event id in the answer", true);
      }
      return { providerJobId: eventId };
    },

    async poll(providerJobId, signal): Promise<PollResult> {
      if (!config) {
        throw new ProviderError("not_configured", "HF_TOKEN is not set", false);
      }
      const listen = AbortSignal.timeout(POLL_LISTEN_MS);
      const both = signal ? AbortSignal.any([signal, listen]) : listen;
      let text = "";
      try {
        const response = await fetchImpl(
          `${callUrl()}/${encodeURIComponent(providerJobId)}`,
          {
            headers: { Authorization: `Bearer ${config.token}` },
            signal: both,
          },
        );
        if (!response.ok) throw statusError(response.status, "poll");
        const reader = response.body?.getReader();
        if (!reader) {
          throw new ProviderError("bad_response", "poll: empty answer", true);
        }
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (value) text += decoder.decode(value, { stream: !done });
          const result = readOutcome(text, config.spaceUrl);
          if (result) {
            await reader.cancel().catch(() => undefined);
            return result;
          }
          if (done) break;
        }
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        // Our own listening time ran out: the video is simply not ready yet.
        if (signal?.aborted) throw error;
        const late = readOutcome(text, config.spaceUrl);
        return late ?? { state: "running" };
      }
      return (
        readOutcome(text, config.spaceUrl) ?? {
          state: "failed",
          code: "bad_response",
          message: "poll: the engine closed the stream without a result",
          retryable: true,
        }
      );
    },
  };
}

// The result found in the events read so far, or null when still running.
export function readOutcome(text: string, spaceUrl: string): PollResult | null {
  for (const event of parseSseEvents(text)) {
    if (event.event === "complete") {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return failed("bad_response", "the answer was not readable", true);
      }
      const url = extractVideoUrl(payload, spaceUrl);
      return url
        ? { state: "succeeded", videoUrl: url }
        : failed("bad_response", "the answer had no video file", true);
    }
    if (event.event === "error") {
      const detail = event.data && event.data !== "null" ? event.data : "engine error";
      const { code, retryable } = classifyEngineError(detail);
      return failed(code, detail.slice(0, 300), retryable);
    }
  }
  return null;
}

function failed(
  code: "bad_response" | "quota_exhausted" | "engine_busy" | "content_rejected" | "engine_error",
  message: string,
  retryable: boolean,
): PollResult {
  return { state: "failed", code, message, retryable };
}
