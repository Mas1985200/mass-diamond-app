// tests/video/video-models-api.test.ts
// The app's call that lists the video models: what is sent, and the three
// outcomes (answer, unreachable, aborted). A fake network, no real calls.

import test from "node:test";
import assert from "node:assert/strict";

import { createVideoModelsApi, type VideoAuth } from "../../src/features/video/videoApi.ts";

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

const GOOD = {
  ok: true,
  default: "auto",
  creditsPerSecond: { draft: 1, standard: 2, high: 3 },
  models: [
    { id: "fal-wan22", label: "Wan 2.2", free: false, available: true, kinds: ["text_to_video"], aspectRatios: ["16:9"], maxDurationSeconds: 5 },
  ],
};

test("models sends the models action with the person's own token", async () => {
  const sent: Sent[] = [];
  const api = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json(GOOD), sent),
  });
  const outcome = await api.models();
  assert.equal(outcome.kind, "answer");
  assert.equal(outcome.kind === "answer" && outcome.answer.ok && outcome.answer.models[0].id, "fal-wan22");
  assert.equal(sent[0].url, "https://proj.supabase.co/functions/v1/video-engine");
  assert.equal(sent[0].init.method, "POST");
  const headers = sent[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers.apikey, "anon");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { action: "models" });
});

test("nobody signed in is an answer that is not ok, and nothing is sent", async () => {
  const sent: Sent[] = [];
  const api = createVideoModelsApi({
    getAuth: async () => null,
    fetchImpl: fakeFetch(() => json(GOOD), sent),
  });
  assert.deepEqual(await api.models(), { kind: "answer", answer: { ok: false } });
  assert.equal(sent.length, 0);
});

test("an error answer from the function is read as not ok", async () => {
  const api = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json({ ok: false, error: { code: "AUTH_REQUIRED" } }, 401)),
  });
  assert.deepEqual(await api.models(), { kind: "answer", answer: { ok: false } });
});

test("no internet, a broken reply and a sign-in failure are unreachable", async () => {
  const offline = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(await offline.models(), { kind: "unreachable" });

  const broken = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => new Response("not json", { status: 200 })),
  });
  assert.deepEqual(await broken.models(), { kind: "unreachable" });

  const noAuth = createVideoModelsApi({
    getAuth: async () => {
      throw new Error("config");
    },
    fetchImpl: fakeFetch(() => json(GOOD)),
  });
  assert.deepEqual(await noAuth.models(), { kind: "unreachable" });
});

test("a call that is already stopped sends nothing", async () => {
  const sent: Sent[] = [];
  const api = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json(GOOD), sent),
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await api.models(controller.signal), { kind: "aborted" });
  assert.equal(sent.length, 0);
});

test("a call stopped on the way is aborted, and a slow one is unreachable", async () => {
  const controller = new AbortController();
  const stopped = createVideoModelsApi({
    getAuth: async () => AUTH,
    fetchImpl: ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        controller.abort();
      })) as unknown as typeof fetch,
  });
  assert.deepEqual(await stopped.models(controller.signal), { kind: "aborted" });

  const slow = createVideoModelsApi({
    getAuth: async () => AUTH,
    timeoutMs: 5,
    fetchImpl: ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("timeout")));
      })) as unknown as typeof fetch,
  });
  assert.deepEqual(await slow.models(), { kind: "unreachable" });
});

// end of video-models-api.test.ts
