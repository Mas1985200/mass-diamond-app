// supabase/functions/video-engine/engine.ts
// The life of a video job: ask for a video, move it forward, finish it, retry
// it, give it up, cancel it. It only talks to the outside world through the
// doors in store.ts and the engines in providers/, so every rule here is
// tested with small fakes.
//
// How a job moves (no background process is needed): asking for a video
// charges the credits, saves the job and starts it at an engine right away.
// After that, every status request from the app calls advanceVideo, which asks
// the engine how it is going, and finishes, retries or gives up the job. A job
// is held by one request at a time (a short "lease"), so two phones or two
// quick polls never work on the same job twice.
//
// Honest rules:
//  - Credits are taken before the work and given back (once) when no video
//    can be made. A cancelled job is paid back only while it never started.
//  - A repeated request (same request id) never starts or charges twice.
//  - A job that does not finish in JOB_DEADLINE_MS is given up.
//  - A failed engine is retried with growing waits; the next try prefers an
//    engine that has not failed yet (fallback). A model the person picked is
//    never replaced by another one.

import { creditsFor } from "./credits.ts";
import {
  JOB_DEADLINE_MS,
  canRetry,
  isFinished,
  isOverdue,
  retryDelayMs,
  toPublicJob,
  type Job,
  type PublicJob,
} from "./jobs.ts";
import { selectProviders } from "./providers/registry.ts";
import {
  ProviderError,
  type VideoProvider,
  type VideoRequest,
} from "./providers/types.ts";
import type { VideoJobInput } from "./request.ts";
import type { DownloadVideo, JobStore, VideoFiles } from "./store.ts";

export const LEASE_MS = 60_000;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const LINK_TTL_SECONDS = 3_600;
// How long an engine usually needs; only used to show a believable progress.
const EXPECTED_MS = 150_000;

export interface EngineDeps {
  store: JobStore;
  files: VideoFiles;
  download: DownloadVideo;
  providers: readonly VideoProvider[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => number;
}

export type SubmitFailure =
  | "no_engine"
  | "unknown_model"
  | "unsupported_request"
  | "storage_unavailable"
  | "credits_unavailable"
  | "quota_exceeded";

export type SubmitOutcome =
  | { ok: true; job: Job; existing: boolean }
  | {
      ok: false;
      code: SubmitFailure;
      quota?: { used: number; quota: number; plan: "free" | "pro" };
    };

const iso = (ms: number): string => new Date(ms).toISOString();

function triedOf(job: Job): string[] {
  const tried = job.params.tried;
  return Array.isArray(tried)
    ? tried.filter((t): t is string => typeof t === "string")
    : [];
}

// A believable progress from the time spent; never goes back, never claims 100.
export function estimateProgress(
  startedAtMs: number,
  nowMs: number,
  current: number,
): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const guess = Math.round((elapsed / EXPECTED_MS) * 90);
  return Math.min(90, Math.max(current, 5, guess));
}

// The request an engine gets, rebuilt from the saved job (so a retry after a
// failure uses fresh picture links).
async function buildRequest(
  deps: EngineDeps,
  job: Job,
): Promise<VideoRequest | null> {
  const imageUrls: string[] = [];
  for (const path of job.sourceImagePaths) {
    const url = await deps.files.signedUrl(path, LINK_TTL_SECONDS);
    if (!url) return null;
    imageUrls.push(url);
  }
  const seed = job.params.seed;
  return {
    kind: job.kind,
    prompt: job.enginePrompt ?? job.userPrompt,
    style: job.style,
    aspectRatio: job.aspectRatio,
    durationSeconds: job.durationSeconds,
    quality: job.quality,
    seed: typeof seed === "number" ? seed : undefined,
    imageUrls,
  };
}

// Ends a job as failed and gives the credits back, once.
async function failJob(
  deps: EngineDeps,
  job: Job,
  code: string,
  message: string,
): Promise<Job> {
  const refund = job.creditsCharged;
  const updated = await deps.store.update(job.id, {
    status: "failed",
    errorCode: code,
    errorMessage: message.slice(0, 500),
    completedAt: iso(deps.now()),
    lockedUntil: null,
    providerJobId: null,
    creditsCharged: 0,
  });
  if (refund > 0) {
    await deps.store.refundCredits(job.userId, refund, job.createdAt);
  }
  return updated ?? job;
}

// A failure of the engine: try again later when that makes sense, otherwise
// end the job.
async function handleFailure(
  deps: EngineDeps,
  job: Job,
  code: string,
  message: string,
  retryable: boolean,
): Promise<Job> {
  if (retryable && canRetry(job)) {
    const tried = job.provider ? [...triedOf(job), job.provider] : triedOf(job);
    const updated = await deps.store.update(job.id, {
      status: "queued",
      progress: 0,
      providerJobId: null,
      lockedUntil: null,
      nextAttemptAt: iso(deps.now() + retryDelayMs(job.attempts)),
      params: { ...job.params, tried },
    });
    return updated ?? job;
  }
  return failJob(deps, job, code, message);
}

