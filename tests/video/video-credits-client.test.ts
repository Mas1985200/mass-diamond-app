// tests/video/video-credits-client.test.ts
// The app's side of the credit display: reading the video function's answer,
// counting the videos the credits are enough for, the words shown, and the
// call itself (what is sent and the three outcomes). A fake network.

import test from "node:test";
import assert from "node:assert/strict";

import { createVideoCreditsApi, type VideoAuth } from "../../src/features/video/videoApi.ts";
import {
  creditLines,
  parseCreditsAnswer,
  videosLeft,
} from "../../src/features/video/videoCredits.ts";

const AUTH: VideoAuth = { url: "https://proj.supabase.co/", token: "tok", anonKey: "anon" };

const STATUS = {
  plan: "free",
  used: 10,
  quota: 20,
  remaining: 10,
  resetsAt: "2026-12-01T00:00:00.000Z",
};

const GOOD = { ok: true, credits: STATUS };

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

test("a good answer is read", () => {
  const result = parseCreditsAnswer(GOOD);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.credits, STATUS);
});

test("a broken answer is not ok", () => {
  const bad = [
    null,
    undefined,
    5,
    "x",
    [],
    {},
    { ok: false },
    { ok: true },
    { ok: true, credits: null },
    { ok: true, credits: { ...STATUS, plan: "gold" } },
    { ok: true, credits: { ...STATUS, used: -1 } },
    { ok: true, credits: { ...STATUS, quota: 1.5 } },
    { ok: true, credits: { ...STATUS, remaining: "10" } },
    { ok: true, credits: { ...STATUS, resetsAt: "not a date" } },
    { ok: true, credits: { ...STATUS, resetsAt: 5 } },
  ];
  for (const body of bad) {
    assert.deepEqual(parseCreditsAnswer(body), { ok: false });
  }
});

test("the remaining credits never show more than the whole quota", () => {
  const result = parseCreditsAnswer({ ok: true, credits: { ...STATUS, remaining: 999 } });
  assert.equal(result.ok && result.credits.remaining, 20);
});

test("the videos left are counted in standard videos of 5 seconds", () => {
  assert.equal(videosLeft(20), 2);
  assert.equal(videosLeft(19), 1);
  assert.equal(videosLeft(9), 0);
  assert.equal(videosLeft(0), 0);
  assert.equal(videosLeft(-5), 0);
  assert.equal(videosLeft(30, { draft: 1, standard: 3, high: 6 }), 2);
});

test("the lines say what is left and what it is enough for", () => {
  const fa = creditLines(STATUS);
  assert.equal(fa.title, "اعتبار این ماه");
  assert.equal(fa.left, "۱۰ از ۲۰ اعتبار باقی است");
  assert.equal(fa.detail, "برای ۱ ویدیوی ۵ ثانیه‌ای استاندارد کافی است");
  assert.equal(fa.plan, "طرح رایگان");

  const en = creditLines({ ...STATUS, plan: "pro", remaining: 40, quota: 300 }, undefined, "en");
  assert.equal(en.left, "40 of 300 credits left");
  assert.equal(en.detail, "Enough for 4 standard videos of 5 seconds");
  assert.equal(en.plan, "Pro plan");
  assert.equal(creditLines({ ...STATUS, remaining: 10 }, undefined, "en").detail, "Enough for 1 standard video of 5 seconds");
});

test("when the credits cannot pay for a video the lines say they are used up", () => {
  assert.equal(creditLines({ ...STATUS, remaining: 0 }).detail, "اعتبار این ماه تمام شده است");
  assert.equal(creditLines({ ...STATUS, remaining: 9 }).detail, "اعتبار این ماه تمام شده است");
  assert.equal(creditLines({ ...STATUS, remaining: 3 }, undefined, "en").detail, "This month's credits are used up");
});

test("credits sends the credits action with the person's own token", async () => {
  const sent: Sent[] = [];
  const api = createVideoCreditsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json(GOOD), sent),
  });
  const outcome = await api.credits();
  assert.equal(outcome.kind, "answer");
  assert.equal(outcome.kind === "answer" && outcome.answer.ok && outcome.answer.credits.remaining, 10);
  assert.equal(sent[0].url, "https://proj.supabase.co/functions/v1/video-engine");
  assert.equal(sent[0].init.method, "POST");
  const headers = sent[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers.apikey, "anon");
  assert.deepEqual(JSON.parse(String(sent[0].init.body)), { action: "credits" });
});

test("nobody signed in is an answer that is not ok, and nothing is sent", async () => {
  const sent: Sent[] = [];
  const api = createVideoCreditsApi({
    getAuth: async () => null,
    fetchImpl: fakeFetch(() => json(GOOD), sent),
  });
  assert.deepEqual(await api.credits(), { kind: "answer", answer: { ok: false } });
  assert.equal(sent.length, 0);
});

test("an error answer from the function is an answer that is not ok", async () => {
  const api = createVideoCreditsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json({ ok: false, error: { code: "CREDITS_UNAVAILABLE", retryable: true } }, 503)),
  });
  assert.deepEqual(await api.credits(), { kind: "answer", answer: { ok: false } });
});

test("a network failure or a broken reply is unreachable", async () => {
  const failing = createVideoCreditsApi({
    getAuth: async () => AUTH,
    fetchImpl: (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(await failing.credits(), { kind: "unreachable" });

  const broken = createVideoCreditsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => new Response("<html>", { status: 502 })),
  });
  assert.deepEqual(await broken.credits(), { kind: "unreachable" });
});

test("a call stopped by the caller is aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const api = createVideoCreditsApi({
    getAuth: async () => AUTH,
    fetchImpl: fakeFetch(() => json(GOOD)),
  });
  assert.deepEqual(await api.credits(controller.signal), { kind: "aborted" });
});

// end of video-credits-client.test.ts
