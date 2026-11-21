// tests/video/studio-motion.test.ts
// The studio's camera: the shown part of a picture always fills the frame, has
// the frame's shape, stays inside the picture, and moves the right way for every
// kind of motion, for wide, tall and square pictures. No canvas, no browser.

import test from "node:test";
import assert from "node:assert/strict";

import { MOTION_ZOOM, sourceRect } from "../../src/features/video/studio/motion.ts";
import { STUDIO_MOTIONS, type StudioMotion } from "../../src/features/video/studio/types.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test("a picture with the frame's shape is shown whole and centred when still", () => {
  assert.deepEqual(sourceRect("still", 0.5, 1600, 900, 640, 360), { x: 0, y: 0, width: 1600, height: 900 });
});

test("a wide picture in a tall frame is cropped at the sides, a tall one in a wide frame at the top and bottom", () => {
  const wide = sourceRect("still", 0, 1600, 900, 360, 640)!;
  assert.ok(close(wide.height, 900) && close(wide.width, 900 * 360 / 640) && close(wide.x, (1600 - wide.width) / 2) && wide.y === 0);
  const tall = sourceRect("still", 0, 900, 1600, 640, 360)!;
  assert.ok(close(tall.width, 900) && close(tall.height, 900 * 360 / 640) && close(tall.y, (1600 - tall.height) / 2) && tall.x === 0);
});

test("zoom-in starts whole and ends closer, zoom-out is the opposite", () => {
  const start = sourceRect("zoom-in", 0, 1600, 900, 640, 360)!;
  const end = sourceRect("zoom-in", 1, 1600, 900, 640, 360)!;
  assert.ok(close(start.width, 1600) && close(end.width, 1600 / MOTION_ZOOM));
  assert.ok(close(end.x, (1600 - end.width) / 2) && close(end.y, (900 - end.height) / 2));
  const back = sourceRect("zoom-out", 0, 1600, 900, 640, 360)!;
  assert.ok(close(back.width, 1600 / MOTION_ZOOM));
  assert.ok(close(sourceRect("zoom-out", 1, 1600, 900, 640, 360)!.width, 1600));
});

test("pans move along one direction only and keep the size", () => {
  const args = [1600, 900, 640, 360] as const;
  const right0 = sourceRect("pan-right", 0, ...args)!;
  const right1 = sourceRect("pan-right", 1, ...args)!;
  assert.equal(right0.x, 0);
  assert.ok(close(right1.x + right1.width, 1600));
  assert.ok(close(right0.width, right1.width) && close(right0.y, right1.y));
  const left0 = sourceRect("pan-left", 0, ...args)!;
  assert.ok(close(left0.x + left0.width, 1600));
  assert.equal(sourceRect("pan-left", 1, ...args)!.x, 0);
  assert.equal(sourceRect("pan-down", 0, ...args)!.y, 0);
  assert.ok(close(sourceRect("pan-down", 1, ...args)!.y + sourceRect("pan-down", 1, ...args)!.height, 900));
  assert.ok(close(sourceRect("pan-up", 0, ...args)!.y + sourceRect("pan-up", 0, ...args)!.height, 900));
  assert.equal(sourceRect("pan-up", 1, ...args)!.y, 0);
});

test("the camera starts and ends softly", () => {
  const early = sourceRect("pan-right", 0.1, 1600, 900, 640, 360)!;
  const late = sourceRect("pan-right", 0.9, 1600, 900, 640, 360)!;
  const full = sourceRect("pan-right", 1, 1600, 900, 640, 360)!;
  assert.ok(early.x < full.x * 0.1);
  assert.ok(late.x > full.x * 0.9);
});

test("for every motion, picture shape and moment the shown part fits the frame and the picture", () => {
  const pictures = [[1600, 900], [900, 1600], [1000, 1000], [4000, 300], [300, 4000], [1, 1]];
  const frames = [[640, 360], [360, 640], [720, 720]];
  for (const motion of STUDIO_MOTIONS) {
    for (const [iw, ih] of pictures) {
      for (const [fw, fh] of frames) {
        for (let i = 0; i <= 20; i += 1) {
          const r = sourceRect(motion as StudioMotion, i / 20, iw, ih, fw, fh)!;
          assert.ok(r.width > 0 && r.height > 0);
          assert.ok(close(r.width / r.height, fw / fh), `${motion} ${iw}x${ih} -> ${fw}x${fh}`);
          assert.ok(r.x >= -1e-6 && r.y >= -1e-6);
          assert.ok(r.x + r.width <= iw + 1e-6 && r.y + r.height <= ih + 1e-6);
        }
      }
    }
  }
});

test("progress outside 0..1 or not a number is brought to the nearest moment", () => {
  const args = [1600, 900, 640, 360] as const;
  assert.deepEqual(sourceRect("zoom-in", -3, ...args), sourceRect("zoom-in", 0, ...args));
  assert.deepEqual(sourceRect("zoom-in", 9, ...args), sourceRect("zoom-in", 1, ...args));
  assert.deepEqual(sourceRect("zoom-in", Number.NaN, ...args), sourceRect("zoom-in", 0, ...args));
});

test("sizes that cannot be used give nothing to draw", () => {
  for (const bad of [0, -5, Number.NaN, Infinity]) {
    assert.equal(sourceRect("still", 0, bad, 900, 640, 360), null);
    assert.equal(sourceRect("still", 0, 1600, bad, 640, 360), null);
    assert.equal(sourceRect("still", 0, 1600, 900, bad, 360), null);
    assert.equal(sourceRect("still", 0, 1600, 900, 640, bad), null);
  }
});
