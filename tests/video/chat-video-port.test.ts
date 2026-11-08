// tests/video/chat-video-port.test.ts
// Starting a video from the chat: the request sent to the video function, the
// stable request id, and every kind of answer. Faked network, nothing real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_FUNCTION_PATH,
  createVideoPort,
  readCreateAnswer,
  uuidFromText,
} from "../../supabase/functions/ai-chat/video/port.ts";
import type { CreateVideoArgs } from "../../supabase/functions/ai-chat/video/args.ts";

const args: CreateVideoArgs = {
  idea: "a fox", enginePrompt: "A red fox in snow", style: "cinematic",
  aspectRatio: "9:16", durationSeconds: 4, quality: "high", model: "auto",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const job = { id: "j1", status: "processing", aspectRatio: "9:16", durationSeconds: 4, quality: "high", creditsCharged: 12 };

function fake(status: number, body: unknown) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

test("the request id is a valid uuid, the same for the same text and different otherwise", async () => {
  const a = await uuidFromText("conv|3|a fox");
  assert.match(a, UUID);
  assert.equal(a, await uuidFromText("conv|3|a fox"));
  assert.notEqual(a, await uuidFromText("conv|5|a fox"));
});

test("the video function is called with the person's own token and every setting", async () => {
  const { impl, seen } = fake(200, { ok: true, existing: false, job });
  const port = createVideoPort({
    baseUrl: "https://p.supabase.co/", authorization: "Bearer user-token", conversationId: "c1", apiKey: "anon", fetchImpl: impl,
  });
  const result = await port.create(args, { requestKey: "k1", parentJobId: "p1" });
  assert.equal(seen[0].url, `https://p.supabase.co${VIDEO_FUNCTION_PATH}`);
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer user-token");
  assert.equal(headers.apikey, "anon");
  const sent = JSON.parse(String(seen[0].init.body));
  assert.equal(sent.action, "submit");
  assert.match(sent.client_request_id, UUID);
  assert.equal(sent.conversation_id, "c1");
  assert.equal(sent.parent_job_id, "p1");
  assert.deepEqual(
    [sent.prompt, sent.engine_prompt, sent.style, sent.aspect_ratio, sent.duration_seconds, sent.quality, sent.model],
    ["a fox", "A red fox in snow", "cinematic", "9:16", 4, "high", "auto"],
  );
  assert.deepEqual(result, {
    ok: true, jobId: "j1", status: "processing", existing: false, aspectRatio: "9:16", durationSeconds: 4, quality: "high", creditsCharged: 12,
  });
});

test("without a parent video no parent is sent, and the same turn sends the same id", async () => {
  const one = fake(200, { ok: true, job });
  const two = fake(200, { ok: true, job });
  const config = { baseUrl: "https://p.supabase.co", authorization: "Bearer t", conversationId: "c1" };
  await createVideoPort({ ...config, fetchImpl: one.impl }).create(args, { requestKey: "same" });
  await createVideoPort({ ...config, fetchImpl: two.impl }).create(args, { requestKey: "same" });
  const a = JSON.parse(String(one.seen[0].init.body));
  assert.equal("parent_job_id" in a, false);
  assert.equal(a.client_request_id, JSON.parse(String(two.seen[0].init.body)).client_request_id);
});

test("a repeated request is reported as existing", () => {
  const r = readCreateAnswer(200, { ok: true, existing: true, job });
  assert.ok(r.ok && r.existing);
});

test("every error code of the video function becomes one clear failure", () => {
  const code = (c: string, extra: object = {}) => readCreateAnswer(400, { ok: false, error: { code: c, ...extra } });
  assert.deepEqual(code("VIDEO_QUOTA_EXCEEDED", { quota: { used: 18, quota: 20, plan: "free" } }), {
    ok: false, code: "quota_exceeded", retryable: false, quota: { used: 18, quota: 20, plan: "free" },
  });
  assert.deepEqual(code("VIDEO_QUOTA_EXCEEDED"), { ok: false, code: "quota_exceeded", retryable: false });
  assert.deepEqual(code("VIDEO_ENGINE_UNAVAILABLE"), { ok: false, code: "engine_unavailable", retryable: true });
  assert.deepEqual(code("UNSUPPORTED_REQUEST"), { ok: false, code: "unsupported", retryable: false });
  assert.deepEqual(code("UNKNOWN_MODEL"), { ok: false, code: "unsupported", retryable: false });
  assert.deepEqual(code("INVALID_REQUEST"), { ok: false, code: "invalid", retryable: false });
  assert.deepEqual(code("AUTH_REQUIRED"), { ok: false, code: "not_signed_in", retryable: false });
  assert.deepEqual(code("CREDITS_UNAVAILABLE"), { ok: false, code: "temporary", retryable: true });
  assert.deepEqual(code("SOMETHING_NEW"), { ok: false, code: "temporary", retryable: true });
});

test("a strange answer is a temporary failure, never a made-up success", async () => {
  for (const [status, body] of [[200, { ok: true }], [200, { ok: true, job: { id: "j1" } }], [500, null], [200, "text"], [200, []]] as Array<[number, unknown]>) {
    const r = readCreateAnswer(status, body);
    assert.deepEqual(r, { ok: false, code: "temporary", retryable: true });
  }
  assert.deepEqual(readCreateAnswer(401, null), { ok: false, code: "not_signed_in", retryable: false });
  const down = createVideoPort({
    baseUrl: "https://p.supabase.co", authorization: "Bearer t", conversationId: "c1",
    fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
  });
  assert.deepEqual(await down.create(args, { requestKey: "k" }), { ok: false, code: "temporary", retryable: true });
});
