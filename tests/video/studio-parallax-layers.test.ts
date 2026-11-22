// tests/video/studio-parallax-layers.test.ts
// Cutting a photo into layers: the part of the photo the frame shows, the depth map
// laid over it, and the pixels each layer keeps.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_LAYERS,
  MIN_LAYERS,
  coverRect,
  depthForFrame,
  prepareParallax,
  type PixelBuffer,
} from "../../src/features/video/studio/parallaxLayers.ts";
import type { DepthMap } from "../../src/features/video/studio/depthModel.ts";

function solid(width: number, height: number, alpha = 255): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[4 * i] = 10;
    data[4 * i + 1] = 20;
    data[4 * i + 2] = 30;
    data[4 * i + 3] = alpha;
  }
  return { width, height, data };
}

test("coverRect takes the middle of a wide or a tall photo", () => {
  assert.deepEqual(coverRect(400, 100, 100, 100), { x: 150, y: 0, width: 100, height: 100 });
  assert.deepEqual(coverRect(100, 400, 100, 100), { x: 0, y: 150, width: 100, height: 100 });
  assert.deepEqual(coverRect(200, 100, 200, 100), { x: 0, y: 0, width: 200, height: 100 });
});

test("coverRect refuses silly sizes", () => {
  assert.equal(coverRect(0, 10, 10, 10), null);
  assert.equal(coverRect(10, 10, Number.NaN, 10), null);
  assert.equal(coverRect(10, -1, 10, 10), null);
});

test("depth is laid over the part the frame shows", () => {
  // Photo 4x2, depth 4x2: left half 0, right half 200. The frame is square, so it
  // shows the middle 2x2 of the photo: half dark, half bright.
  const depth: DepthMap = {
    width: 4,
    height: 2,
    data: Uint8Array.from([0, 0, 200, 200, 0, 0, 200, 200]),
  };
  const rect = coverRect(4, 2, 2, 2)!;
  const out = depthForFrame(depth, rect, 4, 2, 2, 2);
  assert.equal(out.length, 4);
  assert.ok(out[0] < out[1]);
  assert.equal(out[0], out[2]);
  assert.equal(out[1], out[3]);
});

test("depth of a flat map stays flat at any frame size", () => {
  const depth: DepthMap = { width: 3, height: 3, data: new Uint8Array(9).fill(77) };
  const rect = coverRect(30, 20, 7, 5)!;
  const out = depthForFrame(depth, rect, 30, 20, 7, 5);
  assert.equal(out.length, 35);
  assert.ok(out.every((v) => v === 77));
});

test("the farthest layer is the whole photo; nearer layers keep only near pixels", () => {
  // Frame 2x1: left pixel far (0), right pixel near (255).
  const depth: DepthMap = { width: 2, height: 2, data: Uint8Array.from([0, 255, 0, 255]) };
  const result = prepareParallax(
    { width: 2, height: 2 },
    depth,
    { width: 2, height: 1 },
    { readPixels: () => solid(2, 1), makeLayer: (p) => p },
    { layers: 4, feather: 0 },
  );
  assert.ok(result);
  assert.equal(result.layers.length, 4);
  const alphas = result.layers.map((l) => [l.data[3], l.data[7]]);
  assert.deepEqual(alphas[0], [255, 255]);
  for (const a of alphas.slice(1)) {
    assert.equal(a[1], 255); // the near pixel is in every layer
    assert.equal(a[0], 0); // the far pixel only in the farthest
  }
  // The colour is never changed.
  assert.deepEqual(Array.from(result.layers[2].data.slice(0, 3)), [10, 20, 30]);
});

test("a nearer pixel is in more layers than a farther one", () => {
  const depth: DepthMap = {
    width: 2,
    height: 2,
    data: Uint8Array.from([0, 128, 0, 128]),
  };
  const result = prepareParallax(
    { width: 2, height: 2 },
    depth,
    { width: 2, height: 1 },
    { readPixels: () => solid(2, 1), makeLayer: (p) => p },
    { layers: 8, feather: 0 },
  )!;
  const inLayers = (px: number) =>
    result.layers.filter((l) => l.data[4 * px + 3] > 0).length;
  assert.ok(inLayers(1) > inLayers(0));
  assert.equal(inLayers(0), 1);
});

test("the original alpha is kept, and the source pixels are not changed", () => {
  const source = solid(2, 1, 100);
  const depth: DepthMap = { width: 2, height: 2, data: new Uint8Array(4).fill(255) };
  const result = prepareParallax(
    { width: 2, height: 2 },
    depth,
    { width: 2, height: 1 },
    { readPixels: () => source, makeLayer: (p) => p },
    { layers: 3, feather: 0 },
  )!;
  assert.equal(result.layers[2].data[3], 100);
  assert.equal(source.data[3], 100);
});

test("the number of layers is kept within limits", () => {
  const depth: DepthMap = { width: 2, height: 2, data: new Uint8Array(4) };
  const run = (layers: number) =>
    prepareParallax(
      { width: 2, height: 2 },
      depth,
      { width: 2, height: 2 },
      { readPixels: () => solid(2, 2), makeLayer: () => 1 },
      { layers },
    )!.layers.length;
  assert.equal(run(1), MIN_LAYERS);
  assert.equal(run(999), MAX_LAYERS);
  assert.equal(run(Number.NaN), 8);
});

test("bad input gives null, so the flat photo is used", () => {
  const depth: DepthMap = { width: 2, height: 2, data: new Uint8Array(4) };
  const good = { readPixels: () => solid(2, 2), makeLayer: (p: PixelBuffer) => p };
  const img = { width: 2, height: 2 };
  const frame = { width: 2, height: 2 };
  assert.equal(prepareParallax({ width: 0, height: 2 }, depth, frame, good), null);
  assert.equal(prepareParallax(img, { width: 2, height: 2, data: new Uint8Array(3) }, frame, good), null);
  assert.equal(prepareParallax(img, depth, frame, { ...good, readPixels: () => null }), null);
  assert.equal(prepareParallax(img, depth, frame, { ...good, readPixels: () => solid(3, 3) }), null);
  assert.equal(
    prepareParallax(img, depth, frame, {
      ...good,
      readPixels: () => ({ width: 2, height: 2, data: new Uint8ClampedArray(5) }),
    }),
    null,
  );
});
