// src/features/video/videoApi.ts
// Asks the video function (video-engine) about a video, or cancels it. The
// network and the sign-in are given in (see videoClient.ts), so every case is
// tested without a network.
//
// The function answers {"ok":true,"job":{...}} or {"ok":false,"error":{...}}.
// This file only turns "something went wrong on the way" into three clear
// outcomes; reading the answer itself is parseJobAnswer's job.

import { parseJobAnswer, type JobAnswer } from "./videoCard.ts";

export type CallOutcome =
  // The function answered (even with an error it explains).
  | { readonly kind: "answer"; readonly answer: JobAnswer }
  // No answer could be read: no internet, a timeout, or a broken reply.
  | { readonly kind: "unreachable" }
  // The caller stopped the call (the card went away).
  | { readonly kind: "aborted" };

export interface VideoAuth {
  // The project's address, e.g. https://xxxx.supabase.co
  readonly url: string;
  readonly token: string;
  readonly anonKey: string | null;
}

export interface VideoApiDeps {
  // The signed-in person's access data, or null when nobody is signed in.
  readonly getAuth: () => Promise<VideoAuth | null>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export const VIDEO_FUNCTION_PATH = "/functions/v1/video-engine";
export const CALL_TIMEOUT_MS = 25_000;

type Action = "status" | "cancel";

async function call(
  deps: VideoApiDeps,
  action: Action,
  jobId: string,
  signal?: AbortSignal,
): Promise<CallOutcome> {
  if (signal?.aborted) return { kind: "aborted" };

  let auth: VideoAuth | null;
  try {
    auth = await deps.getAuth();
  } catch {
    return { kind: "unreachable" };
  }
  if (!auth) {
    return { kind: "answer", answer: { ok: false, code: "AUTH_REQUIRED", retryable: false } };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? CALL_TIMEOUT_MS);
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    };
    if (auth.anonKey) headers.apikey = auth.anonKey;

    const response = await (deps.fetchImpl ?? fetch)(
      `${auth.url.replace(/\/+$/, "")}${VIDEO_FUNCTION_PATH}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ action, job_id: jobId }),
        signal: controller.signal,
      },
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unreachable" };
    }
    return { kind: "answer", answer: parseJobAnswer(body) };
  } catch {
    if (signal?.aborted && !timedOut) return { kind: "aborted" };
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

export interface VideoApi {
  status(jobId: string, signal?: AbortSignal): Promise<CallOutcome>;
  cancel(jobId: string, signal?: AbortSignal): Promise<CallOutcome>;
}

export function createVideoApi(deps: VideoApiDeps): VideoApi {
  return {
    status: (jobId, signal) => call(deps, "status", jobId, signal),
    cancel: (jobId, signal) => call(deps, "cancel", jobId, signal),
  };
}
