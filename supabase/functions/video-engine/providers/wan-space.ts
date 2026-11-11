// supabase/functions/video-engine/providers/wan-space.ts
// The free test engine: the fast Wan 2.2 (14B, Lightning) image-to-video model
// running in a Hugging Face Space (ZeroGPU), called over plain HTTP with the
// project's own token.
//
// The model always starts from a picture:
//  - image to video: the person's picture is animated;
//  - text to video: a picture is first made from the text (cf-image.ts), then
//    animated. The shape of the video follows the shape of the picture.
//
// It follows the documented "Spaces as API endpoints" protocol:
//   upload  POST {space}/gradio_api/upload                 (the picture)
//   submit  POST {space}/gradio_api/call/{api}   body {"data":[...]}  -> {"event_id"}
//   poll    GET  {space}/gradio_api/call/{api}/{event_id}  (server-sent events)
// A video takes about a minute, so poll() listens for a short time only and
// answers "running" when nothing has finished yet; the worker asks again.
//
// Free ZeroGPU time is small (a few minutes of GPU per day for the whole
// token), so this engine is for testing and light use. Every failure is
// reported with a clear code so the queue can retry, use another engine or
// give the credits back. Nothing here pretends: a bad or unexpected answer is
// an error, never a made-up video.
//
// Secrets: HF_TOKEN (required). For text to video also CF_ACCOUNT_ID and
// CF_AI_TOKEN (see cf-image.ts). Optional: HF_VIDEO_SPACE_URL (default below),
// HF_VIDEO_API_NAME (default "generate_video").

import {
  ProviderError,
  type PollResult,
  type ProviderCapabilities,
  type SubmitResult,
  type VideoKind,
  type VideoProvider,
  type VideoQuality,
  type VideoRequest,
} from "./types.ts";
import { generateImage, readImageConfig } from "./cf-image.ts";

export const WAN_PROVIDER_ID = "hf-wan22-space";
export const DEFAULT_SPACE_URL = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
export const DEFAULT_API_NAME = "generate_video";

const MIN_SECONDS = 0.5;
const MAX_SECONDS = 5;
const GUIDANCE_SCALE = 1;
const SUBMIT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const POLL_LISTEN_MS = 20_000;
const MAX_PICTURE_BYTES = 12 * 1024 * 1024;

// What the model should avoid, in the language it was trained with most.
const NEGATIVE_PROMPT =
  "blurry, low quality, distorted, deformed, extra fingers, bad hands, bad face, static image, no motion, jpeg artifacts, watermark, subtitles, text, logo";

const STEPS: Record<VideoQuality, number> = {
  draft: 4,
  standard: 6,
  high: 8,
};

function capabilitiesFor(textToVideo: boolean): ProviderCapabilities {
  const kinds: VideoKind[] = textToVideo
    ? ["text_to_video", "image_to_video"]
    : ["image_to_video"];
  return {
    id: WAN_PROVIDER_ID,
    label: "Wan 2.2 (free)",
    kinds,
    aspectRatios: ["16:9", "9:16", "1:1"],
    // The Space stops at about 5 s, which also keeps a generation inside the
    // free GPU time limit.
    maxDurationSeconds: MAX_SECONDS,
    free: true,
    costMicroUsdPerSecond: 0,
  };
}

export interface WanInputs {
  prompt: string;
  negativePrompt: string;
  durationSeconds: number;
  steps: number;
  guidance: number;
  guidance2: number;
  seed: number;
}

// Turns the request into the Space's settings. The same rules for every request.
export function buildWanInputs(request: VideoRequest): WanInputs {
  const seconds = Number.isFinite(request.durationSeconds)
    ? request.durationSeconds
    : MAX_SECONDS;
  return {
    prompt: request.prompt,
    negativePrompt: NEGATIVE_PROMPT,
    durationSeconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds)),
    steps: STEPS[request.quality],
    guidance: GUIDANCE_SCALE,
    guidance2: GUIDANCE_SCALE,
    seed: request.seed ?? Math.floor(Math.random() * 2_147_483_647),
  };
}

