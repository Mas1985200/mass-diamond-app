// supabase/functions/ai-chat/video/port.ts
// The door the create_video tool uses to start a video: it calls the separate
// video function (video-engine) over HTTP with the signed-in person's own
// token, so the video function does its own sign-in check, credit check and
// storage. No Deno-only code, so it is tested with a faked network.

import type { CreateVideoArgs } from "./args.ts";

export type VideoCreateFailure =
  | "quota_exceeded"
  | "engine_unavailable"
  | "unsupported"
  | "invalid"
  | "not_signed_in"
  | "temporary";

export type VideoCreateResult =
  | {
      ok: true;
      jobId: string;
      status: string;
      // True when the same request was already started (a repeated request).
      existing: boolean;
      aspectRatio: string;
      durationSeconds: number;
      quality: string;
      creditsCharged: number;
    }
  | {
      ok: false;
      code: VideoCreateFailure;
      retryable: boolean;
      quota?: { used: number; quota: number; plan: string };
    };

export interface VideoCreateOptions {
  // Stays the same when the same chat turn is sent again, and changes for a
  // new request, so a repeated turn never makes (or charges) a second video.
  requestKey: string;
  // The video this one continues or changes, when there is one.
  parentJobId?: string | null;
}

export interface VideoPort {
  create(
    args: CreateVideoArgs,
    options: VideoCreateOptions,
  ): Promise<VideoCreateResult>;
}

export interface VideoPortConfig {
  // The project's address, e.g. https://xxxx.supabase.co
  baseUrl: string;
  // The "Authorization" header of the person's chat request.
  authorization: string;
  conversationId: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const VIDEO_FUNCTION_PATH = "/functions/v1/video-engine";
export const DEFAULT_TIMEOUT_MS = 30_000;

// A stable id (in the shape of a version-4 uuid) made from a text. The same
// text always gives the same id.
export async function uuidFromText(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const FAILURES: Readonly<Record<string, [VideoCreateFailure, boolean]>> = {
  VIDEO_QUOTA_EXCEEDED: ["quota_exceeded", false],
  VIDEO_ENGINE_UNAVAILABLE: ["engine_unavailable", true],
  UNKNOWN_MODEL: ["unsupported", false],
  UNSUPPORTED_REQUEST: ["unsupported", false],
  INVALID_REQUEST: ["invalid", false],
  AUTH_REQUIRED: ["not_signed_in", false],
  STORAGE_UNAVAILABLE: ["temporary", true],
  CREDITS_UNAVAILABLE: ["temporary", true],
  INTERNAL_ERROR: ["temporary", true],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads the video function's answer. Anything unexpected is a temporary
// failure, never a made-up success.
export function readCreateAnswer(status: number, body: unknown): VideoCreateResult {
  if (isRecord(body) && body.ok === true && isRecord(body.job)) {
    const job = body.job;
    if (
      typeof job.id === "string" &&
      typeof job.status === "string" &&
      typeof job.aspectRatio === "string" &&
      typeof job.durationSeconds === "number" &&
      typeof job.quality === "string"
    ) {
      return {
        ok: true,
        jobId: job.id,
        status: job.status,
        existing: body.existing === true,
        aspectRatio: job.aspectRatio,
        durationSeconds: job.durationSeconds,
        quality: job.quality,
        creditsCharged:
          typeof job.creditsCharged === "number" ? job.creditsCharged : 0,
      };
    }
  }

  if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    const code = typeof body.error.code === "string" ? body.error.code : "";
    const [failure, retryable] = FAILURES[code] ?? ["temporary", true];
    const quota = body.error.quota;
    return {
      ok: false,
      code: failure,
      retryable,
      ...(failure === "quota_exceeded" &&
      isRecord(quota) &&
      typeof quota.used === "number" &&
      typeof quota.quota === "number" &&
      typeof quota.plan === "string"
        ? { quota: { used: quota.used, quota: quota.quota, plan: quota.plan } }
        : {}),
    };
  }

  return { ok: false, code: status === 401 ? "not_signed_in" : "temporary", retryable: status !== 401 };
}

export function createVideoPort(config: VideoPortConfig): VideoPort {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, "")}${VIDEO_FUNCTION_PATH}`;

  return {
    async create(args, options) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: config.authorization,
      };
      if (config.apiKey) headers.apikey = config.apiKey;

      const body: Record<string, unknown> = {
        action: "submit",
        client_request_id: await uuidFromText(options.requestKey),
        conversation_id: config.conversationId,
        prompt: args.idea,
        engine_prompt: args.enginePrompt,
        style: args.style,
        aspect_ratio: args.aspectRatio,
        duration_seconds: args.durationSeconds,
        quality: args.quality,
        model: args.model,
      };
      if (options.parentJobId) body.parent_job_id = options.parentJobId;

      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        const answer: unknown = await response.json().catch(() => null);
        return readCreateAnswer(response.status, answer);
      } catch {
        return { ok: false, code: "temporary", retryable: true };
      }
    },
  };
}
