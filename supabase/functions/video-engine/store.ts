// supabase/functions/video-engine/store.ts
// The doors between the video engine's logic and the outside world: the job
// database, the credit meter, the file storage and the download of a finished
// video. The logic (engine.ts) only knows these shapes, so it is tested with
// small fakes and the real database/storage code lives in one separate file.
// Types only: nothing runs here.

import type { CreditDecision } from "./credits.ts";
import type { Job, JobStatus } from "./jobs.ts";
import type { VideoJobInput } from "./request.ts";

// The fields of a job the engine may change. Everything else is fixed when
// the job is created.
export interface JobPatch {
  status?: JobStatus;
  progress?: number;
  provider?: string | null;
  model?: string | null;
  providerJobId?: string | null;
  attempts?: number;
  nextAttemptAt?: string;
  lockedUntil?: string | null;
  params?: Record<string, unknown>;
  resultPath?: string | null;
  thumbnailPath?: string | null;
  resultDurationSeconds?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  costMicroUsd?: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface InsertResult {
  job: Job;
  // False when a job with the same request id already existed (a repeated
  // request after weak internet): the existing job is returned, nothing new.
  created: boolean;
}

export interface JobStore {
  findByRequest(userId: string, clientRequestId: string): Promise<Job | null>;
  get(userId: string, jobId: string): Promise<Job | null>;
  insert(
    userId: string,
    input: VideoJobInput,
    creditsCharged: number,
  ): Promise<InsertResult>;
  // Changes the fields; null when the job does not exist.
  update(jobId: string, patch: JobPatch): Promise<Job | null>;
  // Takes the job for the next leaseMs so two requests never work on the same
  // job at once. null when someone else holds it or it is finished.
  claim(jobId: string, leaseMs: number): Promise<Job | null>;
  list(userId: string, limit: number, beforeCreatedAt?: string): Promise<Job[]>;
  // The credit meter. null means "unknown" (the database did not answer
  // properly): the caller treats it as a refusal, never as free credits.
  consumeCredits(userId: string, cost: number): Promise<CreditDecision | null>;
  refundCredits(userId: string, cost: number, chargedAt: string): Promise<void>;
}

export interface VideoFiles {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  // A short-lived link to a private file; null when it cannot be made.
  signedUrl(path: string, ttlSeconds: number): Promise<string | null>;
}

export interface DownloadedVideo {
  bytes: Uint8Array;
  contentType: string;
}

// Fetches the finished video from the engine's link. Throws when it cannot.
export type DownloadVideo = (url: string) => Promise<DownloadedVideo>;
