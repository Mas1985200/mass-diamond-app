// tests/video/video-queue-gauge.test.ts
// The queue counts: the right question is asked of the database, old videos
// that will never finish are not counted, and an error or an unreadable count
// is "unknown" (null), never an empty queue. A small fake client stands in for
// the database.

import test from "node:test";
import assert from "node:assert/strict";

import { JOB_DEADLINE_MS } from "../../supabase/functions/video-engine/jobs.ts";
import { createQueueGauge } from "../../supabase/functions/video-engine/queue-gauge.ts";

type Client = Parameters<typeof createQueueGauge>[0];

function fakeClient(result: { count: unknown; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "in", "gt", "eq"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  };
  return { calls, client: client as unknown as Client };
}

const NOW = Date.parse("2026-11-20T12:00:00Z");

test("counts the active videos of everybody, ignoring stale ones", async () => {
  const fake = fakeClient({ count: 42, error: null });
  const gauge = createQueueGauge(fake.client, () => NOW);
  assert.equal(await gauge.countAllActive(), 42);
  assert.deepEqual(fake.calls, [
    ["from", "video_jobs"],
    ["select", "id", { count: "exact", head: true }],
    ["in", "status", ["queued", "processing"]],
    ["gt", "created_at", new Date(NOW - JOB_DEADLINE_MS).toISOString()],
  ]);
});

test("counts the active videos of one person", async () => {
  const fake = fakeClient({ count: 1, error: null });
  assert.equal(await createQueueGauge(fake.client, () => NOW).countActive("u-1"), 1);
  assert.deepEqual(fake.calls.at(-1), ["eq", "user_id", "u-1"]);
});

test("an error or an unreadable count is unknown, never zero", async () => {
  const failing = fakeClient({ count: null, error: { message: "boom" } });
  assert.equal(await createQueueGauge(failing.client, () => NOW).countAllActive(), null);
  for (const bad of [null, undefined, -1, 2.5, "3"]) {
    const fake = fakeClient({ count: bad, error: null });
    assert.equal(await createQueueGauge(fake.client, () => NOW).countAllActive(), null);
  }
  const empty = fakeClient({ count: 0, error: null });
  assert.equal(await createQueueGauge(empty.client, () => NOW).countAllActive(), 0);
});
