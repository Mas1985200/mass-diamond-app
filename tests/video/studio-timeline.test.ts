// tests/video/studio-timeline.test.ts
// The studio's clock: scene start and end times with overlapping changes, the
// limits on a change, what is drawn at any moment for every kind of change, the
// moments before the start and after the end, and the narration times. No canvas,
// no browser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTimeline,
  frameTime,
  layersAt,
  narrationCues,
  smoothstep,
  totalFrames,
} from "../../src/features/video/studio/timeline.ts";
import type {
  StudioProject,
  StudioScene,
  StudioTransition,
} from "../../src/features/video/studio/types.ts";

function scene(id: string, seconds: number, over: Partial<StudioScene> = {}): StudioScene {
  return {
    id, imageUrl: `https://img/${id}.jpg`, seconds, motion: "zoom-in",
    transition: "fade", transitionSeconds: 1, caption: null, narration: null,
    ...over,
  };
}

function project(scenes: StudioScene[]): StudioProject {
  return {
    version: 1, title: "t", aspectRatio: "16:9", quality: "standard", scenes,
    audio: { musicUrl: null, musicVolume: 0.5, narration: true, language: "fa-IR" },
  };
}

test("an empty project has no time and draws nothing", () => {
  const timeline = buildTimeline(project([]));
  assert.deepEqual(timeline, { scenes: [], totalSeconds: 0 });
  assert.deepEqual(layersAt(timeline, 3), []);
  assert.equal(totalFrames(0), 0);
});

test("scenes with cuts follow each other with no overlap", () => {
  const timeline = buildTimeline(project([
    scene("a", 4, { transition: "cut" }), scene("b", 6, { transition: "cut" }), scene("c", 5),
  ]));
  assert.deepEqual(timeline.scenes.map((s) => [s.start, s.end]), [[0, 4], [4, 10], [10, 15]]);
  assert.equal(timeline.totalSeconds, 15);
});

test("a change makes the next scene start earlier and the video shorter by the overlap", () => {
  const timeline = buildTimeline(project([
    scene("a", 6, { transition: "fade", transitionSeconds: 2 }),
    scene("b", 6, { transition: "slide-left", transitionSeconds: 1 }),
    scene("c", 6),
  ]));
  assert.deepEqual(timeline.scenes.map((s) => [s.start, s.end]), [[0, 6], [4, 10], [9, 15]]);
  assert.deepEqual(timeline.scenes.map((s) => [s.overlapIn, s.overlapOut]), [[0, 2], [2, 1], [1, 0]]);
  assert.equal(timeline.totalSeconds, 15);
});

test("a change is never longer than the limit or half of the shorter scene", () => {
  const long = buildTimeline(project([scene("a", 20, { transitionSeconds: 99 }), scene("b", 20)]));
  assert.equal(long.scenes[0].overlapOut, 3);
  const short = buildTimeline(project([scene("a", 20, { transitionSeconds: 3 }), scene("b", 2)]));
  assert.equal(short.scenes[0].overlapOut, 1);
  const shortFirst = buildTimeline(project([scene("a", 2, { transitionSeconds: 3 }), scene("b", 20)]));
  assert.equal(shortFirst.scenes[0].overlapOut, 1);
  const odd = buildTimeline(project([
    scene("a", 5, { transitionSeconds: Number.NaN }), scene("b", 5, { transitionSeconds: -4 }), scene("c", 5),
  ]));
  assert.deepEqual(odd.scenes.map((s) => s.overlapOut), [0, 0, 0]);
});

test("a scene is never in two changes at once, even when all are as long as allowed", () => {
  const scenes = [1, 1, 1, 1].map((n, i) => scene(`s${i}`, n, { transitionSeconds: 3 }));
  const timeline = buildTimeline(project(scenes));
  for (let t = 0; t <= timeline.totalSeconds; t += 0.05) {
    assert.ok(layersAt(timeline, t).length <= 2, `at ${t}`);
  }
  for (const planned of timeline.scenes) {
    assert.ok(planned.overlapIn + planned.overlapOut <= planned.seconds + 1e-9);
  }
});

test("strange scene lengths are brought into the allowed range", () => {
  const timeline = buildTimeline(project([
    scene("a", Number.NaN, { transition: "cut" }), scene("b", 0, { transition: "cut" }), scene("c", 9999),
  ]));
  assert.deepEqual(timeline.scenes.map((s) => s.seconds), [1, 1, 60]);
});

test("in the middle of a scene one solid picture is drawn and its progress follows the time", () => {
  const timeline = buildTimeline(project([scene("a", 10, { transition: "cut" }), scene("b", 10)]));
  assert.deepEqual(layersAt(timeline, 2.5), [
    { index: 0, sceneProgress: 0.25, alpha: 1, offsetX: 0, scale: 1 },
  ]);
  assert.deepEqual(layersAt(timeline, 15), [
    { index: 1, sceneProgress: 0.5, alpha: 1, offsetX: 0, scale: 1 },
  ]);
});

