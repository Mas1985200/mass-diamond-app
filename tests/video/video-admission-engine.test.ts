// tests/video/video-admission-engine.test.ts
// The doorman at the door of the engine: a video enters only while the person
// and the queue have room, a refused video costs nothing and starts nothing, a
// repeated request is never refused (it is the same video), and a queue that
// cannot be counted is a refusal, not a free pass. Small fakes, no network.

import test from "node:test";
import assert from "node:assert/strict";

import type { AdmissionLimits } from "../../supabase/functions/video-engine/admission.ts";
import type { CreditDecision } from "../../supabase/functions/video-engine/credits.ts";
import {
  submitVideo,
  type EngineDeps,
} from "../../supabase/functions/video-engine/engine.ts";
import { rowToJob, type Job } from "../../supabase/functions/video-engine/jobs.ts";
import type { VideoProvider } from "../../supabase/functions/video-engine/providers/types.ts";
import { parseVideoRequest, type VideoJobInput } from "../../supabase/functions/video-engine/request.ts";
import type { JobPatch, JobStore, QueueGauge } from "../../supabase/functions/video-engine/store.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-11-20T10:00:00Z");

function input(): VideoJobInput {
  const result = parseVideoRequest(
    { client_request_id: "22222222-2222-4222-8222-222222222222", prompt: "a fox" },
    USER,
  );
  assert.ok(result.ok);
  return result.value;
}

class FakeStore implements JobStore {
  jobs = new Map<string, Job>();
  consumed = 0;
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
    const job = rowToJob({
      id: `job${this.jobs.size + 1}`, user_id: userId, client_request_id: i.clientRequestId,
      kind: i.kind, status: "queued", progress: 0, user_prompt: i.userPrompt,
      engine_prompt: i.enginePrompt, style: i.style, aspect_ratio: i.aspectRatio,
      duration_seconds: i.durationSeconds, quality: i.quality, params: {},
      source_image_paths: i.imagePaths, model: i.model, attempts: 0, max_attempts: 3,
      next_attempt_at: new Date(T0).toISOString(), credits_charged: credits,
      cost_micro_usd: 0, created_at: new Date(T0).toISOString(),
    })!;
    this.jobs.set(job.id, job);
    return { job: { ...job }, created: true };
  }
  async update(id: string, patch: JobPatch) {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    return { ...job };
  }
  async claim(id: string) { return this.jobs.get(id) ?? null; }
  async list() { return [...this.jobs.values()]; }
  async consumeCredits(): Promise<CreditDecision | null> {
    this.consumed++;
    return { allowed: true, used: 10, quota: 100, plan: "free" };
  }
  async refundCredits() {}
}

class FakeGauge implements QueueGauge {
  asked = 0;
  user: number | null;
  total: number | null;
  constructor(user: number | null, total: number | null) {
    this.user = user;
    this.total = total;
  }
  async countActive() { this.asked++; return this.user; }
  async countAllActive() { this.asked++; return this.total; }
}

const provider: VideoProvider = {
  capabilities: {
    id: "a", label: "a", kinds: ["text_to_video"], aspectRatios: ["16:9", "9:16", "1:1"],
    maxDurationSeconds: 10, free: true, costMicroUsdPerSecond: 0,
  },
  isConfigured: () => true,
  async submit() { return { providerJobId: "event-1" }; },
  async poll() { return { state: "running" }; },
};

const limits: AdmissionLimits = { maxActivePerUser: 2, maxQueue: 100 };

function setup(gauge: QueueGauge | null) {
  const store = new FakeStore();
  const deps: EngineDeps = {
    store,
    files: { async upload() {}, async signedUrl(path) { return `https://signed/${path}`; } },
    download: async () => ({ bytes: new Uint8Array(10), contentType: "video/mp4" }),
    providers: [provider],
    env: {},
    now: () => T0,
    ...(gauge ? { admission: { gauge, limits } } : {}),
  };
  return { deps, store };
}

test("a video enters while the person and the queue have room", async () => {
  const { deps, store } = setup(new FakeGauge(1, 99));
  const result = await submitVideo(deps, USER, input());
  assert.ok(result.ok);
  assert.equal(store.jobs.size, 1);
  assert.equal(store.consumed, 1);
});

test("a person with too many videos running is told to wait, and pays nothing", async () => {
  const { deps, store } = setup(new FakeGauge(2, 5));
  assert.deepEqual(await submitVideo(deps, USER, input()), {
    ok: false, code: "too_many_active", retryAfterSeconds: 30, limit: 2,
  });
  assert.equal(store.consumed, 0);
  assert.equal(store.jobs.size, 0);
});

test("a full queue refuses everybody for a moment, and charges nothing", async () => {
  const { deps, store } = setup(new FakeGauge(0, 100));
  assert.deepEqual(await submitVideo(deps, USER, input()), {
    ok: false, code: "queue_full", retryAfterSeconds: 120, limit: 100,
  });
  assert.equal(store.consumed, 0);
  assert.equal(store.jobs.size, 0);
});

test("a queue that cannot be counted is a refusal, never a free pass", async () => {
  for (const gauge of [new FakeGauge(null, 5), new FakeGauge(0, null)]) {
    const { deps, store } = setup(gauge);
    assert.deepEqual(await submitVideo(deps, USER, input()), { ok: false, code: "queue_unavailable" });
    assert.equal(store.consumed, 0);
    assert.equal(store.jobs.size, 0);
  }
});

test("a repeated request is the same video: never refused, never counted again", async () => {
  const gauge = new FakeGauge(0, 0);
  const { deps, store } = setup(gauge);
  const first = await submitVideo(deps, USER, input());
  assert.ok(first.ok);
  gauge.user = 2;
  gauge.total = 100;
  const askedBefore = gauge.asked;
  const second = await submitVideo(deps, USER, input());
  assert.ok(second.ok);
  assert.equal(second.existing, true);
  assert.equal(gauge.asked, askedBefore);
  assert.equal(store.consumed, 1);
});

test("a queue limit of 0 closes the door for new videos", async () => {
  const closed = setup(new FakeGauge(0, 0));
  closed.deps.admission = { gauge: new FakeGauge(0, 0), limits: { maxActivePerUser: 2, maxQueue: 0 } };
  const result = await submitVideo(closed.deps, USER, input());
  assert.equal(result.ok === false && result.code, "queue_full");
});

test("without a doorman every video may enter, as before", async () => {
  const { deps, store } = setup(null);
  assert.ok((await submitVideo(deps, USER, input())).ok);
  assert.equal(store.jobs.size, 1);
});
