// tests/video/video-api.client.test.ts
// The app's calls to the video function: what is sent, and the three
// outcomes (answer, unreachable, aborted). A fake network, no real calls.

import test from "node:test";
import assert from "node:assert/strict";

import { createVideoApi, type VideoAuth } from "../../src/features/video/videoApi.ts";

const ID = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";
const AUTH: VideoAuth = { url: "https://proj.supabase.co/", token: "tok", anonKey: "anon" };

interface Sent { url: string; init: RequestInit }

function fakeFetch(reply: (sent: Sent) => Response | Promise<Response>, sent: Sent[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const call = { url, init };
    sent.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("status sends the job id and the person's own token to the video function", async () => {
  const sent: Sent[] = [];
  const api = createVideoApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json({ ok: true, job: { id: ID, status: "processing", progress: 30 } }), sent),
  });
  const outcome = await api.status(ID);
  assert.equal(outcome.kind, "answer");
  assert.equal(outcome.kind === "answer" && outcome.answer.ok && outcome.answer.job.progress, 30);
  assert.equal(sent[0].url, "https://proj.supabase.co/functions/v1/video-engine");
  assert.equal(sent[0].init.method, "POST");
  const headers = sent[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers.apikey, "anon");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { action: "status", job_id: ID });
});

test("cancel uses the cancel action and no key header when there is none", async () => {
  const sent: Sent[] = [];
  const api = createVideoApi({
    getAuth: async () => ({ ...AUTH, anonKey: null }),
    fetchImpl: fakeFetch(() => json({ ok: true, job: { id: ID, status: "canceled", progress: 0 } }), sent),
  });
  await api.cancel(ID);
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { action: "cancel", job_id: ID });
  assert.equal((sent[0].init.headers as Record<string, string>).apikey, undefined);
});

test("an explained error is an answer, even with a bad status code", async () => {
  const api = createVideoApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json({ ok: false, error: { code: "JOB_NOT_FOUND", retryable: false } }, 404)),
  });
  const outcome = await api.status(ID);
  assert.deepEqual(outcome, { kind: "answer", answer: { ok: false, code: "JOB_NOT_FOUND", retryable: false } });
});

test("nobody signed in is a final answer; a failing sign-in lookup is unreachable", async () => {
  const none = createVideoApi({ getAuth: async () => null, fetchImpl: fakeFetch(() => json({})) });
  assert.deepEqual(await none.status(ID), { kind: "answer", answer: { ok: false, code: "AUTH_REQUIRED", retryable: false } });
  const broken = createVideoApi({ getAuth: async () => { throw new Error("storage"); }, fetchImpl: fakeFetch(() => json({})) });
  assert.deepEqual(await broken.status(ID), { kind: "unreachable" });
});

test("no internet, a non-JSON reply and a failing server are unreachable, never a made-up answer", async () => {
  const offline = createVideoApi({ getAuth: async () => AUTH, fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch });
  assert.deepEqual(await offline.status(ID), { kind: "unreachable" });
  const html = createVideoApi({ getAuth: async () => AUTH, fetchImpl: fakeFetch(() => new Response("<html>504</html>", { status: 504 })) });
  assert.deepEqual(await html.status(ID), { kind: "unreachable" });
});

test("an odd JSON reply becomes a retryable error answer", async () => {
  const api = createVideoApi({ getAuth: async () => AUTH, fetchImpl: fakeFetch(() => json({ hello: "world" }, 500)) });
  assert.deepEqual(await api.status(ID), { kind: "answer", answer: { ok: false, code: "UNKNOWN", retryable: true } });
});

test("a call that takes too long is unreachable", async () => {
  const slow = (async (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const api = createVideoApi({ getAuth: async () => AUTH, fetchImpl: slow, timeoutMs: 20 });
  assert.deepEqual(await api.status(ID), { kind: "unreachable" });
});

test("the caller can stop a call: aborted, and nothing is sent when already stopped", async () => {
  const sent: Sent[] = [];
  const hang = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as unknown as typeof fetch;
  const api = createVideoApi({ getAuth: async () => AUTH, fetchImpl: hang });
  const controller = new AbortController();
  const pending = api.status(ID, controller.signal);
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  assert.deepEqual(await pending, { kind: "aborted" });

  const stopped = new AbortController();
  stopped.abort();
  const before = sent.length;
  assert.deepEqual(await api.status(ID, stopped.signal), { kind: "aborted" });
  assert.equal(sent.length, before);
});
