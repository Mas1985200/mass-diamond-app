// supabase/functions/video-engine/jobs.ts
// What a video job is in the code, how a database row becomes one, what the
// app is allowed to see of it, and the small rules about its life (retry
// delay, when the engine is asked, when a job is given up). Pure code (no
// network, no Deno), so it is tested directly.

import type {
  AspectRatio,
  VideoKind,
  VideoQuality,
  VideoStyle,
} from "./providers/types.ts";

export type JobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface Job {
  id: string;
  userId: string;
  conversationId: string | null;
  clientRequestId: string;
  parentJobId: string | null;
  kind: VideoKind;
  status: JobStatus;
  progress: number;
  userPrompt: string;
  enginePrompt: string | null;
  style: VideoStyle;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  quality: VideoQuality;
  params: Record<string, unknown>;
  sourceImagePaths: string[];
  provider: string | null;
  model: string | null;
  providerJobId: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lockedUntil: string | null;
  resultPath: string | null;
  thumbnailPath: string | null;
  resultDurationSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  creditsCharged: number;
  costMicroUsd: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUSES: readonly JobStatus[] = [
  "queued",
  "processing",
  "succeeded",
  "failed",
  "canceled",
];

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  // Postgres "numeric" and "bigint" columns arrive as strings.
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
};

// A database row as a Job, or null when the row is not a valid job. Never a
// half-filled job.
export function rowToJob(row: unknown): Job | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;

  const id = str(r.id);
  const userId = str(r.user_id);
  const clientRequestId = str(r.client_request_id);
  const kind = str(r.kind) as VideoKind | null;
  const status = str(r.status) as JobStatus | null;
  const userPrompt = str(r.user_prompt);
  const createdAt = str(r.created_at);
  const nextAttemptAt = str(r.next_attempt_at);
  const progress = num(r.progress);
  const durationSeconds = num(r.duration_seconds);
  const attempts = num(r.attempts);
  const maxAttempts = num(r.max_attempts);

  if (
    !id || !userId || !clientRequestId || !kind || !status || userPrompt === null ||
    !createdAt || !nextAttemptAt || progress === null || durationSeconds === null ||
    attempts === null || maxAttempts === null || !STATUSES.includes(status)
  ) {
    return null;
  }

  const params =
    typeof r.params === "object" && r.params !== null && !Array.isArray(r.params)
      ? (r.params as Record<string, unknown>)
      : {};
  const sources = Array.isArray(r.source_image_paths)
    ? r.source_image_paths.filter((p): p is string => typeof p === "string")
    : [];

  return {
    id,
    userId,
    conversationId: str(r.conversation_id),
    clientRequestId,
    parentJobId: str(r.parent_job_id),
    kind,
    status,
    progress,
    userPrompt,
    enginePrompt: str(r.engine_prompt),
    style: (str(r.style) ?? "auto") as VideoStyle,
    aspectRatio: (str(r.aspect_ratio) ?? "16:9") as AspectRatio,
    durationSeconds,
    quality: (str(r.quality) ?? "standard") as VideoQuality,
    params,
    sourceImagePaths: sources,
    provider: str(r.provider),
    model: str(r.model),
    providerJobId: str(r.provider_job_id),
    attempts,
    maxAttempts,
    nextAttemptAt,
    lockedUntil: str(r.locked_until),
    resultPath: str(r.result_path),
    thumbnailPath: str(r.thumbnail_path),
    resultDurationSeconds: num(r.result_duration_seconds),
    errorCode: str(r.error_code),
    errorMessage: str(r.error_message),
    creditsCharged: num(r.credits_charged) ?? 0,
    costMicroUsd: num(r.cost_micro_usd) ?? 0,
    createdAt,
    startedAt: str(r.started_at),
    completedAt: str(r.completed_at),
  };
}

// What the app may see. No engine details, no internal ids, no storage paths:
// the video itself is reached through a short-lived signed link added by the
// server when the job is succeeded.
export interface PublicJob {
  id: string;
  status: JobStatus;
  progress: number;
  kind: VideoKind;
  prompt: string;
  style: VideoStyle;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  quality: VideoQuality;
  parentJobId: string | null;
  conversationId: string | null;
  creditsCharged: number;
  // Present only when the job failed: a stable code the app turns into text.
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

export function toPublicJob(
  job: Job,
  links: { videoUrl?: string | null; thumbnailUrl?: string | null } = {},
): PublicJob {
  const done = job.status === "succeeded";
  return {
    id: job.id,
    status: job.status,
    progress: done ? 100 : job.progress,
    kind: job.kind,
    prompt: job.userPrompt,
    style: job.style,
    aspectRatio: job.aspectRatio,
    durationSeconds: job.durationSeconds,
    quality: job.quality,
    parentJobId: job.parentJobId,
    conversationId: job.conversationId,
    creditsCharged: job.creditsCharged,
    errorCode: job.status === "failed" ? job.errorCode : null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    videoUrl: done ? (links.videoUrl ?? null) : null,
    thumbnailUrl: done ? (links.thumbnailUrl ?? null) : null,
  };
}

export const isFinished = (status: JobStatus): boolean =>
  status === "succeeded" || status === "failed" || status === "canceled";

// Waiting time before the next try: 5 s, 15 s, 45 s, ... never over 5 minutes.
export function retryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.min(5_000 * 3 ** (n - 1), 300_000);
}

// A job whose engine has not finished in this time is given up (and its
// credits returned), so nothing stays "processing" forever.
export const JOB_DEADLINE_MS = 15 * 60_000;

export function isOverdue(job: Job, nowMs: number): boolean {
  const started = Date.parse(job.startedAt ?? job.createdAt);
  return Number.isFinite(started) && nowMs - started > JOB_DEADLINE_MS;
}

// Another try is allowed only while tries are left.
export const canRetry = (job: Pick<Job, "attempts" | "maxAttempts">): boolean =>
  job.attempts < job.maxAttempts;
