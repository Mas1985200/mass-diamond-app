// tests/video/studio-parallax.test.ts
// The numbers of the "3D photo" effect: the camera for every move, where each layer
// is drawn (near layers shift more, the middle stays still, edges never show), and
// which pixels belong to which layer, with a soft edge and a safe depth map.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PARALLAX_DOLLY,
  PARALLAX_LAYERS,
  PARALLAX_STRENGTH,
  cameraAt,
  layerAlpha,
  layerLevel,
  layerMask,
  normalizeDepth,
  overscan,
  placeLayer,
} from "../../src/features/video/studio/parallax.ts";
import { STUDIO_MOTIONS } from "../../src/features/video/studio/types.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("zoom moves bring the camera closer or away and keep it centred", () => {
  assert.deepEqual(cameraAt("zoom-in", 0), { x: 0, y: 0, dolly: 0 });
  assert.ok(close(cameraAt("zoom-in", 1).dolly, PARALLAX_DOLLY));
  assert.ok(close(cameraAt("zoom-out", 0).dolly, PARALLAX_DOLLY));
  assert.deepEqual(cameraAt("zoom-out", 1), { x: 0, y: 0, dolly: 0 });
});

test("pans move the camera across its whole range, one way only", () => {
  assert.equal(cameraAt("pan-right", 0).x, -1);
  assert.equal(cameraAt("pan-right", 1).x, 1);
  assert.equal(cameraAt("pan-left", 0).x, 1);
  assert.equal(cameraAt("pan-left", 1).x, -1);
  assert.equal(cameraAt("pan-down", 0).y, -1);
  assert.equal(cameraAt("pan-down", 1).y, 1);
  assert.equal(cameraAt("pan-up", 0).y, 1);
  assert.equal(cameraAt("pan-up", 1).y, -1);
  assert.deepEqual(cameraAt("still", 0.5), { x: 0, y: 0, dolly: 0 });
  assert.ok(close(cameraAt("pan-right", 0.5).x, 0));
});

test("the camera starts and ends softly and bad progress is brought into range", () => {
  assert.ok(cameraAt("pan-right", 0.1).x < -0.9 + 0.1);
  assert.deepEqual(cameraAt("zoom-in", -5), cameraAt("zoom-in", 0));
  assert.deepEqual(cameraAt("zoom-in", 9), cameraAt("zoom-in", 1));
  assert.deepEqual(cameraAt("zoom-in", Number.NaN), cameraAt("zoom-in", 0));
});

test("near layers shift against the camera more than far ones, and the middle stays still", () => {
  const camera = { x: 1, y: 0, dolly: 0 };
  const near = placeLayer(1, camera);
  const far = placeLayer(0, camera);
  const middle = placeLayer(0.5, camera);
  assert.ok(close(near.dx, -PARALLAX_STRENGTH));
  assert.ok(close(far.dx, PARALLAX_STRENGTH));
  assert.ok(close(middle.dx, 0));
  assert.equal(near.dy === 0 || Object.is(near.dy, -0), true);
  const up = placeLayer(1, { x: 0, y: 1, dolly: 0 });
  assert.ok(close(up.dy, -PARALLAX_STRENGTH));
});

test("near layers grow faster than far ones when the camera comes closer", () => {
  const camera = { x: 0, y: 0, dolly: PARALLAX_DOLLY };
  assert.ok(placeLayer(1, camera).scale > placeLayer(0.5, camera).scale);
  assert.ok(placeLayer(0.5, camera).scale > placeLayer(0, camera).scale);
  assert.ok(close(placeLayer(0, { x: 0, y: 0, dolly: 0 }).scale, overscan()));
});

test("a layer always covers the whole frame, for every move, moment, depth and strength", () => {
  for (const strength of [0.01, PARALLAX_STRENGTH, 0.08]) {
    for (const motion of STUDIO_MOTIONS) {
      for (let i = 0; i <= 20; i += 1) {
        const camera = cameraAt(motion, i / 20);
        for (let layer = 0; layer < PARALLAX_LAYERS; layer += 1) {
          const place = placeLayer(layerLevel(layer, PARALLAX_LAYERS), camera, strength);
          const margin = (place.scale - 1) / 2;
          assert.ok(margin + 1e-9 >= Math.abs(place.dx), `${motion} x ${layer}`);
          assert.ok(margin + 1e-9 >= Math.abs(place.dy), `${motion} y ${layer}`);
        }
      }
    }
  }
});

