// tests/video/studio-types.test.ts
// The studio's basic numbers: every shape and quality has an even size with the
// right shape, bigger qualities are bigger, and the limits agree with the AI
// video engine (up to 10 minutes). No browser, no network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  STUDIO_ASPECTS,
  STUDIO_FPS,
  STUDIO_LIMITS,
  STUDIO_MOTIONS,
  STUDIO_QUALITIES,
  STUDIO_TRANSITIONS,
  studioSize,
} from "../../src/features/video/studio/types.ts";

test("every shape and quality has an even size with the right shape", () => {
  for (const aspect of STUDIO_ASPECTS) {
    const [w, h] = aspect.split(":").map(Number);
    for (const quality of STUDIO_QUALITIES) {
      const size = studioSize(aspect, quality);
      assert.equal(size.width % 2, 0, `${aspect} ${quality} width`);
      assert.equal(size.height % 2, 0, `${aspect} ${quality} height`);
      assert.equal(size.width * h, size.height * w, `${aspect} ${quality} shape`);
    }
  }
});

test("a better quality is always a bigger picture", () => {
  for (const aspect of STUDIO_ASPECTS) {
    const area = (q: "draft" | "standard" | "high") => {
      const s = studioSize(aspect, q);
      return s.width * s.height;
    };
    assert.ok(area("draft") < area("standard"));
    assert.ok(area("standard") < area("high"));
  }
});

test("the lists have no repeats and the numbers make sense", () => {
  for (const list of [STUDIO_ASPECTS, STUDIO_QUALITIES, STUDIO_MOTIONS, STUDIO_TRANSITIONS]) {
    assert.equal(new Set(list).size, list.length);
  }
  assert.ok(Number.isInteger(STUDIO_FPS) && STUDIO_FPS >= 24 && STUDIO_FPS <= 60);
  assert.equal(STUDIO_LIMITS.maxSeconds, 600);
  assert.ok(STUDIO_LIMITS.minSceneSeconds < STUDIO_LIMITS.maxSceneSeconds);
  assert.ok(STUDIO_LIMITS.maxScenes * STUDIO_LIMITS.minSceneSeconds >= STUDIO_LIMITS.maxSeconds / 3);
  assert.ok(STUDIO_LIMITS.maxTransitionSeconds < STUDIO_LIMITS.maxSceneSeconds);
});
