// tests/video/self-worker.test.ts
// Mass Diamond's own engine, followed through a fake queue: the task the worker
// is given, every state of a task, the wait for a worker that never comes, and
// the way a failed task is told to the engine. No network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PICKUP_SECONDS,
  RESULT_LINK_SECONDS,
  SELF_WORKER_CAPABILITIES,
  buildWorkerRequest,
  createSelfWorkerProvider,
  readPickupSeconds,
  selfWorkerEnabled,
  type WorkerQueue,
  type WorkerTaskView,
} from "../../supabase/functions/video-engine/providers/self-worker.ts";
import { ProviderError, supportsRequest, type VideoRequest } from "../../supabase/functions/video-engine/providers/types.ts";

const T0 = Date.parse("2026-11-21T10:00:00Z");

const request: VideoRequest = {
  kind: "text_to_video", prompt: "  A red fox in snow  ", style: "cinematic",
  aspectRatio: "9:16", durationSeconds: 6, quality: "high", imageUrls: [],
};

function task(patch: Partial<WorkerTaskView> = {}): WorkerTaskView {
  return {
    id: "t1", status: "queued", progress: 0, attempts: 0, createdAtMs: T0,
    resultPath: null, resultDurationSeconds: null, errorCode: null, errorMessage: null,
    ...patch,
  };
}

class FakeQueue implements WorkerQueue {
  enqueued: Array<Record<string, unknown>> = [];
  abandoned: string[] = [];
  current: WorkerTaskView | null = task();
  canAbandon = true;
  link: string | null = "https://signed/video.mp4";
  linkAsked: Array<[string, number]> = [];
  failEnqueue = false;
  async enqueue(r: Record<string, unknown>) {
    if (this.failEnqueue) throw new Error("db down");
    this.enqueued.push(r);
    return "t1";
  }
  async get() { return this.current; }
  async abandon(id: string) { this.abandoned.push(id); return this.canAbandon; }
  async signedUrl(path: string, ttl: number) { this.linkAsked.push([path, ttl]); return this.link; }
}

function make(queue: FakeQueue, nowMs = T0, pickupSeconds = 120) {
  return createSelfWorkerProvider(queue, { pickupSeconds, now: () => nowMs });
}

test("the engine is on only when the switch is on", () => {
  for (const on of ["on", "ON", "1", "true", " yes "]) assert.equal(selfWorkerEnabled({ VIDEO_SELF_WORKER: on }), true, on);
  for (const off of [undefined, "", "off", "0", "false", "no", "maybe"]) assert.equal(selfWorkerEnabled({ VIDEO_SELF_WORKER: off }), false, String(off));
  assert.equal(make(new FakeQueue()).isConfigured({ VIDEO_SELF_WORKER: "on" }), true);
  assert.equal(make(new FakeQueue()).isConfigured({}), false);
});

test("the wait for a worker is read safely", () => {
  assert.equal(readPickupSeconds({}), DEFAULT_PICKUP_SECONDS);
  assert.equal(readPickupSeconds({ VIDEO_WORKER_PICKUP_SECONDS: "45" }), 45);
  for (const bad of ["", "abc", "-5", "4.5", "5", "99999", "1e3"]) {
    assert.equal(readPickupSeconds({ VIDEO_WORKER_PICKUP_SECONDS: bad }), DEFAULT_PICKUP_SECONDS, bad);
  }
});

test("it can make every kind, every shape, and up to the job table's limit", () => {
  for (const kind of ["text_to_video", "image_to_video", "multi_image_to_video"] as const) {
    for (const aspectRatio of ["16:9", "9:16", "1:1"] as const) {
      assert.ok(supportsRequest(SELF_WORKER_CAPABILITIES, { ...request, kind, aspectRatio, durationSeconds: 60 }));
    }
  }
  assert.equal(supportsRequest(SELF_WORKER_CAPABILITIES, { ...request, durationSeconds: 61 }), false);
  assert.equal(SELF_WORKER_CAPABILITIES.free, true);
});

test("the task for the worker carries every setting, clean and bounded", () => {
  assert.deepEqual(buildWorkerRequest({ ...request, seed: 7 }), {
    kind: "text_to_video", prompt: "A red fox in snow", style: "cinematic",
    aspect_ratio: "9:16", quality: "high", duration_seconds: 6, image_urls: [], seed: 7,
  });
  assert.equal("seed" in buildWorkerRequest(request), false);
  assert.equal(buildWorkerRequest({ ...request, durationSeconds: 999 }).duration_seconds, 60);
  assert.equal(buildWorkerRequest({ ...request, durationSeconds: 0 }).duration_seconds, 1);
  assert.equal(buildWorkerRequest({ ...request, durationSeconds: Number.NaN }).duration_seconds, 60);
  assert.equal(buildWorkerRequest({ ...request, durationSeconds: 5.6 }).duration_seconds, 6);
  assert.equal(String(buildWorkerRequest({ ...request, prompt: "x".repeat(5000) }).prompt).length, 2000);
  assert.equal(buildWorkerRequest({ ...request, seed: -5.9 }).seed, 6);
  assert.deepEqual(
    buildWorkerRequest({ ...request, kind: "image_to_video", imageUrls: ["https://a/1.png"] }).image_urls,
    ["https://a/1.png"],
  );
  assert.deepEqual(buildWorkerRequest({ ...request, imageUrls: ["https://a/1.png"] }).image_urls, []);
});

