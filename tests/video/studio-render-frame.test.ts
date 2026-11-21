// tests/video/studio-render-frame.test.ts
// Drawing one frame with a small fake canvas that writes down every call: the
// background, the camera part of each picture, the transparency and shift of a
// change, captions (wrapping, fading), pictures that are not loaded yet, and that
// every save has its restore. No browser.

import test from "node:test";
import assert from "node:assert/strict";

import { sourceRect } from "../../src/features/video/studio/motion.ts";
import {
  CAPTION_FADE_SECONDS,
  renderFrame,
  wrapCaption,
  type CanvasLike,
  type ImageLike,
} from "../../src/features/video/studio/renderFrame.ts";
import { buildTimeline } from "../../src/features/video/studio/timeline.ts";
import type { StudioProject, StudioScene } from "../../src/features/video/studio/types.ts";

type Call = { name: string; args: unknown[]; alpha: number };

class FakeCanvas implements CanvasLike {
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  direction: CanvasDirection = "ltr";
  calls: Call[] = [];
  depth = 0;
  private stack: number[] = [];

  private log(name: string, args: unknown[]) {
    this.calls.push({ name, args, alpha: this.globalAlpha });
  }
  save() { this.depth++; this.stack.push(this.globalAlpha); this.log("save", []); }
  restore() { this.depth--; this.globalAlpha = this.stack.pop() ?? 1; this.log("restore", []); }
  translate(x: number, y: number) { this.log("translate", [x, y]); }
  scale(x: number, y: number) { this.log("scale", [x, y]); }
  fillRect(x: number, y: number, w: number, h: number) { this.log("fillRect", [x, y, w, h, this.fillStyle]); }
  fillText(text: string, x: number, y: number) { this.log("fillText", [text, x, y]); }
  measureText(text: string) { return { width: text.length * 10 }; }
  drawImage(_i: never, ...rest: number[]) { this.log("drawImage", rest); }
  of(name: string) { return this.calls.filter((c) => c.name === name); }
}

function scene(id: string, seconds: number, over: Partial<StudioScene> = {}): StudioScene {
  return {
    id, imageUrl: `https://img/${id}.jpg`, seconds, motion: "still",
    transition: "fade", transitionSeconds: 2, caption: null, narration: null, ...over,
  };
}

function timelineOf(scenes: StudioScene[]) {
  const project: StudioProject = {
    version: 1, title: "t", aspectRatio: "16:9", quality: "draft", scenes,
    audio: { musicUrl: null, musicVolume: 0.5, narration: false, language: "en-US" },
  };
  return buildTimeline(project);
}

const SIZE = { width: 640, height: 360 };
const IMG: ImageLike = { width: 1600, height: 900 };
const images = (n: number) => new Map<number, ImageLike>(Array.from({ length: n }, (_, i) => [i, IMG]));

test("an empty film is only the black background", () => {
  const ctx = new FakeCanvas();
  assert.deepEqual(renderFrame(ctx, SIZE, timelineOf([]), new Map(), 0), []);
  assert.deepEqual(ctx.of("fillRect").map((c) => c.args), [[0, 0, 640, 360, "#000000"]]);
  assert.equal(ctx.of("drawImage").length, 0);
  assert.equal(ctx.depth, 0);
});

test("one scene: the camera part fills the whole frame, centred", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 10, { motion: "zoom-in" })]);
  assert.deepEqual(renderFrame(ctx, SIZE, timeline, images(1), 5), []);
  const rect = sourceRect("zoom-in", 0.5, 1600, 900, 640, 360)!;
  assert.deepEqual(ctx.of("drawImage")[0].args, [rect.x, rect.y, rect.width, rect.height, -320, -180, 640, 360]);
  assert.deepEqual(ctx.of("translate")[0].args, [320, 180]);
  assert.deepEqual(ctx.of("scale")[0].args, [1, 1]);
  assert.equal(ctx.of("drawImage")[0].alpha, 1);
  assert.equal(ctx.depth, 0);
});

test("a fade draws the old picture solid and the new one transparent", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6), scene("b", 6)]); // overlap 4..6
  renderFrame(ctx, SIZE, timeline, images(2), 5);
  assert.deepEqual(ctx.of("drawImage").map((c) => c.alpha), [1, 0.5]);
  assert.equal(ctx.depth, 0);
});

test("a slide moves the pictures sideways by the frame width", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6, { transition: "slide-left" }), scene("b", 6)]);
  renderFrame(ctx, SIZE, timeline, images(2), 5);
  assert.deepEqual(ctx.of("translate").map((c) => c.args[0]), [320 - 320, 320 + 320]);
});

