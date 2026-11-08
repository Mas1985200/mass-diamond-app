// tests/video/video-api.test.ts
// The answers of the video function: each action, the stable error codes and
// their statuses, and what is never sent to the app. Simple stubs, no network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LIST,
  MAX_LIST,
  handleVideoApi,
  type ApiDeps,
} from "../../supabase/functions/video-engine/api.ts";
import { rowToJob, toPublicJob, type Job } from "../../supabase/functions/video-engine/jobs.ts";
import type { SubmitOutcome } from "../../supabase/functions/video-engine/engine.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";

const job = (): Job =>
  rowToJob({
    id: JOB, user_id: USER, client_request_id: REQ, kind: "text_to_video", status: "processing",
    progress: 30, user_prompt: "a fox", duration_seconds: 5, attempts: 1, max_attempts: 3,
    next_attempt_at: "2026-11-08T10:00:00Z", created_at: "2026-11-08T10:00:00Z",
    provider: "secret-engine", provider_job_id: "secret-event",
  })!;

function deps(over: Partial<ApiDeps> = {}) {
  const calls: Record<string, unknown[]> = { submit: [], advance: [], cancel: [], list: [] };
  const base: ApiDeps = {
    userId: USER,
    async submit(input) { calls.submit.push(input); return { ok: true, job: job(), existing: false }; },
    async advance(id) { calls.advance.push(id); return job(); },
    async cancel(id) { calls.cancel.push(id); return job(); },
    async list(limit, before) { calls.list.push([limit, before]); return [job()]; },
    async present(j) { return toPublicJob(j); },
    models: () => [
      { id: "m1", label: "M1", kinds: ["text_to_video"], aspectRatios: ["16:9"], maxDurationSeconds: 5, free: true, costMicroUsdPerSecond: 777, available: true },
    ],
  };
  return { deps: { ...base, ...over }, calls };
}

const submitBody = (over: Record<string, unknown> = {}) => ({ action: "submit", client_request_id: REQ, prompt: "a fox", ...over });
const code = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;

test("submit starts a video and answers with the app's view of the job", async () => {
  const { deps: d, calls } = deps();
  const r = await handleVideoApi(d, submitBody());
  assert.equal(r.status, 200);
  const body = r.body as { ok: boolean; existing: boolean; job: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.existing, false);
  assert.equal(body.job.id, JOB);
  assert.equal((calls.submit[0] as { userPrompt: string }).userPrompt, "a fox");
});

