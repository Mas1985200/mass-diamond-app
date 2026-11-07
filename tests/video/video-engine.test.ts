// tests/video/video-engine.test.ts
// The life of a video job, with small fakes for the database, the storage and
// the engines: charging, repeated requests, fallback, retry, progress,
// finishing, giving up, cancelling and refunds (always once).

import test from "node:test";
import assert from "node:assert/strict";

import type { CreditDecision } from "../../supabase/functions/video-engine/credits.ts";
import {
  advanceVideo,
  cancelVideo,
  estimateProgress,
  presentJob,
  submitVideo,
  LEASE_MS,
  MAX_VIDEO_BYTES,
  type EngineDeps,
} from "../../supabase/functions/video-engine/engine.ts";
import {
  JOB_DEADLINE_MS,
  rowToJob,
  type Job,
} from "../../supabase/functions/video-engine/jobs.ts";
import {
  ProviderError,
  type PollResult,
  type ProviderCapabilities,
  type VideoProvider,
} from "../../supabase/functions/video-engine/providers/types.ts";
import { parseVideoRequest, type VideoJobInput } from "../../supabase/functions/video-engine/request.ts";
import type { JobPatch, JobStore } from "../../supabase/functions/video-engine/store.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-11-07T10:00:00Z");

function input(over: Record<string, unknown> = {}): VideoJobInput {
  const result = parseVideoRequest(
    { client_request_id: "22222222-2222-4222-8222-222222222222", prompt: "a fox", ...over },
    USER,
  );
  assert.ok(result.ok);
  return result.value;
}

// --- fakes -------------------------------------------------------------------

class FakeStore implements JobStore {
  jobs = new Map<string, Job>();
  credits = { used: 0, quota: 100 };
  refunds: number[] = [];
  consumeAnswer: "ok" | "unknown" | "deny" = "ok";
  counter = 0;
  now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }

  async findByRequest(userId: string, id: string) {
    return [...this.jobs.values()].find((j) => j.userId === userId && j.clientRequestId === id) ?? null;
  }
  async get(userId: string, id: string) {
    const job = this.jobs.get(id);
    return job && job.userId === userId ? { ...job } : null;
  }
  async insert(userId: string, i: VideoJobInput, credits: number) {
    const dup = await this.findByRequest(userId, i.clientRequestId);
    if (dup) return { job: dup, created: false };
    const row = {
      id: `job${++this.counter}`, user_id: userId, conversation_id: i.conversationId,
      client_request_id: i.clientRequestId, parent_job_id: i.parentJobId, kind: i.kind,
      status: "queued", progress: 0, user_prompt: i.userPrompt, engine_prompt: i.enginePrompt,
      style: i.style, aspect_ratio: i.aspectRatio, duration_seconds: i.durationSeconds,
      quality: i.quality, params: i.seed === null ? {} : { seed: i.seed },
      source_image_paths: i.imagePaths, model: i.model, attempts: 0, max_attempts: 3,
      next_attempt_at: new Date(this.now()).toISOString(), credits_charged: credits,
      cost_micro_usd: 0, created_at: new Date(this.now()).toISOString(),
    };
    const job = rowToJob(row)!;
    this.jobs.set(job.id, job);
    return { job: { ...job }, created: true };
  }
  async update(id: string, patch: JobPatch) {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    return { ...job };
  }
  async claim(id: string) {
    const job = this.jobs.get(id);
    if (!job || (job.status !== "queued" && job.status !== "processing")) return null;
    if (job.lockedUntil && Date.parse(job.lockedUntil) > this.now()) return null;
    job.lockedUntil = new Date(this.now() + LEASE_MS).toISOString();
    return { ...job };
  }
  async list() { return [...this.jobs.values()]; }
  async consumeCredits(_u: string, cost: number): Promise<CreditDecision | null> {
    if (this.consumeAnswer === "unknown") return null;
    if (this.consumeAnswer === "deny" || this.credits.used + cost > this.credits.quota) {
      return { allowed: false, used: this.credits.used, quota: this.credits.quota, plan: "free" };
    }
    this.credits.used += cost;
    return { allowed: true, used: this.credits.used, quota: this.credits.quota, plan: "free" };
  }
  async refundCredits(_u: string, cost: number) {
    this.refunds.push(cost);
    this.credits.used -= cost;
  }
}