// One try at an engine: the best engine that has not failed yet comes first.
async function startAttempt(deps: EngineDeps, job: Job): Promise<Job> {
  const request = await buildRequest(deps, job);
  if (!request) {
    return failJob(deps, job, "storage_unavailable", "The pictures could not be read.");
  }
  const selection = selectProviders(deps.providers, request, deps.env, job.model);
  if (!selection.ok) {
    return failJob(deps, job, "no_engine", "No video engine can make this video now.");
  }

  const tried = triedOf(job);
  const fresh = selection.providers.filter((p) => !tried.includes(p.capabilities.id));
  const ordered = fresh.length > 0 ? fresh : selection.providers;
  const attempts = job.attempts + 1;
  const nowMs = deps.now();

  let last: ProviderError | null = null;
  const failedHere: string[] = [];
  for (const provider of ordered) {
    try {
      const { providerJobId } = await provider.submit(request);
      const updated = await deps.store.update(job.id, {
        status: "processing",
        progress: 5,
        provider: provider.capabilities.id,
        providerJobId,
        attempts,
        startedAt: job.startedAt ?? iso(nowMs),
        lockedUntil: null,
        errorCode: null,
        errorMessage: null,
        params: { ...job.params, tried: [...tried, ...failedHere] },
      });
      return updated ?? job;
    } catch (error) {
      last =
        error instanceof ProviderError
          ? error
          : new ProviderError("engine_error", "The engine failed to start.", true);
      failedHere.push(provider.capabilities.id);
    }
  }

  const failedJob: Job = { ...job, attempts, provider: null, params: { ...job.params, tried: [...tried, ...failedHere] } };
  await deps.store.update(job.id, { attempts, params: failedJob.params });
  return handleFailure(
    deps,
    failedJob,
    last?.code ?? "engine_error",
    last?.message ?? "The engine failed to start.",
    last?.retryable ?? true,
  );
}

// Asks for a video. Checks, charges, saves and starts it.
export async function submitVideo(
  deps: EngineDeps,
  userId: string,
  input: VideoJobInput,
): Promise<SubmitOutcome> {
  const existing = await deps.store.findByRequest(userId, input.clientRequestId);
  if (existing) return { ok: true, job: existing, existing: true };

  // Check an engine can make it before taking any credits.
  const imageUrls: string[] = [];
  for (const path of input.imagePaths) {
    const url = await deps.files.signedUrl(path, LINK_TTL_SECONDS);
    if (!url) return { ok: false, code: "storage_unavailable" };
    imageUrls.push(url);
  }
  const probe: VideoRequest = {
    kind: input.kind,
    prompt: input.enginePrompt ?? input.userPrompt,
    style: input.style,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    quality: input.quality,
    imageUrls,
  };
  const selection = selectProviders(deps.providers, probe, deps.env, input.model);
  if (!selection.ok) {
    return {
      ok: false,
      code: selection.reason === "not_available" ? "no_engine" : selection.reason,
    };
  }

  const cost = creditsFor(input.durationSeconds, input.quality);
  const decision = await deps.store.consumeCredits(userId, cost);
  if (!decision) return { ok: false, code: "credits_unavailable" };
  if (!decision.allowed) {
    return {
      ok: false,
      code: "quota_exceeded",
      quota: { used: decision.used, quota: decision.quota, plan: decision.plan },
    };
  }

  let inserted;
  try {
    inserted = await deps.store.insert(userId, input, cost);
  } catch (error) {
    await deps.store.refundCredits(userId, cost, iso(deps.now()));
    throw error;
  }
  if (!inserted.created) {
    // Two identical requests raced: the other one is the real job.
    await deps.store.refundCredits(userId, cost, iso(deps.now()));
    return { ok: true, job: inserted.job, existing: true };
  }

  const started = await startAttempt(deps, inserted.job);
  return { ok: true, job: started, existing: false };
}