test("the app never sees engine names, engine ids or the owner's id", async () => {
  const { deps: d } = deps();
  const text = JSON.stringify((await handleVideoApi(d, submitBody())).body);
  for (const secret of ["secret-engine", "secret-event", USER, "777", "costMicro"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  const models = JSON.stringify((await handleVideoApi(d, { action: "models" })).body);
  assert.equal(models.includes("777"), false);
  assert.equal(models.includes("costMicro"), false);
});

test("a bad request is refused with the field, and nothing is started", async () => {
  const { deps: d, calls } = deps();
  for (const [body, field] of [
    [submitBody({ prompt: "" }), "prompt"],
    [submitBody({ aspect_ratio: "4:3" }), "aspect_ratio"],
    [{ action: "submit", prompt: "x" }, "client_request_id"],
    [{ action: "nope" }, "action"],
    [{ action: "status" }, "job_id"],
    [{ action: "status", job_id: "abc" }, "job_id"],
    [{ action: "list", limit: 0 }, "limit"],
    [{ action: "list", limit: MAX_LIST + 1 }, "limit"],
    [{ action: "list", before: "yesterday-ish" }, "before"],
  ] as Array<[unknown, string]>) {
    const r = await handleVideoApi(d, body);
    assert.equal(r.status, 400);
    assert.equal(code(r), "INVALID_REQUEST");
    assert.equal((r.body as { error: { field: string } }).error.field, field);
  }
  assert.equal((await handleVideoApi(d, null)).status, 400);
  assert.equal((await handleVideoApi(d, [])).status, 400);
  assert.equal(calls.submit.length, 0);
});

test("every way a submit can be refused has its own code, status and retry hint", async () => {
  const cases: Array<[SubmitOutcome, number, string, boolean]> = [
    [{ ok: false, code: "quota_exceeded", quota: { used: 95, quota: 100, plan: "free" } }, 429, "VIDEO_QUOTA_EXCEEDED", false],
    [{ ok: false, code: "no_engine" }, 503, "VIDEO_ENGINE_UNAVAILABLE", true],
    [{ ok: false, code: "unknown_model" }, 400, "UNKNOWN_MODEL", false],
    [{ ok: false, code: "unsupported_request" }, 400, "UNSUPPORTED_REQUEST", false],
    [{ ok: false, code: "storage_unavailable" }, 502, "STORAGE_UNAVAILABLE", true],
    [{ ok: false, code: "credits_unavailable" }, 503, "CREDITS_UNAVAILABLE", true],
  ];
  for (const [outcome, status, expected, retryable] of cases) {
    const { deps: d } = deps({ submit: async () => outcome });
    const r = await handleVideoApi(d, submitBody());
    assert.equal(r.status, status);
    assert.equal(code(r), expected);
    assert.equal((r.body as { error: { retryable: boolean } }).error.retryable, retryable);
  }
  const { deps: d } = deps({ submit: async () => ({ ok: false, code: "quota_exceeded", quota: { used: 95, quota: 100, plan: "free" } }) });
  const quota = (await handleVideoApi(d, submitBody())).body as { error: { quota: unknown } };
  assert.deepEqual(quota.error.quota, { used: 95, quota: 100, plan: "free" });
});

test("a repeated request is reported as existing", async () => {
  const { deps: d } = deps({ submit: async () => ({ ok: true, job: job(), existing: true }) });
  const r = await handleVideoApi(d, submitBody());
  assert.equal((r.body as { existing: boolean }).existing, true);
});

test("status moves the job; cancel stops it; a missing job is 404", async () => {
  const { deps: d, calls } = deps();
  assert.equal((await handleVideoApi(d, { action: "status", job_id: JOB.toUpperCase() })).status, 200);
  assert.deepEqual(calls.advance, [JOB]);
  assert.equal((await handleVideoApi(d, { action: "cancel", job_id: JOB })).status, 200);
  assert.deepEqual(calls.cancel, [JOB]);
  const { deps: none } = deps({ advance: async () => null, cancel: async () => null });
  for (const action of ["status", "cancel"]) {
    const r = await handleVideoApi(none, { action, job_id: JOB });
    assert.equal(r.status, 404);
    assert.equal(code(r), "JOB_NOT_FOUND");
  }
});

test("the history uses a default size, a limit, and a clean date", async () => {
  const { deps: d, calls } = deps();
  await handleVideoApi(d, { action: "list" });
  await handleVideoApi(d, { action: "list", limit: 5, before: "2026-11-08T10:00:00+03:30" });
  assert.deepEqual(calls.list[0], [DEFAULT_LIST, undefined]);
  assert.deepEqual(calls.list[1], [5, "2026-11-08T06:30:00.000Z"]);
  const r = await handleVideoApi(d, { action: "list" });
  assert.equal((r.body as { jobs: unknown[] }).jobs.length, 1);
});

test("the model list starts with auto and shows the credit prices", async () => {
  const { deps: d } = deps();
  const r = (await handleVideoApi(d, { action: "models" })).body as {
    default: string; creditsPerSecond: Record<string, number>; models: Array<{ id: string; available: boolean }>;
  };
  assert.equal(r.default, "auto");
  assert.deepEqual(r.creditsPerSecond, { draft: 1, standard: 2, high: 3 });
  assert.deepEqual(r.models.map((m) => [m.id, m.available]), [["m1", true]]);
});
