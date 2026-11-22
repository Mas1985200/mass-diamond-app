// tests/video/studio-make-film.test.ts
// The whole studio in order with fake browser parts: a project goes in, a video
// file comes out; bad projects, missing pictures, cancelling and a browser that
// cannot record each give a clear answer. No browser, no network.

import test from "node:test";
import assert from "node:assert/strict";

import { makeFilm, type FilmEnv, type FilmStage } from "../../src/features/video/studio/makeFilm.ts";
import type { CanvasLike } from "../../src/features/video/studio/renderFrame.ts";
import type { RecorderLike } from "../../src/features/video/studio/recorder.ts";

class FakeCanvas {
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  direction: CanvasDirection = "ltr";
  drawn = 0;
  save() {}
  restore() {}
  translate() {}
  scale() {}
  fillRect() {}
  fillText() {}
  measureText(t: string) { return { width: t.length * 10 }; }
  drawImage() { this.drawn++; }
  captureStream() { return { getTracks: () => [{ stop() {} }] }; }
}

class FakeRecorder implements RecorderLike {
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  onerror: RecorderLike["onerror"] = null;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(["bytes"]) });
    this.onstop?.();
  }
}

function setup(over: { loader?: FilmEnv["loader"]; supported?: string[]; createCanvas?: FilmEnv["createCanvas"] } = {}) {
  let clock = 0;
  let pending: (() => void) | null = null;
  const canvas = new FakeCanvas();
  const sizes: Array<{ width: number; height: number }> = [];
  const env: FilmEnv = {
    createCanvas: over.createCanvas ?? ((size) => { sizes.push(size); return { canvas, ctx: canvas as unknown as CanvasLike }; }),
    loader: over.loader ?? (async () => ({ width: 1600, height: 900 })),
    recorder: {
      createRecorder: () => new FakeRecorder(),
      isTypeSupported: (t) => (over.supported ?? ["video/webm"]).includes(t),
      nextFrame: (cb) => { pending = cb; return () => { if (pending === cb) pending = null; }; },
      now: () => clock,
    },
  };
  const run = async () => {
    // Lets the pictures load, then steps the animation frames.
    for (let i = 0; i < 100000; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!pending) { if (i > 5) break; else continue; }
      const cb = pending;
      pending = null;
      clock += 250;
      cb();
    }
  };
  return { env, canvas, sizes, run };
}

const project = (extra: Record<string, unknown> = {}) => ({
  title: "t", aspectRatio: "16:9", quality: "draft",
  scenes: [
    { imageUrl: "https://x/1.jpg", seconds: 2, transition: "cut" },
    { imageUrl: "https://x/2.jpg", seconds: 2, transition: "cut" },
  ],
  ...extra,
});

test("a project becomes a video file of the right size and length", async () => {
  const s = setup();
  const stages: Array<[FilmStage, number]> = [];
  const promise = makeFilm(project(), s.env, { onProgress: (stage, p) => stages.push([stage, p]) });
  await s.run();
  const result = await promise;
  assert.ok(result.ok);
  assert.equal(result.mimeType, "video/webm");
  assert.equal(result.seconds, 4);
  assert.deepEqual(result.size, { width: 640, height: 360 });
  assert.deepEqual(s.sizes, [{ width: 640, height: 360 }]);
  assert.deepEqual(result.failedScenes, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.blob.size > 0);
  assert.ok(s.canvas.drawn > 0);
  assert.deepEqual(stages.filter(([st]) => st === "loading").map(([, p]) => p), [0.5, 1]);
  const recording = stages.filter(([st]) => st === "recording").map(([, p]) => p);
  assert.equal(recording[recording.length - 1], 1);
});

test("the size follows the shape and quality of the project", async () => {
  const s = setup();
  const promise = makeFilm(project({ aspectRatio: "9:16", quality: "standard" }), s.env);
  await s.run();
  assert.ok((await promise).ok);
  assert.deepEqual(s.sizes, [{ width: 720, height: 1280 }]);
});

test("what had to be changed in the project is reported", async () => {
  const s = setup();
  const promise = makeFilm(project({ scenes: [{ imageUrl: "https://x/1.jpg", seconds: 2 }, { imageUrl: "http://bad/2.jpg" }] }), s.env);
  await s.run();
  const result = await promise;
  assert.ok(result.ok);
  assert.deepEqual(result.warnings, [{ code: "scene_dropped", index: 1 }]);
});

test("a picture that cannot be loaded leaves its scene black and is reported", async () => {
  const s = setup({
    loader: async (url) => { if (url.endsWith("2.jpg")) throw new Error("404"); return { width: 1600, height: 900 }; },
  });
  const promise = makeFilm(project(), s.env);
  await s.run();
  const result = await promise;
  assert.ok(result.ok);
  assert.deepEqual(result.failedScenes, [1]);
});

test("a film with no picture at all is refused before any drawing", async () => {
  const s = setup({ loader: async () => { throw new Error("offline"); } });
  assert.deepEqual(await makeFilm(project(), s.env), { ok: false, code: "no_images" });
  assert.equal(s.sizes.length, 0);
});

test("a project that cannot be used is invalid", async () => {
  const s = setup();
  assert.deepEqual(await makeFilm(null, s.env), { ok: false, code: "invalid" });
  assert.deepEqual(await makeFilm({ scenes: [] }, s.env), { ok: false, code: "invalid" });
});

test("cancelling while the pictures load stops everything", async () => {
  const s = setup();
  assert.deepEqual(await makeFilm(project(), s.env, { isCancelled: () => true }), { ok: false, code: "cancelled" });
  assert.equal(s.sizes.length, 0);
});

test("cancelling while recording gives no file", async () => {
  const s = setup();
  let calls = 0;
  const promise = makeFilm(project(), s.env, { isCancelled: () => ++calls > 12 });
  await s.run();
  assert.deepEqual(await promise, { ok: false, code: "cancelled" });
});

test("a browser that cannot make a canvas or record says unsupported", async () => {
  const noCanvas = setup({ createCanvas: () => { throw new Error("no canvas"); } });
  assert.deepEqual(await makeFilm(project(), noCanvas.env), { ok: false, code: "unsupported" });
  const noRecorder = setup({ supported: [] });
  assert.deepEqual(await makeFilm(project(), noRecorder.env), { ok: false, code: "unsupported" });
});