// The video is ready at the engine: bring it home and finish the job.
async function finishJob(
  deps: EngineDeps,
  job: Job,
  videoUrl: string,
  reportedSeconds: number | undefined,
  provider: VideoProvider,
): Promise<Job> {
  let video;
  try {
    video = await deps.download(videoUrl);
  } catch {
    return handleFailure(deps, job, "bad_response", "The finished video could not be downloaded.", true);
  }
  if (video.bytes.length === 0) {
    return handleFailure(deps, job, "bad_response", "The finished video was empty.", true);
  }
  if (video.bytes.length > MAX_VIDEO_BYTES) {
    return failJob(deps, job, "result_too_large", "The finished video is too large to keep.");
  }

  const webm = video.contentType.toLowerCase().startsWith("video/webm");
  const path = `${job.userId}/${job.id}/video.${webm ? "webm" : "mp4"}`;
  try {
    await deps.files.upload(path, video.bytes, webm ? "video/webm" : "video/mp4");
  } catch {
    return failJob(deps, job, "storage_failed", "The video could not be saved.");
  }

  const seconds = reportedSeconds ?? job.durationSeconds;
  const updated = await deps.store.update(job.id, {
    status: "succeeded",
    progress: 100,
    resultPath: path,
    resultDurationSeconds: seconds,
    costMicroUsd: Math.round(provider.capabilities.costMicroUsdPerSecond * seconds),
    completedAt: iso(deps.now()),
    lockedUntil: null,
    errorCode: null,
    errorMessage: null,
  });
  return updated ?? job;
}

async function pollJob(deps: EngineDeps, job: Job): Promise<Job> {
  const provider = deps.providers.find((p) => p.capabilities.id === job.provider);
  if (!provider || !job.providerJobId) {
    return handleFailure(deps, job, "engine_error", "The engine lost track of this video.", true);
  }

  let result;
  try {
    result = await provider.poll(job.providerJobId);
  } catch (error) {
    if (error instanceof ProviderError) {
      return handleFailure(deps, job, error.code, error.message, error.retryable);
    }
    // Not the engine's answer (our own stop): ask again on the next request.
    const released = await deps.store.update(job.id, { lockedUntil: null });
    return released ?? job;
  }

  if (result.state === "running") {
    const started = Date.parse(job.startedAt ?? job.createdAt);
    const progress = estimateProgress(
      Number.isFinite(started) ? started : deps.now(),
      deps.now(),
      result.progress ?? job.progress,
    );
    const updated = await deps.store.update(job.id, { progress, lockedUntil: null });
    return updated ?? job;
  }
  if (result.state === "failed") {
    return handleFailure(deps, job, result.code, result.message, result.retryable);
  }
  return finishJob(deps, job, result.videoUrl, result.durationSeconds, provider);
}

// Moves a job one step forward. Safe to call as often as the app likes.
export async function advanceVideo(
  deps: EngineDeps,
  userId: string,
  jobId: string,
): Promise<Job | null> {
  const job = await deps.store.get(userId, jobId);
  if (!job || isFinished(job.status)) return job;

  const claimed = await deps.store.claim(job.id, LEASE_MS);
  // Someone else is moving it right now: show the state as it is.
  if (!claimed) return job;

  if (isOverdue(claimed, deps.now())) {
    return failJob(
      deps,
      claimed,
      "timeout",
      `The video did not finish in ${Math.round(JOB_DEADLINE_MS / 60_000)} minutes.`,
    );
  }

  if (claimed.status === "queued") {
    if (Date.parse(claimed.nextAttemptAt) > deps.now()) {
      const released = await deps.store.update(claimed.id, { lockedUntil: null });
      return released ?? claimed;
    }
    if (!canRetry(claimed)) {
      return failJob(deps, claimed, "engine_error", "No tries are left for this video.");
    }
    return startAttempt(deps, claimed);
  }

  return pollJob(deps, claimed);
}

// Stops a job. Credits come back only if it never reached an engine.
export async function cancelVideo(
  deps: EngineDeps,
  userId: string,
  jobId: string,
): Promise<Job | null> {
  const job = await deps.store.get(userId, jobId);
  if (!job || isFinished(job.status)) return job;

  const refund = job.status === "queued" ? job.creditsCharged : 0;
  const updated = await deps.store.update(job.id, {
    status: "canceled",
    completedAt: iso(deps.now()),
    lockedUntil: null,
    providerJobId: null,
    ...(refund > 0 ? { creditsCharged: 0 } : {}),
  });
  if (refund > 0) {
    await deps.store.refundCredits(userId, refund, job.createdAt);
  }
  return updated ?? job;
}

// A job as the app sees it, with short-lived links when the video is ready.
export async function presentJob(
  deps: EngineDeps,
  job: Job,
): Promise<PublicJob> {
  if (job.status !== "succeeded") return toPublicJob(job);
  const videoUrl = job.resultPath
    ? await deps.files.signedUrl(job.resultPath, LINK_TTL_SECONDS)
    : null;
  const thumbnailUrl = job.thumbnailPath
    ? await deps.files.signedUrl(job.thumbnailPath, LINK_TTL_SECONDS)
    : null;
  return toPublicJob(job, { videoUrl, thumbnailUrl });
}