interface Script {
  submit?: Array<string | ProviderError>;
  poll?: Array<PollResult | ProviderError>;
}

function makeProvider(id: string, script: Script = {}, over: Partial<ProviderCapabilities> = {}) {
  const submits = [...(script.submit ?? [`${id}-event`])];
  const polls = [...(script.poll ?? [])];
  const calls = { submit: 0, poll: 0 };
  const provider: VideoProvider = {
    capabilities: {
      id, label: id, kinds: ["text_to_video", "image_to_video"], aspectRatios: ["16:9", "9:16", "1:1"],
      maxDurationSeconds: 10, free: false, costMicroUsdPerSecond: 20_000, ...over,
    },
    isConfigured: () => true,
    async submit() {
      calls.submit++;
      const next = submits.length > 1 ? submits.shift()! : submits[0];
      if (next instanceof ProviderError) throw next;
      return { providerJobId: next };
    },
    async poll() {
      calls.poll++;
      const next = polls.length > 1 ? polls.shift()! : polls[0];
      if (next instanceof ProviderError) throw next;
      return next ?? { state: "running" };
    },
  };
  return { provider, calls };
}

function setup(providers: VideoProvider[], over: { download?: EngineDeps["download"] } = {}) {
  let nowMs = T0;
  const uploads: Array<{ path: string; size: number; type: string }> = [];
  const store = new FakeStore(() => nowMs);
  const deps: EngineDeps = {
    store,
    files: {
      async upload(path, bytes, type) { uploads.push({ path, size: bytes.length, type }); },
      async signedUrl(path) { return `https://signed/${path}`; },
    },
    download: over.download ?? (async () => ({ bytes: new Uint8Array(1000), contentType: "video/mp4" })),
    providers,
    env: {},
    now: () => nowMs,
  };
  return { deps, store, uploads, advance: (ms: number) => { nowMs += ms; } };
}

const ok = (result: Awaited<ReturnType<typeof submitVideo>>) => { assert.ok(result.ok); return result; };

// --- tests -------------------------------------------------------------------

test("asking for a video charges credits, saves the job and starts it at the engine", async () => {
  const { provider } = makeProvider("a");
  const { deps, store } = setup([provider]);
  const { job, existing } = ok(await submitVideo(deps, USER, input()));
  assert.equal(existing, false);
  assert.equal(job.status, "processing");
  assert.equal(job.provider, "a");
  assert.equal(job.providerJobId, "a-event");
  assert.equal(job.attempts, 1);
  assert.equal(job.creditsCharged, 10);
  assert.equal(store.credits.used, 10);
});

test("the same request sent again never starts or charges a second time", async () => {
  const { provider, calls } = makeProvider("a");
  const { deps, store } = setup([provider]);
  const first = ok(await submitVideo(deps, USER, input()));
  const second = ok(await submitVideo(deps, USER, input()));
  assert.equal(second.existing, true);
  assert.equal(second.job.id, first.job.id);
  assert.equal(calls.submit, 1);
  assert.equal(store.credits.used, 10);
});

test("nothing is charged when no engine can make it, or the model is wrong", async () => {
  const { provider } = makeProvider("a", {}, { maxDurationSeconds: 5 });
  const { deps, store } = setup([provider]);
  assert.deepEqual(await submitVideo(deps, USER, input({ duration_seconds: 8 })), { ok: false, code: "no_engine" });
  assert.deepEqual(await submitVideo(deps, USER, input({ model: "zzz" })), { ok: false, code: "unknown_model" });
  const none = setup([]);
  assert.deepEqual(await submitVideo(none.deps, USER, input()), { ok: false, code: "no_engine" });
  assert.equal(store.credits.used, 0);
});

test("over the plan's credits: refused with the numbers; unknown answer is a refusal too", async () => {
  const { provider } = makeProvider("a");
  const { deps, store } = setup([provider]);
  store.credits = { used: 95, quota: 100 };
  assert.deepEqual(await submitVideo(deps, USER, input()), {
    ok: false, code: "quota_exceeded", quota: { used: 95, quota: 100, plan: "free" },
  });
  store.consumeAnswer = "unknown";
  assert.deepEqual(await submitVideo(deps, USER, input()), { ok: false, code: "credits_unavailable" });
  assert.equal(store.jobs.size, 0);
});

