// tests/video/worker-queue.test.ts
// The real queue's database calls: the right table, columns and filters, rows that
// are not understood are errors (never guesses), and a task that a worker took at
// the last moment is not withdrawn. A small fake client stands in for the
// database.

import test from "node:test";
import assert from "node:assert/strict";

import { createWorkerQueue, parseTaskRow } from "../../supabase/functions/video-engine/worker-queue.ts";

type Client = Parameters<typeof createWorkerQueue>[0];

const NOW = Date.parse("2026-11-21T10:00:00Z");
const ROW = {
  id: "t1", status: "processing", progress: 40, attempts: 1,
  created_at: "2026-11-21T09:59:00Z", result_path: null, result_duration_seconds: null,
  error_code: null, error_message: null,
};

type Answer = { data?: unknown; error?: { message: string } | null };

function fakeClient(answer: Answer, signed: { data?: { signedUrl?: string } | null; error?: { message: string } | null } = {}) {
  const calls: unknown[][] = [];
  const result = { data: answer.data ?? null, error: answer.error ?? null };
  const builder: Record<string, unknown> = {};
  for (const name of ["insert", "select", "update", "eq"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.single = () => { calls.push(["single"]); return Promise.resolve(result); };
  builder.maybeSingle = () => { calls.push(["maybeSingle"]); return Promise.resolve(result); };
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => { calls.push(["from", table]); return builder; },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          calls.push(["signed", bucket, path, ttl]);
          return { data: signed.data ?? null, error: signed.error ?? null };
        },
      }),
    },
  };
  return { calls, client: client as unknown as Client };
}

test("a row of the table becomes a clean task view", () => {
  assert.deepEqual(parseTaskRow(ROW), {
    id: "t1", status: "processing", progress: 40, attempts: 1,
    createdAtMs: Date.parse("2026-11-21T09:59:00Z"),
    resultPath: null, resultDurationSeconds: null, errorCode: null, errorMessage: null,
  });
  const done = parseTaskRow({ ...ROW, status: "succeeded", progress: 100, result_path: "worker/t1/video.mp4", result_duration_seconds: "6.04" });
  assert.equal(done?.resultPath, "worker/t1/video.mp4");
  assert.equal(done?.resultDurationSeconds, 6.04);
  assert.equal(parseTaskRow({ ...ROW, progress: 250 })?.progress, 100);
  assert.equal(parseTaskRow({ ...ROW, progress: -3 })?.progress, 0);
  assert.equal(parseTaskRow({ ...ROW, result_duration_seconds: -1 })?.resultDurationSeconds, null);
  assert.equal(parseTaskRow({ ...ROW, error_code: "", error_message: "  " })?.errorCode, null);
});

test("a row that is not understood is null, never a guess", () => {
  for (const bad of [
    null, undefined, "x", 5, [],
    { ...ROW, id: "" }, { ...ROW, id: 7 },
    { ...ROW, status: "weird" }, { ...ROW, status: undefined },
    { ...ROW, created_at: "not a date" }, { ...ROW, created_at: null },
    { ...ROW, progress: "abc" }, { ...ROW, attempts: 1.5 }, { ...ROW, attempts: -1 },
  ]) {
    assert.equal(parseTaskRow(bad), null, JSON.stringify(bad));
  }
});

test("a task is put in the queue and its id comes back", async () => {
  const fake = fakeClient({ data: { id: "t9" } });
  assert.equal(await createWorkerQueue(fake.client).enqueue({ prompt: "fox" }), "t9");
  assert.deepEqual(fake.calls, [
    ["from", "video_worker_tasks"],
    ["insert", { request: { prompt: "fox" } }],
    ["select", "id"],
    ["single"],
  ]);
});

test("a task that could not be put in the queue is an error, with no id guessed", async () => {
  await assert.rejects(createWorkerQueue(fakeClient({ error: { message: "boom" } }).client).enqueue({}), /queue insert failed: boom/);
  await assert.rejects(createWorkerQueue(fakeClient({ data: { id: 5 } }).client).enqueue({}), /queue insert failed/);
  await assert.rejects(createWorkerQueue(fakeClient({ data: null }).client).enqueue({}), /queue insert failed/);
});

test("a task is read by its id, and a missing one is null", async () => {
  const fake = fakeClient({ data: ROW });
  assert.equal((await createWorkerQueue(fake.client).get("t1"))?.progress, 40);
  assert.deepEqual(fake.calls.map((c) => c[0]), ["from", "select", "eq", "maybeSingle"]);
  assert.deepEqual(fake.calls[2], ["eq", "id", "t1"]);
  assert.equal(await createWorkerQueue(fakeClient({ data: null }).client).get("nope"), null);
});

test("a database error or an unreadable row throws, so the engine asks again later", async () => {
  await assert.rejects(createWorkerQueue(fakeClient({ error: { message: "down" } }).client).get("t1"), /queue read failed: down/);
  await assert.rejects(createWorkerQueue(fakeClient({ data: { ...ROW, status: "weird" } }).client).get("t1"), /unreadable/);
});

test("only a waiting, never-tried task is withdrawn", async () => {
  const fake = fakeClient({ data: [{ id: "t1" }] });
  assert.equal(await createWorkerQueue(fake.client, () => NOW).abandon("t1"), true);
  assert.deepEqual(fake.calls, [
    ["from", "video_worker_tasks"],
    ["update", {
      status: "failed", error_code: "abandoned",
      error_message: "No worker took the task in time.", completed_at: new Date(NOW).toISOString(),
    }],
    ["eq", "id", "t1"],
    ["eq", "status", "queued"],
    ["eq", "attempts", 0],
    ["select", "id"],
  ]);
});

test("a task a worker took at the last moment is not withdrawn", async () => {
  assert.equal(await createWorkerQueue(fakeClient({ data: [] }).client).abandon("t1"), false);
  assert.equal(await createWorkerQueue(fakeClient({ data: null }).client).abandon("t1"), false);
  await assert.rejects(createWorkerQueue(fakeClient({ error: { message: "down" } }).client).abandon("t1"), /queue withdraw failed/);
});

test("the finished file gets a short-lived link from the videos bucket", async () => {
  const fake = fakeClient({}, { data: { signedUrl: "https://signed/x" } });
  assert.equal(await createWorkerQueue(fake.client).signedUrl("worker/t1/video.mp4", 600), "https://signed/x");
  assert.deepEqual(fake.calls, [["signed", "videos", "worker/t1/video.mp4", 600]]);
  assert.equal(await createWorkerQueue(fakeClient({}, { error: { message: "x" } }).client).signedUrl("p", 1), null);
  assert.equal(await createWorkerQueue(fakeClient({}, { data: {} }).client).signedUrl("p", 1), null);
});
