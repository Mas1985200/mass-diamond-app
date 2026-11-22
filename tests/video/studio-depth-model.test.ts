// tests/video/studio-depth-model.test.ts
// The depth of a photo: a model's answer is cleaned and stretched, and anything that
// goes wrong (no model, nonsense, too slow, error) gives a safe guess; only a cancel
// stops the work.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createTransformersEngine,
  estimateDepth,
  fallbackDepth,
  type DepthEngine,
  type RawDepth,
} from "../../src/features/video/studio/depthModel.ts";

const SIZE = { width: 4, height: 3 };
const engineOf = (fn: (url: string) => Promise<RawDepth>): DepthEngine => ({ estimate: fn });

test("the guess has the right size, uses the whole range and is nearer at the bottom", () => {
  const d = fallbackDepth(40, 30);
  assert.equal(d.width, 40);
  assert.equal(d.height, 30);
  assert.equal(d.data.length, 1200);
  assert.equal(Math.min(...d.data), 0);
  assert.equal(Math.max(...d.data), 255);
  assert.ok(d.data[29 * 40 + 20] > d.data[0 * 40 + 20]);
  assert.ok(d.data[15 * 40 + 20] > d.data[15 * 40 + 0]);
});

test("the guess is safe for silly sizes and is capped", () => {
  const tiny = fallbackDepth(0, Number.NaN);
  assert.equal(tiny.data.length, tiny.width * tiny.height);
  const big = fallbackDepth(100000, 100000);
  assert.equal(big.width, 1024);
  assert.equal(big.height, 1024);
});

test("without an engine the guess is used", async () => {
  const r = await estimateDepth("blob:x", SIZE);
  assert.equal(r.source, "fallback");
  assert.equal(r.depth.width, 4);
  assert.equal(r.depth.height, 3);
});

test("a model answer is stretched to 0..255", async () => {
  const engine = engineOf(async () => ({
    width: 2,
    height: 2,
    data: [10, 20, 30, 50],
  }));
  const r = await estimateDepth("blob:x", SIZE, { engine });
  assert.equal(r.source, "model");
  assert.deepEqual(Array.from(r.depth.data), [0, 64, 128, 255]);
});

test("the engine is given the picture address", async () => {
  let seen = "";
  const engine = engineOf(async (url) => {
    seen = url;
    return { width: 2, height: 2, data: [1, 2, 3, 4] };
  });
  await estimateDepth("blob:abc", SIZE, { engine });
  assert.equal(seen, "blob:abc");
});

test("nonsense from the model gives the guess", async () => {
  const bad: RawDepth[] = [
    { width: 2, height: 2, data: [1, 2, 3] },
    { width: 1, height: 4, data: [1, 2, 3, 4] },
    { width: 2.5, height: 2, data: [1, 2, 3, 4, 5] },
    { width: 2, height: 2, data: [Number.NaN, Number.NaN, 1, 2] },
  ];
  for (const raw of bad) {
    const r = await estimateDepth("u", SIZE, { engine: engineOf(async () => raw) });
    assert.equal(r.source, "fallback");
  }
});

test("a few bad numbers are repaired, not thrown away", async () => {
  const data = new Array<number>(100).fill(5);
  data[0] = Number.NaN;
  data[99] = 9;
  const r = await estimateDepth("u", SIZE, {
    engine: engineOf(async () => ({ width: 10, height: 10, data })),
  });
  assert.equal(r.source, "model");
  assert.equal(r.depth.data[99], 255);
});

test("an engine error gives the guess", async () => {
  const r = await estimateDepth("u", SIZE, {
    engine: engineOf(async () => {
      throw new Error("download blocked");
    }),
  });
  assert.equal(r.source, "fallback");
});

test("a model that never answers gives the guess after the timeout", async () => {
  const r = await estimateDepth("u", SIZE, {
    engine: engineOf(() => new Promise<RawDepth>(() => {})),
    timeoutMs: 20,
  });
  assert.equal(r.source, "fallback");
});

test("cancelling stops the work, before and during", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(estimateDepth("u", SIZE, { signal: before.signal }), { name: "AbortError" });

  const during = new AbortController();
  const slow = estimateDepth("u", SIZE, {
    engine: engineOf(() => new Promise<RawDepth>(() => {})),
    signal: during.signal,
    timeoutMs: 5000,
  });
  setTimeout(() => during.abort(), 10);
  await assert.rejects(slow, { name: "AbortError" });
});

test("the real engine makes the model once and reads its tensor", async () => {
  let loads = 0;
  let pipelines = 0;
  const engine = createTransformersEngine(async () => {
    loads += 1;
    return {
      async pipeline(task: string, model: string) {
        pipelines += 1;
        assert.equal(task, "depth-estimation");
        assert.equal(model, "m");
        return async () => ({
          predicted_depth: { dims: [1, 2, 3], data: [1, 2, 3, 4, 5, 6] },
        });
      },
    };
  }, "m");
  const a = await engine.estimate("u");
  const b = await engine.estimate("u");
  assert.equal(a.width, 3);
  assert.equal(a.height, 2);
  assert.deepEqual(Array.from(b.data), [1, 2, 3, 4, 5, 6]);
  assert.equal(loads, 1);
  assert.equal(pipelines, 1);
});

test("a failed load is tried again next time", async () => {
  let loads = 0;
  const engine = createTransformersEngine(async () => {
    loads += 1;
    if (loads === 1) throw new Error("offline");
    return {
      async pipeline() {
        return async () => ({ predicted_depth: { dims: [2, 2], data: [1, 2, 3, 4] } });
      },
    };
  });
  await assert.rejects(engine.estimate("u"));
  const ok = await engine.estimate("u");
  assert.equal(ok.width, 2);
  assert.equal(loads, 2);
});

test("a model answer without a depth tensor is an error", async () => {
  const engine = createTransformersEngine(async () => ({
    async pipeline() {
      return async () => ({});
    },
  }));
  await assert.rejects(engine.estimate("u"));
});