function midChange(transition: StudioTransition) {
  // a: 0-6, b: 4-10 (overlap 2 seconds, from 4 to 6).
  const timeline = buildTimeline(project([
    scene("a", 6, { transition, transitionSeconds: 2 }), scene("b", 6),
  ]));
  return { timeline, at: (t: number) => layersAt(timeline, t) };
}

test("fade: the next picture appears over the one that stays", () => {
  const { at } = midChange("fade");
  const start = at(4);
  assert.deepEqual(start.map((l) => [l.index, l.alpha]), [[0, 1], [1, 0]]);
  const middle = at(5);
  assert.deepEqual(middle.map((l) => [l.index, l.alpha]), [[0, 1], [1, 0.5]]);
  const almost = at(5.999);
  assert.ok(almost[1].alpha > 0.999);
});

test("slide-left: the new picture comes from the right while the old one leaves to the left", () => {
  const { at } = midChange("slide-left");
  assert.deepEqual(at(4).map((l) => [l.index, l.offsetX]), [[0, -0], [1, 1]]);
  const middle = at(5);
  assert.deepEqual(middle.map((l) => [l.index, l.offsetX]), [[0, -0.5], [1, 0.5]]);
  assert.ok(middle.every((l) => l.alpha === 1 && l.scale === 1));
});

test("slide-right is the mirror of slide-left", () => {
  const { at } = midChange("slide-right");
  assert.deepEqual(at(5).map((l) => [l.index, l.offsetX]), [[0, 0.5], [1, -0.5]]);
});

test("zoom: the old picture grows and fades away over the new one", () => {
  const { at } = midChange("zoom");
  const middle = at(5);
  assert.deepEqual(middle.map((l) => l.index), [1, 0]);
  assert.deepEqual([middle[0].alpha, middle[0].scale], [1, 1]);
  assert.equal(middle[1].alpha, 0.5);
  assert.ok(Math.abs(middle[1].scale - 1.15) < 1e-9);
});

test("a change starts and ends softly", () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
  assert.ok(smoothstep(0.1) < 0.1);
  assert.ok(smoothstep(0.9) > 0.9);
  assert.equal(smoothstep(-5), 0);
  assert.equal(smoothstep(5), 1);
});

test("before the start and after the end are the first and the last moments", () => {
  const timeline = buildTimeline(project([scene("a", 4, { transition: "cut" }), scene("b", 4)]));
  assert.deepEqual(layersAt(timeline, -10), layersAt(timeline, 0));
  assert.deepEqual(layersAt(timeline, Number.NaN), layersAt(timeline, 0));
  const end = layersAt(timeline, 8);
  assert.deepEqual(end, [{ index: 1, sceneProgress: 1, alpha: 1, offsetX: 0, scale: 1 }]);
  assert.deepEqual(layersAt(timeline, 999), end);
  assert.deepEqual(layersAt(timeline, Infinity), layersAt(timeline, 0));
});

test("every moment of a long film draws one or two valid layers", () => {
  const scenes = Array.from({ length: 100 }, (_, i) =>
    scene(`s${i}`, 6, { transition: (["fade", "slide-left", "slide-right", "zoom", "cut"] as const)[i % 5], transitionSeconds: 1 }));
  const timeline = buildTimeline(project(scenes));
  assert.ok(timeline.totalSeconds > 500 && timeline.totalSeconds <= 600);
  for (let frame = 0; frame < totalFrames(timeline.totalSeconds); frame += 7) {
    const layers = layersAt(timeline, frameTime(frame));
    assert.ok(layers.length === 1 || layers.length === 2);
    for (const layer of layers) {
      assert.ok(layer.sceneProgress >= 0 && layer.sceneProgress <= 1);
      assert.ok(layer.alpha >= 0 && layer.alpha <= 1);
      assert.ok(layer.scale > 0 && Math.abs(layer.offsetX) <= 1);
      assert.ok(layer.index >= 0 && layer.index < 100);
    }
  }
});

test("frames: the count rounds up and a frame has its moment", () => {
  assert.equal(totalFrames(10, 30), 300);
  assert.equal(totalFrames(10.01, 30), 301);
  assert.equal(totalFrames(0.001, 30), 1);
  assert.equal(totalFrames(-1, 30), 0);
  assert.equal(totalFrames(10, 0), 0);
  assert.equal(frameTime(30, 30), 1);
  assert.equal(frameTime(-5, 30), 0);
  assert.equal(frameTime(5, 0), 0);
});

test("the narration starts with its scene, and empty narration is skipped", () => {
  const timeline = buildTimeline(project([
    scene("a", 6, { narration: "  سلام  ", transitionSeconds: 2 }),
    scene("b", 6, { narration: "   " }),
    scene("c", 6, { narration: null }),
    scene("d", 6, { narration: "end" }),
  ]));
  assert.deepEqual(narrationCues(timeline), [
    { index: 0, start: 0, text: "سلام" },
    { index: 3, start: timeline.scenes[3].start, text: "end" },
  ]);
});
