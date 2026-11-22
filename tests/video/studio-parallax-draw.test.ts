// tests/video/studio-parallax-draw.test.ts
// Drawing a 3D photo: layers far to near, near layers move more, and the edge of a
// layer never shows inside the frame.

import test from "node:test";
import assert from "node:assert/strict";

import {
  drawParallax,
  parallaxPlacements,
} from "../../src/features/video/studio/parallaxDraw.ts";
import type { CanvasLike } from "../../src/features/video/studio/renderFrame.ts";
import { STUDIO_MOTIONS } from "../../src/features/video/studio/types.ts";

const SIZE = { width: 200, height: 100 };

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

function fakeCanvas(): { ctx: CanvasLike; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    direction: "inherit",
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    fillRect: record("fillRect"),
    fillText: record("fillText"),
    measureText: () => ({ width: 0 }),
    drawImage: record("drawImage"),
  } as unknown as CanvasLike;
  return { ctx, calls };
}

test("every layer is drawn once, far to near, each inside save and restore", () => {
  const { ctx, calls } = fakeCanvas();
  const layers = ["a", "b", "c", "d"];
  drawParallax(ctx, SIZE, { width: 200, height: 100, layers }, "pan-right", 0.5);
  const drawn = calls.filter((c) => c.name === "drawImage").map((c) => c.args[0]);
  assert.deepEqual(drawn, layers);
  assert.equal(calls.filter((c) => c.name === "save").length, 4);
  assert.equal(calls.filter((c) => c.name === "restore").length, 4);
});

test("a layer is drawn as the whole picture over the whole frame, centred on (0, 0)", () => {
  const { ctx, calls } = fakeCanvas();
  drawParallax(ctx, SIZE, { width: 300, height: 150, layers: ["x", "y"] }, "none" as never, 0);
  const draw = calls.find((c) => c.name === "drawImage")!;
  assert.deepEqual(draw.args.slice(1), [0, 0, 300, 150, -100, -50, 200, 100]);
});

test("no layers draws nothing", () => {
  const { ctx, calls } = fakeCanvas();
  drawParallax(ctx, SIZE, { width: 10, height: 10, layers: [] }, "zoom-in", 0.5);
  assert.equal(calls.length, 0);
});

test("when the camera moves sideways, near layers shift more than far ones", () => {
  const start = parallaxPlacements("pan-right", 0, 8);
  assert.equal(start.length, 8);
  const spread = (list: ReturnType<typeof parallaxPlacements>) =>
    Math.abs(list[7].dx - list[0].dx);
  assert.ok(spread(start) > 0);
  // Near and far move against each other.
  assert.ok(start[7].dx * start[0].dx < 0);
});

test("zoom-in grows every layer over time, near ones faster", () => {
  const a = parallaxPlacements("zoom-in", 0, 8);
  const b = parallaxPlacements("zoom-in", 1, 8);
  for (let i = 0; i < 8; i += 1) assert.ok(b[i].scale > a[i].scale);
  assert.ok(b[7].scale - a[7].scale > b[0].scale - a[0].scale);
});

test("the edge of a layer never shows inside the frame, for every move and moment", () => {
  for (const motion of STUDIO_MOTIONS) {
    for (let step = 0; step <= 20; step += 1) {
      const list = parallaxPlacements(motion, step / 20, 8);
      for (const place of list) {
        // Half of the layer is scale / 2 of the frame; the shift must fit in the extra.
        assert.ok(place.scale / 2 - Math.abs(place.dx) >= 0.5 - 1e-9, `${motion} dx`);
        assert.ok(place.scale / 2 - Math.abs(place.dy) >= 0.5 - 1e-9, `${motion} dy`);
      }
    }
  }
});

test("the same input always gives the same placements", () => {
  assert.deepEqual(parallaxPlacements("pan-left", 0.37, 6), parallaxPlacements("pan-left", 0.37, 6));
});
