// supabase/functions/video-engine/providers/self-worker.ts
// Mass Diamond's own video engine. It makes no video itself: it puts a task in
// our own queue (table video_worker_tasks) where any number of workers, each on
// its own GPU, take tasks one by one, make the video and put it in the storage.
// This file only follows the task and tells the engine how it is going.
//
// The queue is given in (see worker-queue.ts), so every rule here is tested
// without a network. It is switched on with the secret VIDEO_SELF_WORKER=on, so
// it is never offered while no worker is running.
//
// If no worker takes a task within VIDEO_WORKER_PICKUP_SECONDS (default 120),
// the task is withdrawn and the engine moves on to the next engine, so a person
// never waits for a worker that does not exist.

import {
  ProviderError,
  type PollResult,
  type ProviderCapabilities,
  type SubmitResult,
  type VideoProvider,
  type VideoRequest,
} from "./types.ts";

export const SELF_WORKER_PROVIDER_ID = "mass-worker";
export const DEFAULT_PICKUP_SECONDS = 120;
const MIN_PICKUP_SECONDS = 10;
const MAX_PICKUP_SECONDS = 3600;
const MAX_PROMPT_CHARS = 2000;
// The finished video is fetched by the engine soon after; ten minutes is plenty.
export const RESULT_LINK_SECONDS = 600;

// Until the job table accepts longer videos, the engine promises what it can
// keep. The worker itself makes up to 600 seconds.
export const SELF_WORKER_MAX_SECONDS = 60;

export const SELF_WORKER_CAPABILITIES: ProviderCapabilities = {
  id: SELF_WORKER_PROVIDER_ID,
  label: "Mass Diamond Engine",
  kinds: ["text_to_video", "image_to_video", "multi_image_to_video"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  maxDurationSeconds: SELF_WORKER_MAX_SECONDS,
  free: true,
  costMicroUsdPerSecond: 0,
};

type Env = Readonly<Record<string, string | undefined>>;

// What the engine needs to know about one task of the queue.
export interface WorkerTaskView {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  progress: number;
  attempts: number;
  // Milliseconds since 1970 (when the task was put in the queue).
  createdAtMs: number;
  resultPath: string | null;
  resultDurationSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WorkerQueue {
  // Puts a task in the queue and returns its id.
  enqueue(request: Record<string, unknown>): Promise<string>;
  // The task, or null when it does not exist. Throws when the database cannot
  // be read (the engine then simply asks again later).
  get(taskId: string): Promise<WorkerTaskView | null>;
  // Withdraws a task nobody has taken. False when a worker took it meanwhile.
  abandon(taskId: string): Promise<boolean>;
  // A short-lived link to a file of the storage, or null.
  signedUrl(path: string, ttlSeconds: number): Promise<string | null>;
}

const ON_VALUES = new Set(["1", "true", "on", "yes"]);

export function selfWorkerEnabled(env: Env): boolean {
  return ON_VALUES.has(env.VIDEO_SELF_WORKER?.trim().toLowerCase() ?? "");
}

export function readPickupSeconds(env: Env): number {
  const text = env.VIDEO_WORKER_PICKUP_SECONDS?.trim();
  if (!text || !/^\d+$/.test(text)) return DEFAULT_PICKUP_SECONDS;
  const value = Number(text);
  return value >= MIN_PICKUP_SECONDS && value <= MAX_PICKUP_SECONDS
    ? value
    : DEFAULT_PICKUP_SECONDS;
}

// The task the worker reads (the contract is written in worker/pipeline/plan.py).
export function buildWorkerRequest(request: VideoRequest): Record<string, unknown> {
  const seconds = Number.isFinite(request.durationSeconds)
    ? Math.min(SELF_WORKER_MAX_SECONDS, Math.max(1, Math.round(request.durationSeconds)))
    : SELF_WORKER_MAX_SECONDS;
  const seed =
    request.seed !== undefined && Number.isFinite(request.seed)
      ? Math.abs(Math.floor(request.seed)) % 2_147_483_647
      : undefined;
  return {
    kind: request.kind,
    prompt: request.prompt.trim().slice(0, MAX_PROMPT_CHARS),
    style: request.style,
    aspect_ratio: request.aspectRatio,
    quality: request.quality,
    duration_seconds: seconds,
    image_urls: request.kind === "text_to_video" ? [] : request.imageUrls,
    ...(seed !== undefined ? { seed } : {}),
  };
}

export function createSelfWorkerProvider(
  queue: WorkerQueue,
  options: { pickupSeconds?: number; now?: () => number } = {},
): VideoProvider {
  const now = options.now ?? Date.now;
  const pickupMs = (options.pickupSeconds ?? DEFAULT_PICKUP_SECONDS) * 1000;

  return {
    capabilities: SELF_WORKER_CAPABILITIES,

    isConfigured(env) {
      return selfWorkerEnabled(env);
    },

    async submit(request): Promise<SubmitResult> {
      try {
        const taskId = await queue.enqueue(buildWorkerRequest(request));
        return { providerJobId: taskId };
      } catch {
        throw new ProviderError("engine_error", "The video queue could not take the task.", true);
      }
    },

    async poll(providerJobId): Promise<PollResult> {
      const task = await queue.get(providerJobId);
      if (!task) {
        return {
          state: "failed",
          code: "engine_error",
          message: "The task disappeared from the queue.",
          retryable: true,
        };
      }

      if (task.status === "queued") {
        const waited = now() - task.createdAtMs;
        if (task.attempts === 0 && waited > pickupMs) {
          if (await queue.abandon(task.id)) {
            return {
              state: "failed",
              code: "engine_busy",
              message: "No worker took the task in time.",
              retryable: true,
            };
          }
        }
        return { state: "running", progress: Math.max(2, task.progress) };
      }

      if (task.status === "processing") {
        return { state: "running", progress: Math.max(2, task.progress) };
      }

      if (task.status === "succeeded") {
        const link = task.resultPath
          ? await queue.signedUrl(task.resultPath, RESULT_LINK_SECONDS)
          : null;
        if (!link) {
          return {
            state: "failed",
            code: "bad_response",
            message: "The finished video could not be found.",
            retryable: true,
          };
        }
        return {
          state: "succeeded",
          videoUrl: link,
          ...(task.resultDurationSeconds !== null
            ? { durationSeconds: task.resultDurationSeconds }
            : {}),
        };
      }

      // The worker gave up. A request that can never be made is final; any other
      // failure may work on another engine.
      const message = (task.errorMessage ?? "The worker could not make the video.").slice(0, 200);
      if (task.errorCode === "invalid_request") {
        return { state: "failed", code: "unsupported_request", message, retryable: false };
      }
      return { state: "failed", code: "engine_error", message, retryable: true };
    },
  };
}

// end of self-worker.ts
