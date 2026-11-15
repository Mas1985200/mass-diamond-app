// tests/video/soon.test.ts
// A slow job step is answered quickly and finishes in the background.

import test from "node:test";
import assert from "node:assert/strict";

import { answerSoon } from "../../supabase/functions/video-engine/soon.ts";

const never = () => new Promise<never>(() => undefined);

test("work that finishes in time is the answer, and nothing is kept alive", async () => {
  let kept = 0;
  const answer = await answerSoon({
    work: Promise.resolve("done"),
    waitMs: 50,
    fallback: async () => "state now",
    keepAlive: () => {
      kept += 1;
    },
  });
  assert.equal(answer, "done");
  assert.equal(kept, 0);
});

test("slow work: the state now is the answer and the work is kept alive", async () => {
  const kept: Promise<unknown>[] = [];
  let finish: (value: string) => void = () => undefined;
  const work = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const answer = await answerSoon({
    work,
    waitMs: 5,
    fallback: async () => "state now",
    keepAlive: (task) => {
      kept.push(task);
    },
  });
  assert.equal(answer, "state now");
  assert.equal(kept.length, 1);
  finish("late result");
  await kept[0];
});

test("work that fails after the answer is reported, never thrown", async () => {
  const kept: Promise<unknown>[] = [];
  const errors: unknown[] = [];
  let fail: (error: Error) => void = () => undefined;
  const work = new Promise<string>((_resolve, reject) => {
    fail = reject;
  });
  const answer = await answerSoon({
    work,
    waitMs: 5,
    fallback: async () => "state now",
    keepAlive: (task) => {
      kept.push(task);
    },
    onLateError: (error) => {
      errors.push(error);
    },
  });
  assert.equal(answer, "state now");
  fail(new Error("engine broke"));
  await kept[0];
  assert.equal(errors.length, 1);
});

test("work that fails in time is thrown to the caller", async () => {
  await assert.rejects(
    answerSoon({
      work: Promise.reject(new Error("boom")),
      waitMs: 50,
      fallback: never,
      keepAlive: () => undefined,
    }),
    /boom/,
  );
});

// end of soon.test.ts