test("submit puts the task in the queue and returns its id", async () => {
  const queue = new FakeQueue();
  assert.deepEqual(await make(queue).submit(request), { providerJobId: "t1" });
  assert.equal(queue.enqueued.length, 1);
});

test("a queue that cannot take the task is a retryable engine error, with no detail leaked", async () => {
  const queue = new FakeQueue();
  queue.failEnqueue = true;
  await assert.rejects(make(queue).submit(request), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "engine_error");
    assert.equal(error.retryable, true);
    assert.equal(error.message.includes("db down"), false);
    return true;
  });
});

test("a waiting or working task is running, with a small first progress", async () => {
  const queue = new FakeQueue();
  assert.deepEqual(await make(queue).poll("t1"), { state: "running", progress: 2 });
  queue.current = task({ status: "processing", progress: 40, attempts: 1 });
  assert.deepEqual(await make(queue).poll("t1"), { state: "running", progress: 40 });
});

test("a task nobody takes is withdrawn after the wait, and the engine moves on", async () => {
  const queue = new FakeQueue();
  const justInside = T0 + 120_000;
  assert.equal((await make(queue, justInside).poll("t1")).state, "running");
  assert.deepEqual(queue.abandoned, []);

  const late = await make(queue, justInside + 1).poll("t1");
  assert.deepEqual(late, {
    state: "failed", code: "engine_busy", message: "No worker took the task in time.", retryable: true,
  });
  assert.deepEqual(queue.abandoned, ["t1"]);
});

test("a worker that takes the task at the last moment wins: the task keeps running", async () => {
  const queue = new FakeQueue();
  queue.canAbandon = false;
  assert.equal((await make(queue, T0 + 999_000).poll("t1")).state, "running");
});

test("a task that was tried before and waits for its next try is not withdrawn", async () => {
  const queue = new FakeQueue();
  queue.current = task({ status: "queued", attempts: 1 });
  assert.equal((await make(queue, T0 + 999_000).poll("t1")).state, "running");
  assert.deepEqual(queue.abandoned, []);
});

test("a finished task gives the engine a short-lived link and the length", async () => {
  const queue = new FakeQueue();
  queue.current = task({ status: "succeeded", resultPath: "worker/t1/video.mp4", resultDurationSeconds: 6.04 });
  assert.deepEqual(await make(queue).poll("t1"), {
    state: "succeeded", videoUrl: "https://signed/video.mp4", durationSeconds: 6.04,
  });
  assert.deepEqual(queue.linkAsked, [["worker/t1/video.mp4", RESULT_LINK_SECONDS]]);
});

test("a finished task whose file cannot be linked is a retryable failure, never a made-up success", async () => {
  const queue = new FakeQueue();
  queue.current = task({ status: "succeeded", resultPath: "worker/t1/video.mp4" });
  queue.link = null;
  assert.deepEqual(await make(queue).poll("t1"), {
    state: "failed", code: "bad_response", message: "The finished video could not be found.", retryable: true,
  });
  queue.current = task({ status: "succeeded", resultPath: null });
  assert.equal((await make(queue).poll("t1")).state, "failed");
});

test("a failed task: a request that can never work is final, anything else may work elsewhere", async () => {
  const queue = new FakeQueue();
  queue.current = task({ status: "failed", errorCode: "invalid_request", errorMessage: "bad prompt" });
  assert.deepEqual(await make(queue).poll("t1"), {
    state: "failed", code: "unsupported_request", message: "bad prompt", retryable: false,
  });
  queue.current = task({ status: "failed", errorCode: "worker_lost", errorMessage: null });
  assert.deepEqual(await make(queue).poll("t1"), {
    state: "failed", code: "engine_error", message: "The worker could not make the video.", retryable: true,
  });
  queue.current = task({ status: "failed", errorCode: "x", errorMessage: "y".repeat(900) });
  const long = await make(queue).poll("t1");
  assert.ok(long.state === "failed" && long.message.length === 200);
});

test("a task that disappeared is a retryable failure", async () => {
  const queue = new FakeQueue();
  queue.current = null;
  const result = await make(queue).poll("t1");
  assert.ok(result.state === "failed" && result.retryable && result.code === "engine_error");
});