test("strange input to the placing is brought into range", () => {
  const a = placeLayer(Number.NaN, { x: Number.NaN, y: 9, dolly: -3 });
  assert.ok(Number.isFinite(a.dx) && Number.isFinite(a.dy) && Number.isFinite(a.scale));
  assert.ok(a.scale >= 1);
  assert.deepEqual(placeLayer(7, { x: 0, y: 0, dolly: 0 }), placeLayer(1, { x: 0, y: 0, dolly: 0 }));
});

test("the level of a layer is the middle of its band of depths", () => {
  assert.equal(layerLevel(0, 8), 1 / 16);
  assert.equal(layerLevel(7, 8), 15 / 16);
  assert.equal(layerLevel(0, 0), 0.5);
  assert.equal(layerLevel(99, 4), 1);
});

test("the farthest layer holds every pixel and nearer layers hold the pixels at their depth or nearer", () => {
  for (const depth of [0, 10, 128, 255]) assert.equal(layerAlpha(depth, 0, 8), 255);
  // layer 4 of 8 starts at depth 0.5 (127.5)
  assert.equal(layerAlpha(255, 4, 8), 255);
  assert.equal(layerAlpha(200, 4, 8), 255);
  assert.equal(layerAlpha(10, 4, 8), 0);
  assert.equal(layerAlpha(0, 7, 8), 0);
  assert.equal(layerAlpha(255, 7, 8), 255);
});

test("a layer's edge is soft: it grows with depth and is half at the edge", () => {
  const values = [100, 115, 127, 128, 140, 160].map((d) => layerAlpha(d, 4, 8));
  assert.ok(values.every((v, i) => i === 0 || v >= values[i - 1]));
  assert.ok(Math.abs(layerAlpha(127.5, 4, 8) - 128) <= 2);
  assert.equal(layerAlpha(128, 4, 8, 0), 255);
  assert.equal(layerAlpha(127, 4, 8, 0), 0);
});

test("strange depths are kept in range", () => {
  assert.equal(layerAlpha(Number.NaN, 3, 8), 0);
  assert.equal(layerAlpha(-50, 3, 8), 0);
  assert.equal(layerAlpha(9999, 3, 8), 255);
});

test("the mask of a layer has one value per pixel and nests: a nearer layer never holds more", () => {
  const depth = Uint8Array.from({ length: 256 }, (_, i) => i);
  const masks = Array.from({ length: PARALLAX_LAYERS }, (_, layer) => layerMask(depth, layer, PARALLAX_LAYERS));
  assert.ok(masks.every((m) => m.length === 256));
  for (let layer = 1; layer < masks.length; layer += 1) {
    for (let i = 0; i < 256; i += 1) assert.ok(masks[layer][i] <= masks[layer - 1][i], `layer ${layer} pixel ${i}`);
  }
  assert.ok(masks[0].every((v) => v === 255));
  assert.equal(masks[7][0], 0);
  assert.equal(masks[7][255], 255);
  assert.equal(layerMask([], 2, 8).length, 0);
});

test("a depth map is stretched to the full range, and a flat one becomes the middle", () => {
  assert.deepEqual([...normalizeDepth([50, 100, 150])], [0, 128, 255]);
  assert.deepEqual([...normalizeDepth([7, 7, 7])], [128, 128, 128]);
  assert.deepEqual([...normalizeDepth([])], []);
  assert.deepEqual([...normalizeDepth([0, 255])], [0, 255]);
  assert.deepEqual([...normalizeDepth([10, Number.NaN, 20])], [0, 0, 255]);
  assert.deepEqual([...normalizeDepth([Number.NaN, Number.NaN])], [128, 128]);
});
