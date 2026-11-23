// tests/video/studio-parallax-cache.test.ts
// The cache of 3D layers: scenes are made a little at a time just before they are
// needed, finished scenes are let go, bad ones fall back to flat, and nothing is
// kept that is not needed.

import test from "node:test";
import assert from "node:assert/strict";

import { createParallaxCache } from "../../src/features/video/studio/parallaxCache.ts";
import type {
  BuilderState,
  ParallaxBuilder,
  PreparedParallax,
} from "../../src/features/video/studio/parallaxLayers.ts";
import { buildTimeline } from "../../src/features/video/studio/timeline.ts";
import type { StudioProject, StudioScene } from "../../src/features/video/studio/types.ts";

function scene(id: string, seconds: number): StudioScene {
  return {
    id, imageUrl: `https://img/${id}.jpg`, seconds, motion: "still",
    transition: "cut", transitionSeconds: 1, caption: null, narration: null,
  };
}

function timelineOf(seconds: number[]) {
  const project: StudioProject = {
    version: 1, title: "t", aspectRatio: "16:9", quality: "draft",
    scenes: seconds.map((s, i) => scene(`s${i}`, s)),
    audio: { musicUrl: null, musicVolume: 0.5, narration: false, language: "en-US" },
  };
  return buildTimeline(project);
}

// A fake builder that needs `steps` steps and records the work done.
function fakeBuilder(index: number, steps: number, log: string[], failAt = -1): ParallaxBuilder<string> {
  let done = 0;
  let state: BuilderState = "working";
  return {
    totalSteps: steps,
    get state() { return state; },
    step() {
      if (state !== "working") return;
      log.push(`step ${index}`);
      done += 1;
      if (done === failAt) state = "failed";
      else if (done === steps) state = "done";
    },
    result: () => (state === "done" ? { width: 1, height: 1, layers: [`L${index}`] } : null),
  };
}

test("only the scenes on screen or about to start are worked on, one step per tick", () => {
  const log: string[] = [];
  const cache = createParallaxCache({
    timeline: timelineOf([5, 5, 5]),
    makeBuilder: (i) => fakeBuilder(i, 3, log),
  });
  cache.tick(0);
  cache.tick(0);
  cache.tick(0);
  assert.deepEqual(log, ["step 0", "step 0", "step 0"]);
  assert.deepEqual(Array.from(cache.ready().keys()), [0]);
  // Scene 1 starts at 5: it is not needed before 3 (look-ahead 2 s).
  cache.tick(2.9);
  assert.deepEqual(log.length, 3);
  cache.tick(3);
  assert.equal(log[3], "step 1");
});

test("the scene on screen comes before the one that is coming", () => {
  const log: string[] = [];
  const cache = createParallaxCache({
    timeline: timelineOf([5, 5]),
    makeBuilder: (i) => fakeBuilder(i, 2, log),
  });
  cache.tick(4);
  cache.tick(4);
  cache.tick(4);
  cache.tick(4);
  assert.deepEqual(log, ["step 0", "step 0", "step 1", "step 1"]);
});

test("a scene that is over is let go, the last one never is", () => {
  const released: string[] = [];
  const cache = createParallaxCache({
    timeline: timelineOf([2, 2]),
    makeBuilder: (i) => fakeBuilder(i, 1, []),
    release: (p: PreparedParallax<string>) => released.push(String(p.layers[0])),
  });
  cache.settle(0);
  assert.deepEqual(Array.from(cache.ready().keys()), [0, 1]);
  cache.tick(2);
  assert.deepEqual(released, ["L0"]);
  assert.deepEqual(Array.from(cache.ready().keys()), [1]);
  cache.tick(4);
  cache.tick(100);
  assert.deepEqual(released, ["L0"]);
  assert.deepEqual(Array.from(cache.ready().keys()), [1]);
});

test("a scene without a builder, or with a failing one, is flat and costs nothing again", () => {
  const log: string[] = [];
  let made = 0;
  const cache = createParallaxCache({
    timeline: timelineOf([5, 5, 5]),
    makeBuilder: (i) => {
      made += 1;
      if (i === 0) return null;
      return fakeBuilder(i, 4, log, 2);
    },
  });
  cache.settle(0);
  cache.settle(4);
  assert.equal(cache.ready().size, 0);
  // Scene 1 failed at its second step and is not tried again.
  assert.equal(log.filter((l) => l === "step 1").length, 2);
  cache.settle(4);
  assert.equal(log.filter((l) => l === "step 1").length, 2);
  assert.equal(made, 2);
});

test("a builder that throws is flat", () => {
  const cache = createParallaxCache({
    timeline: timelineOf([5]),
    makeBuilder: () => {
      throw new Error("no memory");
    },
  });
  cache.settle(0);
  assert.equal(cache.ready().size, 0);
});

test("settle finishes everything needed at that moment, including the look-ahead", () => {
  const cache = createParallaxCache({
    timeline: timelineOf([1, 1, 10]),
    makeBuilder: (i) => fakeBuilder(i, 5, []),
  });
  cache.settle(0);
  // Scenes 0 and 1 (start 1) and 2 (start 2, within 2 s) are all needed at 0.
  assert.deepEqual(Array.from(cache.ready().keys()), [0, 1, 2]);
});

test("settle stops even when a builder never finishes", () => {
  const stuck: ParallaxBuilder<string> = {
    totalSteps: 1,
    state: "working",
    step() {},
    result: () => null,
  };
  const cache = createParallaxCache({ timeline: timelineOf([5]), makeBuilder: () => stuck });
  cache.settle(0);
  assert.equal(cache.ready().size, 0);
});

test("ready() is the same object until something changes", () => {
  const cache = createParallaxCache({
    timeline: timelineOf([5, 5]),
    makeBuilder: (i) => fakeBuilder(i, 1, []),
  });
  cache.tick(0);
  const a = cache.ready();
  assert.equal(cache.ready(), a);
  cache.tick(4);
  assert.notEqual(cache.ready(), a);
});

test("several steps can be done in one tick", () => {
  const log: string[] = [];
  const cache = createParallaxCache({
    timeline: timelineOf([5]),
    makeBuilder: (i) => fakeBuilder(i, 4, log),
  });
  cache.tick(0, 3);
  assert.equal(log.length, 3);
  cache.tick(0, 0.2);
  assert.equal(log.length, 4); // at least one step
});

test("dispose lets go of everything, and a silly time changes nothing", () => {
  const released: string[] = [];
  const cache = createParallaxCache({
    timeline: timelineOf([2, 2]),
    makeBuilder: (i) => fakeBuilder(i, 1, []),
    release: (p: PreparedParallax<string>) => released.push(String(p.layers[0])),
  });
  cache.settle(0);
  cache.tick(Number.NaN);
  cache.settle(Number.POSITIVE_INFINITY);
  assert.equal(cache.ready().size, 2);
  cache.dispose();
  assert.deepEqual(released.sort(), ["L0", "L1"]);
  assert.equal(cache.ready().size, 0);
});

test("an empty film has nothing to do", () => {
  const cache = createParallaxCache({
    timeline: timelineOf([]),
    makeBuilder: () => null,
  });
  cache.tick(0);
  cache.settle(0);
  assert.equal(cache.ready().size, 0);
});
