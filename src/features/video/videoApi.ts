// src/features/video/videoApi.ts
// Asks the video function (video-engine) about a video, cancels it, or asks
// which video models exist (for the model chooser). The network and the
// sign-in are given in (see videoClient.ts), so every case is tested without
// a network.
//
// The function answers {"ok":true,"job":{...}} or {"ok":false,"error":{...}}.
// This file only turns "something went wrong on the way" into three clear
// outcomes; reading the answer itself is parseJobAnswer's (jobs) and
// parseModelsAnswer's (models) job.

import { parseJobAnswer, type JobAnswer } from "./videoCard.ts";
import { parseModelsAnswer, type ModelsAnswer } from "./videoModels.ts";

export type Outcome<T> =
  // The function answered (even with an error it explains).
  | { readonly kind: "answer"; readonly answer: T }
  // No answer could be read: no internet, a timeout, or a broken reply.
  | { readonly kind: "unreachable" }
  // The caller stopped the call (the card went away).
  | { readonly kind: "aborted" };

export type CallOutcome = Outcome<JobAnswer>;
export type ModelsOutcome = Outcome<ModelsAnswer>;

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

// One call to the video function: the sign-in, the time limit, the stop
// signal and the three outcomes are the same for every kind of call; only the
// request body and the way the answer is read differ.
async function send<T>(
  deps: VideoApiDeps,
  payload: Record<string, unknown>,
  parse: (body: unknown) => T,
  signedOut: T,
  signal?: AbortSignal,
): Promise<Outcome<T>> {
  if (signal?.aborted) return { kind: "aborted" };

  let auth: VideoAuth | null;
  try {
    auth = await deps.getAuth();
  } catch {
    return { kind: "unreachable" };
  }
  if (!auth) return { kind: "answer", answer: signedOut };

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
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unreachable" };
    }
    return { kind: "answer", answer: parse(body) };
  } catch {
    if (signal?.aborted && !timedOut) return { kind: "aborted" };
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

const SIGNED_OUT_JOB: JobAnswer = { ok: false, code: "AUTH_REQUIRED", retryable: false };
const SIGNED_OUT_MODELS: ModelsAnswer = { ok: false };

export interface VideoApi {
  status(jobId: string, signal?: AbortSignal): Promise<CallOutcome>;
  cancel(jobId: string, signal?: AbortSignal): Promise<CallOutcome>;
}

export function createVideoApi(deps: VideoApiDeps): VideoApi {
  return {
    status: (jobId, signal) =>
      send(deps, { action: "status", job_id: jobId }, parseJobAnswer, SIGNED_OUT_JOB, signal),
    cancel: (jobId, signal) =>
      send(deps, { action: "cancel", job_id: jobId }, parseJobAnswer, SIGNED_OUT_JOB, signal),
  };
}

// The list of video models for the model chooser.
export interface VideoModelsApi {
  models(signal?: AbortSignal): Promise<ModelsOutcome>;
}

export function createVideoModelsApi(deps: VideoApiDeps): VideoModelsApi {
  return {
    models: (signal) =>
      send(deps, { action: "models" }, parseModelsAnswer, SIGNED_OUT_MODELS, signal),
  };
}

// end of videoApi.ts