// The positional list the Space expects, in the order of its API description:
// input_image, prompt, steps, negative_prompt, duration_seconds,
// guidance_scale, guidance_scale_2, seed, randomize_seed.
export function buildCallData(inputs: WanInputs, picturePath: string): unknown[] {
  return [
    { path: picturePath, meta: { _type: "gradio.FileData" } },
    inputs.prompt,
    inputs.steps,
    inputs.negativePrompt,
    inputs.durationSeconds,
    inputs.guidance,
    inputs.guidance2,
    inputs.seed,
    false,
  ];
}

export interface Picture {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
}

// A picture from a data link (data:image/png;base64,...), or null when the
// link is not a valid picture.
export function pictureFromDataLink(link: string): Picture | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(link);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    if (binary.length === 0 || binary.length > MAX_PICTURE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

export function pictureFileName(mime: string): string {
  if (mime === "image/jpeg") return "picture.jpg";
  if (mime === "image/webp") return "picture.webp";
  return "picture.png";
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

// Finds the video link in the Space's answer: [{url|path...}, seed] (or
// [{video:{url|path}}, "status"] for other Spaces).
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

// The person's own picture (a signed storage link or a data link), as bytes.
async function loadPicture(
  link: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Picture> {
  if (link.startsWith("data:")) {
    const picture = pictureFromDataLink(link);
    if (!picture) {
      throw new ProviderError("unsupported_request", "the picture is not readable", false);
    }
    return picture;
  }
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(link, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new ProviderError("timeout", "picture: could not be downloaded", true);
  }
  if (!response.ok) throw statusError(response.status, "picture");
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!mime.startsWith("image/") || bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES) {
    throw new ProviderError("unsupported_request", "the picture is not usable", false);
  }
  return { bytes, mime };
}

// Puts the picture into the Space and returns the file path the Space gave it.
async function uploadPicture(
  config: WanConfig,
  picture: Picture,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append(
    "files",
    new Blob([picture.bytes], { type: picture.mime }),
    pictureFileName(picture.mime),
  );
  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(`${config.spaceUrl}/gradio_api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new ProviderError("timeout", "upload: no answer from the engine", true);
  }
  if (!response.ok) throw statusError(response.status, "upload");
  const body = (await response.json().catch(() => null)) as unknown;
  const path = Array.isArray(body) ? body[0] : null;
  if (typeof path !== "string" || !path) {
    throw new ProviderError("bad_response", "upload: no file path in the answer", true);
  }
  return path;
}

export function createWanSpaceProvider(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
): VideoProvider {
  const config = readWanConfig(env);
  const imageConfig = readImageConfig(env);

  const callUrl = (): string =>
    `${config!.spaceUrl}/gradio_api/call/${config!.apiName}`;

  return {
    // Text to video needs the picture maker; without it only the person's own
    // pictures can be animated.
    capabilities: capabilitiesFor(imageConfig !== null),

    isConfigured(e) {
      return readWanConfig(e) !== null;
    },

    async submit(request, signal): Promise<SubmitResult> {
      if (!config) {
        throw new ProviderError("not_configured", "HF_TOKEN is not set", false);
      }
      const inputs = buildWanInputs(request);

      let picture: Picture;
      if (request.kind === "image_to_video") {
        const link = request.imageUrls[0];
        if (!link) {
          throw new ProviderError("unsupported_request", "no picture to animate", false);
        }
        picture = await loadPicture(link, fetchImpl, signal);
      } else if (request.kind === "text_to_video") {
        if (!imageConfig) {
          throw new ProviderError(
            "not_configured",
            "CF_ACCOUNT_ID and CF_AI_TOKEN are not set",
            false,
          );
        }
        const link = await generateImage(
          imageConfig,
          {
            prompt: request.prompt,
            aspectRatio: request.aspectRatio,
            seed: inputs.seed,
          },
          fetchImpl,
          signal,
        );
        const made = pictureFromDataLink(link);
        if (!made) {
          throw new ProviderError("bad_response", "image: the picture is not readable", true);
        }
        picture = made;
      } else {
        throw new ProviderError("unsupported_request", "this kind of video is not supported", false);
      }

      const picturePath = await uploadPicture(config, picture, fetchImpl, signal);

      const timeout = AbortSignal.timeout(SUBMIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(callUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({ data: buildCallData(inputs, picturePath) }),
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

// end of wan-space.ts
