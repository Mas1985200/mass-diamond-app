// supabase/functions/video-engine/rows.ts
// Turns the engine's own shapes into database columns: the row of a new job
// and the columns a change touches. Pure code (no network, no Deno), so it is
// tested directly. Only fields that are really given are written, so a change
// can never wipe a column by accident.

import type { VideoJobInput } from "./request.ts";
import type { JobPatch } from "./store.ts";

// The row of a new job. The credits are what was taken for it; the model is
// what the person asked for ("auto" or one engine), not the engine that ends
// up making it.
export function inputToRow(
  userId: string,
  input: VideoJobInput,
  creditsCharged: number,
): Record<string, unknown> {
  return {
    user_id: userId,
    conversation_id: input.conversationId,
    client_request_id: input.clientRequestId,
    parent_job_id: input.parentJobId,
    kind: input.kind,
    status: "queued",
    user_prompt: input.userPrompt,
    engine_prompt: input.enginePrompt,
    style: input.style,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds,
    quality: input.quality,
    model: input.model,
    params: input.seed === null ? {} : { seed: input.seed },
    source_image_paths: input.imagePaths,
    credits_charged: creditsCharged,
  };
}

const COLUMNS: Readonly<Record<keyof JobPatch, string>> = {
  status: "status",
  progress: "progress",
  provider: "provider",
  model: "model",
  providerJobId: "provider_job_id",
  attempts: "attempts",
  nextAttemptAt: "next_attempt_at",
  lockedUntil: "locked_until",
  params: "params",
  resultPath: "result_path",
  thumbnailPath: "thumbnail_path",
  resultDurationSeconds: "result_duration_seconds",
  errorCode: "error_code",
  errorMessage: "error_message",
  creditsCharged: "credits_charged",
  costMicroUsd: "cost_micro_usd",
  startedAt: "started_at",
  completedAt: "completed_at",
};

// The columns to change. A field that is absent is left alone; a field that is
// null really sets the column to null.
export function patchToRow(patch: JobPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(COLUMNS) as Array<keyof JobPatch>) {
    const value = patch[key];
    if (value !== undefined) row[COLUMNS[key]] = value;
  }
  return row;
}