test("a zoom change scales the leaving picture up", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6, { transition: "zoom" }), scene("b", 6)]);
  renderFrame(ctx, SIZE, timeline, images(2), 5);
  const scales = ctx.of("scale").map((c) => c.args[0] as number);
  assert.equal(scales[0], 1);
  assert.ok(Math.abs(scales[1] - 1.15) < 1e-9);
});

test("a picture that is not loaded is skipped and reported", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6), scene("b", 6)]);
  const missing = renderFrame(ctx, SIZE, timeline, new Map([[0, IMG]]), 5);
  assert.deepEqual(missing, [1]);
  assert.equal(ctx.of("drawImage").length, 1);
  assert.equal(ctx.depth, 0);
  const none = renderFrame(new FakeCanvas(), SIZE, timeline, new Map(), 1);
  assert.deepEqual(none, [0]);
});

test("a picture with an unusable size is reported, not drawn", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6, { transition: "cut" })]);
  assert.deepEqual(renderFrame(ctx, SIZE, timeline, new Map([[0, { width: 0, height: 0 }]]), 1), [0]);
  assert.equal(ctx.of("drawImage").length, 0);
});

test("a caption is drawn on a dark band at the bottom, in full in the middle of its scene", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 10, { caption: "  Hello world  " })]);
  renderFrame(ctx, SIZE, timeline, images(1), 5);
  const texts = ctx.of("fillText");
  assert.deepEqual(texts.map((c) => c.args[0]), ["Hello world"]);
  assert.equal(texts[0].args[1], 320);
  assert.equal(texts[0].alpha, 1);
  const bands = ctx.of("fillRect").filter((c) => c.args[4] === "#000000" && c.args[3] !== 360);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].alpha, 0.55);
  assert.ok((bands[0].args[1] as number) + (bands[0].args[3] as number) <= 360);
  assert.equal(ctx.direction, "inherit");
  assert.equal(ctx.depth, 0);
});

test("a caption fades in at the start and out at the end of its scene", () => {
  const timeline = timelineOf([scene("a", 10, { caption: "Hi" })]);
  const alphaAt = (t: number) => {
    const ctx = new FakeCanvas();
    renderFrame(ctx, SIZE, timeline, images(1), t);
    return ctx.of("fillText")[0]?.alpha ?? 0;
  };
  assert.equal(alphaAt(0), 0);
  assert.ok(Math.abs(alphaAt(CAPTION_FADE_SECONDS / 2) - 0.5) < 1e-9);
  assert.equal(alphaAt(5), 1);
  assert.ok(Math.abs(alphaAt(10 - CAPTION_FADE_SECONDS / 2) - 0.5) < 1e-9);
});

test("an empty caption draws nothing", () => {
  const ctx = new FakeCanvas();
  renderFrame(ctx, SIZE, timelineOf([scene("a", 10, { caption: "   " })]), images(1), 5);
  assert.equal(ctx.of("fillText").length, 0);
});

test("a long caption is wrapped between words, any language, and limited to four lines", () => {
  const measure = (s: string) => s.length * 10;
  assert.deepEqual(wrapCaption("aaa bbb ccc ddd", 70, measure), ["aaa bbb", "ccc ddd"]);
  assert.deepEqual(wrapCaption("این یک متن فارسی بلند است", 120, measure), ["این یک متن", "فارسی بلند", "است"]);
  assert.deepEqual(wrapCaption("extraordinarilylongword x", 50, measure), ["extraordinarilylongword", "x"]);
  assert.deepEqual(wrapCaption("   ", 50, measure), []);
  assert.deepEqual(wrapCaption("a b c d e f", 10, measure, 3), ["a", "b", "c…"]);
});

test("a caption moves and fades together with its picture", () => {
  const ctx = new FakeCanvas();
  const timeline = timelineOf([scene("a", 6, { transition: "slide-left", caption: "A" }), scene("b", 6)]);
  renderFrame(ctx, SIZE, timeline, images(2), 5);
  // The first scene is leaving to the left: its caption is inside its shifted space.
  const firstSave = ctx.calls.findIndex((c) => c.name === "translate");
  const secondTranslate = ctx.calls.findIndex((c, i) => i > firstSave && c.name === "translate");
  assert.ok(secondTranslate > firstSave);
  assert.equal(ctx.of("fillText").length, 1);
  assert.equal(ctx.depth, 0);
});
