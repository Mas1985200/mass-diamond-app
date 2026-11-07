// tests/video/video-jobs.test.ts
// Reading a job from a database row, what the app may see of it, and the
// small rules of its life. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  JOB_DEADLINE_MS,
  canRetry,
  isFinished,
  isOverdue,
  retryDelayMs,
  rowToJob,
  toPublicJob,
} from "../../supabase/functions/video-engine/jobs.ts";

const row = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  user_id: "u1",
  conversation_id: null,
  client_request_id: "r1",
  parent_job_id: null,
  kind: "text_to_video",
  status: "queued",
  progress: 0,
  user_prompt: "a fox",
  engine_prompt: null,
  style: "auto",
  aspect_ratio: "16:9",
  duration_seconds: 5,
  quality: "standard",
  params: {},
  source_image_paths: [],
  provider: null,
  model: null,
  provider_job_id: null,
  attempts: 0,
  max_attempts: 3,
  next_attempt_at: "2026-11-07T10:00:00Z",
  locked_until: null,
  result_path: null,
  thumbnail_path: null,
  result_duration_seconds: null,
  error_code: null,
  error_message: null,
  credits_charged: 10,
  cost_micro_usd: "0",
  created_at: "2026-11-07T10:00:00Z",
  started_at: null,
  completed_at: null,
  ...over,
});

test("a good row becomes a job; numbers sent as text are read as numbers", () => {
  const job = rowToJob(row({ cost_micro_usd: "250000", result_duration_seconds: "5.04" }));
  assert.ok(job);
  assert.equal(job.id, "j1");
  assert.equal(job.userId, "u1");
  assert.equal(job.costMicroUsd, 250000);
  assert.equal(job.resultDurationSeconds, 5.04);
  assert.equal(job.creditsCharged, 10);
  assert.deepEqual(job.sourceImagePaths, []);
});

test("a row that is not a valid job is never half-read", () => {
  assert.equal(rowToJob(null), null);
  assert.equal(rowToJob("x"), null);
  assert.equal(rowToJob(row({ id: undefined })), null);
  assert.equal(rowToJob(row({ status: "weird" })), null);
  assert.equal(rowToJob(row({ progress: "abc" })), null);
  assert.equal(rowToJob(row({ user_prompt: 5 })), null);
});

test("the app sees no engine details and no storage paths", () => {
  const job = rowToJob(row({
    status: "succeeded",
    progress: 80,
    provider: "hf-wan22-space",
    model: "wan",
    provider_job_id: "evt",
    result_path: "u1/j1/video.mp4",
    thumbnail_path: "u1/j1/thumb.jpg",
  }))!;
  const shown = toPublicJob(job, { videoUrl: "https://s/v", thumbnailUrl: "https://s/t" });
  assert.equal(shown.progress, 100);
  assert.equal(shown.videoUrl, "https://s/v");
  assert.equal(shown.thumbnailUrl, "https://s/t");
  const text = JSON.stringify(shown);
  for (const secret of ["hf-wan22-space", "evt", "u1/j1", "wan", "user_id", "u1\""]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("links and error codes only appear when they belong to the state", () => {
  const running = toPublicJob(rowToJob(row({ status: "processing", progress: 40 }))!, { videoUrl: "https://s/v" });
  assert.equal(running.videoUrl, null);
  assert.equal(running.progress, 40);
  assert.equal(running.errorCode, null);
  const failed = toPublicJob(rowToJob(row({ status: "failed", error_code: "engine_error", error_message: "internal detail" }))!);
  assert.equal(failed.errorCode, "engine_error");
  assert.equal(JSON.stringify(failed).includes("internal detail"), false);
});

test("retry waits grow and stop at five minutes", () => {
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(2), 15_000);
  assert.equal(retryDelayMs(3), 45_000);
  assert.equal(retryDelayMs(10), 300_000);
  assert.equal(retryDelayMs(0), 5_000);
  assert.equal(retryDelayMs(Number.NaN) >= 5_000, true);
});

test("a job is overdue after the deadline, counted from its start", () => {
  const job = rowToJob(row({ started_at: "2026-11-07T10:00:00Z" }))!;
  const start = Date.parse("2026-11-07T10:00:00Z");
  assert.equal(isOverdue(job, start + JOB_DEADLINE_MS), false);
  assert.equal(isOverdue(job, start + JOB_DEADLINE_MS + 1), true);
  const notStarted = rowToJob(row())!;
  assert.equal(isOverdue(notStarted, start + JOB_DEADLINE_MS + 1), true);
});

test("tries and finished states", () => {
  assert.equal(canRetry({ attempts: 2, maxAttempts: 3 }), true);
  assert.equal(canRetry({ attempts: 3, maxAttempts: 3 }), false);
  assert.deepEqual(
    (["queued", "processing", "succeeded", "failed", "canceled"] as const).map(isFinished),
    [false, false, true, true, true],
  );
});
