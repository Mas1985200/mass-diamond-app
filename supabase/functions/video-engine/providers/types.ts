// supabase/functions/video-engine/providers/types.ts
// The contract every video engine (provider) follows. The rest of the video
// engine only knows this contract, so an engine can be added, replaced or put
// behind another one (fallback) without touching the queue, the credits or the
// app. Pure types and small helpers: no network, nothing to install, so every
// rule here can be tested.

export type VideoKind =
  | "text_to_video"
  | "image_to_video"
  | "multi_image_to_video";

export type VideoStyle =
  | "auto"
  | "realistic"
  | "cinematic"
  | "animation"
  | "advertising"
  | "educational";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type VideoQuality = "draft" | "standard" | "high";

// What the queue asks an engine to make. The prompt is the final, professional
// prompt (written by the prompt step), not the person's raw words.
export interface VideoRequest {
  kind: VideoKind;
  prompt: string;
  style: VideoStyle;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  quality: VideoQuality;
  seed?: number;
  // Short-lived links the engine can download the pictures from (signed
  // storage links). Empty for text_to_video.
  imageUrls: string[];
}

// What an engine can do. The router uses it to skip engines that cannot make
// a request, and the credit price is computed from it.
export interface ProviderCapabilities {
  id: string;
  label: string;
  kinds: readonly VideoKind[];
  aspectRatios: readonly AspectRatio[];
  maxDurationSeconds: number;
  // True when using the engine costs no money (a free-tier engine).
  free: boolean;
  // Real money cost per second of video, in millionths of a US dollar
  // (0 for a free engine). Used for cost tracking only.
  costMicroUsdPerSecond: number;
}

// The engine's own handle for a started video, kept in video_jobs.provider_job_id.
export interface SubmitResult {
  providerJobId: string;
}

export type PollResult =
  | { state: "running"; progress?: number }
  | {
      state: "succeeded";
      // Where the finished file can be downloaded by the server.
      videoUrl: string;
      durationSeconds?: number;
      costMicroUsd?: number;
    }
  | {
      state: "failed";
      code: ProviderErrorCode;
      message: string;
      // True when trying again later may work (busy, quota, timeout).
      retryable: boolean;
    };

export type ProviderErrorCode =
  | "not_configured"
  | "unsupported_request"
  | "rate_limited"
  | "quota_exhausted"
  | "engine_busy"
  | "engine_error"
  | "bad_response"
  | "timeout"
  | "content_rejected";

// A failure that stops the current try; the queue decides to retry, to use the
// next engine, or to give up and give the credits back.
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface VideoProvider {
  readonly capabilities: ProviderCapabilities;
  // True when the secrets this engine needs are present. An engine that is
  // not configured is simply skipped by the router.
  isConfigured(env: Readonly<Record<string, string | undefined>>): boolean;
  // Starts the video. Must return quickly (seconds), never wait for the video.
  submit(request: VideoRequest, signal?: AbortSignal): Promise<SubmitResult>;
  // Asks how the video is going. Must return quickly; "running" is a normal
  // answer. Called again and again by the worker until it is done.
  poll(providerJobId: string, signal?: AbortSignal): Promise<PollResult>;
}

// Can this engine make this request at all?
export function supportsRequest(
  capabilities: ProviderCapabilities,
  request: VideoRequest,
): boolean {
  return (
    capabilities.kinds.includes(request.kind) &&
    capabilities.aspectRatios.includes(request.aspectRatio) &&
    request.durationSeconds >= 1 &&
    request.durationSeconds <= capabilities.maxDurationSeconds
  );
}
