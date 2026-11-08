// tests/video/video-rows.test.ts
// The database columns written for a new job and for a change. Pure code.

import test from "node:test";
import assert from "node:assert/strict";

import { inputToRow, patchToRow } from "../../supabase/functions/video-engine/rows.ts";
import { parseVideoRequest } from "../../supabase/functions/video-engine/request.ts";

const USER = "11111111-1111-4111-8111-111111111111";

function input(over: Record<string, unknown> = {}) {
  const result = parseVideoRequest(
    { client_request_id: "22222222-2222-4222-8222-222222222222", prompt: "a fox", ...over },
    USER,
  );
  assert.ok(result.ok);
  return result.value;
}

test("a new job row has every column the table needs and nothing else", () => {
  const row = inputToRow(USER, input({ seed: 9, model: "hf-wan22-space" }), 10);
  assert.deepEqual(Object.keys(row).sort(), [
    "aspect_ratio", "client_request_id", "conversation_id", "credits_charged",
    "duration_seconds", "engine_prompt", "kind", "model", "params", "parent_job_id",
    "quality", "source_image_paths", "status", "style", "user_id", "user_prompt",
  ]);
  assert.equal(row.user_id, USER);
  assert.equal(row.status, "queued");
  assert.equal(row.credits_charged, 10);
  assert.equal(row.model, "hf-wan22-space");
  assert.deepEqual(row.params, { seed: 9 });
});

test("without a seed the params are empty, and the pictures are kept", () => {
  const path = `${USER}/uploads/a.png`;
  const row = inputToRow(USER, input({ image_paths: [path] }), 6);
  assert.deepEqual(row.params, {});
  assert.deepEqual(row.source_image_paths, [path]);
  assert.equal(row.kind, "image_to_video");
});

test("a change writes only the fields given, and null really clears a column", () => {
  assert.deepEqual(patchToRow({}), {});
  assert.deepEqual(patchToRow({ progress: 40 }), { progress: 40 });
  assert.deepEqual(
    patchToRow({ status: "failed", errorCode: "timeout", lockedUntil: null, providerJobId: null, creditsCharged: 0 }),
    { status: "failed", error_code: "timeout", locked_until: null, provider_job_id: null, credits_charged: 0 },
  );
  assert.deepEqual(patchToRow({ progress: undefined, status: "queued" }), { status: "queued" });
});

test("every field of a change has its own column", () => {
  const all = patchToRow({
    status: "succeeded", progress: 100, provider: "p", model: "m", providerJobId: "e", attempts: 1,
    nextAttemptAt: "t", lockedUntil: null, params: {}, resultPath: "r", thumbnailPath: "t",
    resultDurationSeconds: 5, errorCode: null, errorMessage: null, creditsCharged: 0,
    costMicroUsd: 1, startedAt: "s", completedAt: "c",
  });
  assert.equal(Object.keys(all).length, 18);
  assert.equal(new Set(Object.values(all).map(String)).size >= 1, true);
});
