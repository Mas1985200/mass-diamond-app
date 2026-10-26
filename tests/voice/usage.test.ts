// tests/voice/usage.test.ts
// The speech service is protected from quick repeated use (rate limit) and from
// doing the same request twice (replay guard). A fake clock replaces real time,
// so nothing waits and nothing is random.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createRateLimiter,
  createReplayGuard,
} from "../../supabase/functions/transcribe/usage.ts";

function fakeClock(start = 1_000_000) {
  let time = start;

  return {
    now: (): number => time,
    advance: (ms: number): void => {
      time += ms;
    },
  };
}

test("rate limit: requests inside the limit are allowed, the next one is not", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(3, 60_000, clock.now);

  assert.equal(limiter.check("user-a").allowed, true);
  assert.equal(limiter.check("user-a").allowed, true);
  assert.equal(limiter.check("user-a").allowed, true);
  assert.equal(limiter.check("user-a").allowed, false);
});

test("rate limit: the refusal says how many seconds to wait", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(1, 60_000, clock.now);

  limiter.check("user-a");
  clock.advance(20_000);

  const refused = limiter.check("user-a");

  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 40);
});

test("rate limit: after the window the user may ask again", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(1, 60_000, clock.now);

  assert.equal(limiter.check("user-a").allowed, true);
  assert.equal(limiter.check("user-a").allowed, false);

  clock.advance(60_000);

  assert.equal(limiter.check("user-a").allowed, true);
});

test("rate limit: one user's use never blocks another user", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(1, 60_000, clock.now);

  assert.equal(limiter.check("user-a").allowed, true);
  assert.equal(limiter.check("user-a").allowed, false);
  assert.equal(limiter.check("user-b").allowed, true);
});

test("rate limit: a refused request does not extend the wait", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter(1, 60_000, clock.now);

  limiter.check("user-a");
  clock.advance(30_000);
  limiter.check("user-a");
  limiter.check("user-a");
  clock.advance(30_000);

  assert.equal(limiter.check("user-a").allowed, true);
});

test("replay guard: the same key is worked on once while it runs", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 100, () => true, clock.now);
  let calls = 0;
  let release: (value: string) => void = () => undefined;

  const work = (): Promise<string> => {
    calls += 1;

    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };

  const first = guard.run("u:1", work);
  const second = guard.run("u:1", work);

  release("text");

  assert.equal(await first, "text");
  assert.equal(await second, "text");
  assert.equal(calls, 1);
});

test("replay guard: a good answer is given again for the same key", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 100, () => true, clock.now);
  let calls = 0;
  const work = async (): Promise<string> => {
    calls += 1;

    return "text";
  };

  assert.equal(await guard.run("u:1", work), "text");
  assert.equal(await guard.run("u:1", work), "text");
  assert.equal(calls, 1);
});

test("replay guard: after the time is over the work is done again", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 100, () => true, clock.now);
  let calls = 0;
  const work = async (): Promise<string> => {
    calls += 1;

    return `text ${calls}`;
  };

  assert.equal(await guard.run("u:1", work), "text 1");

  clock.advance(120_001);

  assert.equal(await guard.run("u:1", work), "text 2");
});

test("replay guard: an answer that is not kept is tried again next time", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(
    120_000,
    100,
    (value) => value !== "error",
    clock.now,
  );
  let calls = 0;
  const work = async (): Promise<string> => {
    calls += 1;

    return calls === 1 ? "error" : "text";
  };

  assert.equal(await guard.run("u:1", work), "error");
  assert.equal(await guard.run("u:1", work), "text");
  assert.equal(calls, 2);
});

test("replay guard: work that throws is not kept and can be tried again", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 100, () => true, clock.now);
  let calls = 0;
  const work = async (): Promise<string> => {
    calls += 1;

    if (calls === 1) {
      throw new Error("down");
    }

    return "text";
  };

  await assert.rejects(guard.run("u:1", work), /down/);
  assert.equal(await guard.run("u:1", work), "text");
});

test("replay guard: different keys never share an answer", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 100, () => true, clock.now);

  assert.equal(await guard.run("u:1", async () => "one"), "one");
  assert.equal(await guard.run("u:2", async () => "two"), "two");
  assert.equal(await guard.run("v:1", async () => "three"), "three");
});

test("replay guard: the oldest answers are dropped when there are too many", async () => {
  const clock = fakeClock();
  const guard = createReplayGuard<string>(120_000, 2, () => true, clock.now);
  let calls = 0;
  const work = async (): Promise<string> => {
    calls += 1;

    return `text ${calls}`;
  };

  await guard.run("k1", work);
  await guard.run("k2", work);
  await guard.run("k3", work);

  // k1 was dropped, so it is worked on again; k3 is still remembered.
  assert.equal(await guard.run("k3", work), "text 3");
  assert.equal(await guard.run("k1", work), "text 4");
});