test("a start that cannot work ends the job and gives the credits back once", async () => {
  const { provider } = makeProvider("a", { submit: [new ProviderError("content_rejected", "no", false)] });
  const { deps, store } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  assert.equal(job.status, "failed");
  assert.equal(job.errorCode, "content_rejected");
  assert.equal(job.creditsCharged, 0);
  assert.deepEqual(store.refunds, [10]);
  assert.equal(store.credits.used, 0);
});

test("a busy engine at the start waits and tries again later", async () => {
  const { provider } = makeProvider("a", { submit: [new ProviderError("engine_busy", "busy", true), "a-event"] });
  const { deps, advance, store } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 1);
  assert.ok(Date.parse(job.nextAttemptAt) > T0);
  // too early: nothing happens
  const early = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(early.status, "queued");
  advance(10_000);
  const later = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(later.status, "processing");
  assert.equal(later.attempts, 2);
  assert.deepEqual(store.refunds, []);
});

test("if the first engine fails to start, the next one makes the video", async () => {
  const a = makeProvider("a", { submit: [new ProviderError("engine_error", "x", true)] });
  const b = makeProvider("b");
  const { deps } = setup([a.provider, b.provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  assert.equal(job.status, "processing");
  assert.equal(job.provider, "b");
  assert.deepEqual(job.params.tried, ["a"]);
});

test("a picked model is never replaced by another engine", async () => {
  const a = makeProvider("a", { submit: [new ProviderError("engine_error", "x", false)] });
  const b = makeProvider("b");
  const { deps } = setup([a.provider, b.provider]);
  const { job } = ok(await submitVideo(deps, USER, input({ model: "a" })));
  assert.equal(job.status, "failed");
  assert.equal(b.calls.submit, 0);
});

test("progress rises with time, never goes back and never reaches 100 before the end", async () => {
  assert.equal(estimateProgress(0, 0, 0), 5);
  assert.equal(estimateProgress(0, 75_000, 0), 45);
  assert.equal(estimateProgress(0, 75_000, 60), 60);
  assert.equal(estimateProgress(0, 10_000_000, 0), 90);
  const { provider } = makeProvider("a", { poll: [{ state: "running" }] });
  const { deps, advance } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  advance(75_000);
  const running = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(running.status, "processing");
  assert.equal(running.progress, 45);
});

test("a finished video is saved in the owner's folder and shown with a link", async () => {
  const { provider } = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v.mp4" }] });
  const { deps, uploads } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  const done = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(done.status, "succeeded");
  assert.equal(done.resultPath, `${USER}/${job.id}/video.mp4`);
  assert.deepEqual(uploads, [{ path: `${USER}/${job.id}/video.mp4`, size: 1000, type: "video/mp4" }]);
  assert.equal(done.costMicroUsd, 100_000);
  const shown = await presentJob(deps, done);
  assert.equal(shown.videoUrl, `https://signed/${USER}/${job.id}/video.mp4`);
  assert.equal(shown.progress, 100);
});

test("a webm result is kept as webm", async () => {
  const { provider } = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v" }] });
  const { deps, uploads } = setup([provider], { download: async () => ({ bytes: new Uint8Array(5), contentType: "video/webm" }) });
  const { job } = ok(await submitVideo(deps, USER, input()));
  await advanceVideo(deps, USER, job.id);
  assert.equal(uploads[0].type, "video/webm");
  assert.ok(uploads[0].path.endsWith("video.webm"));
});

test("a video that is too big or empty is never kept as a result", async () => {
  const big = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v" }] });
  const s1 = setup([big.provider], { download: async () => ({ bytes: new Uint8Array(MAX_VIDEO_BYTES + 1), contentType: "video/mp4" }) });
  const { job } = ok(await submitVideo(s1.deps, USER, input()));
  const failed = (await advanceVideo(s1.deps, USER, job.id))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "result_too_large");
  assert.deepEqual(s1.store.refunds, [10]);
  assert.equal(s1.uploads.length, 0);

  const empty = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v" }] });
  const s2 = setup([empty.provider], { download: async () => ({ bytes: new Uint8Array(0), contentType: "video/mp4" }) });
  const j2 = ok(await submitVideo(s2.deps, USER, input())).job;
  const again = (await advanceVideo(s2.deps, USER, j2.id))!;
  assert.equal(again.status, "queued");
  assert.equal(s2.uploads.length, 0);
});

test("a failed download or save is handled, not lost", async () => {
  const a = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v" }] });
  const s = setup([a.provider], { download: async () => { throw new Error("net"); } });
  const { job } = ok(await submitVideo(s.deps, USER, input()));
  const retry = (await advanceVideo(s.deps, USER, job.id))!;
  assert.equal(retry.status, "queued");

  const b = makeProvider("a", { poll: [{ state: "succeeded", videoUrl: "https://e/v" }] });
  const s2 = setup([b.provider]);
  s2.deps.files.upload = async () => { throw new Error("disk"); };
  const j2 = ok(await submitVideo(s2.deps, USER, input())).job;
  const failed = (await advanceVideo(s2.deps, USER, j2.id))!;
  assert.equal(failed.errorCode, "storage_failed");
  assert.deepEqual(s2.store.refunds, [10]);
});

test("an engine failure is retried; when the tries run out the credits come back once", async () => {
  const { provider } = makeProvider("a", { poll: [{ state: "failed", code: "quota_exhausted", message: "q", retryable: true }] });
  const { deps, advance, store } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  for (let i = 0; i < 2; i++) {
    const queued = (await advanceVideo(deps, USER, job.id))!;
    assert.equal(queued.status, "queued");
    advance(400_000);
    const again = (await advanceVideo(deps, USER, job.id))!;
    assert.equal(again.status, "processing");
  }
  const last = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(last.status, "failed");
  assert.equal(last.errorCode, "quota_exhausted");
  assert.deepEqual(store.refunds, [10]);
  // asking again changes nothing and never refunds twice
  await advanceVideo(deps, USER, job.id);
  assert.deepEqual(store.refunds, [10]);
});

test("a job that never finishes is given up after the deadline", async () => {
  const { provider } = makeProvider("a", { poll: [{ state: "running" }] });
  const { deps, advance, store } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  advance(JOB_DEADLINE_MS + 1_000);
  const gone = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(gone.status, "failed");
  assert.equal(gone.errorCode, "timeout");
  assert.deepEqual(store.refunds, [10]);
});

test("two requests never work on the same job at once", async () => {
  const { provider, calls } = makeProvider("a", { poll: [{ state: "running" }] });
  const { deps, store } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  store.jobs.get(job.id)!.lockedUntil = new Date(T0 + LEASE_MS).toISOString();
  const shown = (await advanceVideo(deps, USER, job.id))!;
  assert.equal(shown.status, "processing");
  assert.equal(calls.poll, 0);
});

test("another person's job is not found", async () => {
  const { provider } = makeProvider("a");
  const { deps } = setup([provider]);
  const { job } = ok(await submitVideo(deps, USER, input()));
  assert.equal(await advanceVideo(deps, "99999999-9999-4999-8999-999999999999", job.id), null);
  assert.equal(await cancelVideo(deps, "99999999-9999-4999-8999-999999999999", job.id), null);
});

test("cancelling pays back only a job that never reached an engine", async () => {
  const busy = makeProvider("a", { submit: [new ProviderError("engine_busy", "b", true)] });
  const s1 = setup([busy.provider]);
  const queued = ok(await submitVideo(s1.deps, USER, input())).job;
  assert.equal(queued.status, "queued");
  const canceled = (await cancelVideo(s1.deps, USER, queued.id))!;
  assert.equal(canceled.status, "canceled");
  assert.deepEqual(s1.store.refunds, [10]);
  await cancelVideo(s1.deps, USER, queued.id);
  assert.deepEqual(s1.store.refunds, [10]);

  const working = makeProvider("a");
  const s2 = setup([working.provider]);
  const running = ok(await submitVideo(s2.deps, USER, input())).job;
  const stopped = (await cancelVideo(s2.deps, USER, running.id))!;
  assert.equal(stopped.status, "canceled");
  assert.deepEqual(s2.store.refunds, []);
});
