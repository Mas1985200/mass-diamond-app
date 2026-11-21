// supabase/functions/video-engine/worker-queue.ts
// The real queue of Mass Diamond's own video workers: it puts tasks in the table
// video_worker_tasks, reads how they are going, withdraws tasks nobody took, and
// makes short-lived links to the finished files. The database client is only
// used as a type here, so this file runs under plain Node and is tested with a
// small fake client.
//
// The table is written by the engine and by the workers (through the functions
// of the migration 20261119_video_worker_tasks.sql); only the server key can
// touch it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

import type { WorkerQueue, WorkerTaskView } from "./providers/self-worker.ts";

const TABLE = "video_worker_tasks";
const BUCKET = "videos";
const COLUMNS =
  "id, status, progress, attempts, created_at, result_path, result_duration_seconds, error_code, error_message";
const STATUSES = new Set(["queued", "processing", "succeeded", "failed"]);
const ABANDON_CODE = "abandoned";
const ABANDON_MESSAGE = "No worker took the task in time.";

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// One row of the table as the engine needs it, or null when the row is not
// something we wrote (never a guess).
export function parseTaskRow(row: unknown): WorkerTaskView | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;

  const id = textOrNull(r.id);
  const status = typeof r.status === "string" ? r.status : "";
  const createdAtMs = typeof r.created_at === "string" ? Date.parse(r.created_at) : NaN;
  if (!id || !STATUSES.has(status) || !Number.isFinite(createdAtMs)) return null;

  const progress = Number(r.progress);
  const attempts = Number(r.attempts);
  if (!Number.isFinite(progress) || !Number.isInteger(attempts) || attempts < 0) return null;

  const rawDuration = r.result_duration_seconds;
  const duration =
    rawDuration === null || rawDuration === undefined ? null : Number(rawDuration);

  return {
    id,
    status: status as WorkerTaskView["status"],
    progress: Math.min(100, Math.max(0, Math.round(progress))),
    attempts,
    createdAtMs,
    resultPath: textOrNull(r.result_path),
    resultDurationSeconds: duration !== null && Number.isFinite(duration) && duration >= 0 ? duration : null,
    errorCode: textOrNull(r.error_code),
    errorMessage: textOrNull(r.error_message),
  };
}

export function createWorkerQueue(
  client: SupabaseClient,
  now: () => number = Date.now,
): WorkerQueue {
  return {
    async enqueue(request) {
      const { data, error } = await client
        .from(TABLE)
        .insert({ request })
        .select("id")
        .single();
      const id = data && typeof data.id === "string" ? data.id : null;
      if (error || !id) {
        throw new Error(`queue insert failed: ${error?.message ?? "no id"}`);
      }
      return id;
    },

    async get(taskId) {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw new Error(`queue read failed: ${error.message}`);
      if (data === null || data === undefined) return null;
      const task = parseTaskRow(data);
      if (!task) throw new Error("queue read failed: unreadable task row");
      return task;
    },

    async abandon(taskId) {
      // Only a task that is still waiting and was never tried: a worker that
      // took it at this very moment wins.
      const { data, error } = await client
        .from(TABLE)
        .update({
          status: "failed",
          error_code: ABANDON_CODE,
          error_message: ABANDON_MESSAGE,
          completed_at: new Date(now()).toISOString(),
        })
        .eq("id", taskId)
        .eq("status", "queued")
        .eq("attempts", 0)
        .select("id");
      if (error) throw new Error(`queue withdraw failed: ${error.message}`);
      return Array.isArray(data) && data.length === 1;
    },

    async signedUrl(path, ttlSeconds) {
      const { data, error } = await client.storage
        .from(BUCKET)
        .createSignedUrl(path, ttlSeconds);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
  };
}

// end of worker-queue.ts
