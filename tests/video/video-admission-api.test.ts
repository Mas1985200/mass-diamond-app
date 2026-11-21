// tests/video/video-admission-api.test.ts
// What the app is told when the doorman says "not now": the stable error codes,
// the status of each, the hint of when to ask again, and that every one of them
// is worth trying again later. Simple stubs, no network.

import test from "node:test";
import assert from "node:assert/strict";

import { handleVideoApi, type ApiDeps } from "../../supabase/functions/video-engine/api.ts";
import type { SubmitOutcome } from "../../supabase/functions/video-engine/engine.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";

function depsFor(outcome: SubmitOutcome): ApiDeps {
  return {
    userId: USER,
    async submit() { return outcome; },
    async advance() { return null; },
    async cancel() { return null; },
    async list() { return []; },
    async present() { throw new Error("not used"); },
    models: () => [],
    async credits() { return null; },
  };
}

const body = { action: "submit", client_request_id: REQ, prompt: "a fox" };

type Error = { code: string; retryable: boolean; retryAfterSeconds?: number; limit?: number };
const errorOf = (r: { body: unknown }) => (r.body as { ok: boolean; error: Error }).error;

test("too many videos of one person: 429 with the wait and the limit", async () => {
  const r = await handleVideoApi(
    depsFor({ ok: false, code: "too_many_active", retryAfterSeconds: 30, limit: 2 }),
    body,
  );
  assert.equal(r.status, 429);
  assert.deepEqual(
    { ...errorOf(r), message: undefined },
    { code: "VIDEO_TOO_MANY_ACTIVE", message: undefined, retryable: true, retryAfterSeconds: 30, limit: 2 },
  );
});

test("a full queue: 503 with the wait and the limit", async () => {
  const r = await handleVideoApi(
    depsFor({ ok: false, code: "queue_full", retryAfterSeconds: 120, limit: 100 }),
    body,
  );
  assert.equal(r.status, 503);
  const error = errorOf(r);
  assert.equal(error.code, "VIDEO_QUEUE_FULL");
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterSeconds, 120);
  assert.equal(error.limit, 100);
});

test("a queue that cannot be counted: 503, try again", async () => {
  const r = await handleVideoApi(depsFor({ ok: false, code: "queue_unavailable" }), body);
  assert.equal(r.status, 503);
  const error = errorOf(r);
  assert.equal(error.code, "VIDEO_QUEUE_UNAVAILABLE");
  assert.equal(error.retryable, true);
  assert.equal("retryAfterSeconds" in error, false);
});
