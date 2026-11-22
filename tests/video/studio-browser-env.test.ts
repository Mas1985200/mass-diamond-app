// tests/video/studio-browser-env.test.ts
// Joining the studio to the browser, with a fake browser: the canvas is made at
// the right size, the recorder gets what it is given, frames and the clock come
// from the browser, and a browser that lacks something says so clearly.

import test from "node:test";
import assert from "node:assert/strict";

import { canMakeFilm, createBrowserEnv, type BrowserScope } from "../../src/features/video/studio/browserEnv.ts";

function fakeScope(over: Partial<BrowserScope> & { webm?: boolean; noContext?: boolean; noStream?: boolean } = {}) {
  const log: string[] = [];
  const canvases: Array<{ width: number; height: number; options?: unknown }> = [];
  class FakeMediaRecorder {
    static isTypeSupported(type: string) { return over.webm !== false && type === "video/webm"; }
    created: unknown[];
    constructor(stream: unknown, options: unknown) { this.created = [stream, options]; log.push("recorder"); }
    ondataavailable = null; onstop = null; onerror = null;
    start() {} stop() {}
  }
  const scope: BrowserScope = {
    document: {
      createElement() {
        const canvas = {
          width: 0, height: 0,
          getContext(_kind: "2d", options?: { alpha?: boolean }) {
            canvases.push({ width: canvas.width, height: canvas.height, options });
            return over.noContext ? null : { fake: "ctx" };
          },
          ...(over.noStream ? {} : { captureStream: () => ({ getTracks: () => [] }) }),
        };
        return canvas;
      },
    },
    MediaRecorder: FakeMediaRecorder as unknown as BrowserScope["MediaRecorder"],
    requestAnimationFrame: (cb) => { log.push("raf"); setImmediate(cb); return 7; },
    cancelAnimationFrame: (h) => { log.push(`cancel${h}`); },
    performance: { now: () => 1234 },
    ...over,
  };
  return { scope, log, canvases };
}

test("a browser with everything can make films", () => {
  assert.equal(canMakeFilm(fakeScope().scope), true);
});

test("a browser that lacks something cannot", () => {
  assert.equal(canMakeFilm({}), false);
  assert.equal(canMakeFilm(fakeScope({ MediaRecorder: undefined }).scope), false);
  assert.equal(canMakeFilm(fakeScope({ document: undefined }).scope), false);
  assert.equal(canMakeFilm(fakeScope({ requestAnimationFrame: undefined }).scope), false);
  assert.equal(canMakeFilm(fakeScope({ performance: undefined }).scope), false);
  assert.equal(canMakeFilm(fakeScope({ webm: false }).scope), false);
});

test("the canvas has the asked size and gives its drawing and recording parts", () => {
  const { scope, canvases } = fakeScope();
  const made = createBrowserEnv(scope).createCanvas({ width: 640, height: 360 });
  assert.deepEqual(canvases, [{ width: 640, height: 360, options: { alpha: false } }]);
  assert.deepEqual(made.ctx, { fake: "ctx" } as never);
  assert.equal(typeof made.canvas.captureStream, "function");
});

test("a canvas that cannot be drawn on or recorded is an error", () => {
  assert.throws(() => createBrowserEnv(fakeScope({ noContext: true }).scope).createCanvas({ width: 2, height: 2 }));
  assert.throws(() => createBrowserEnv(fakeScope({ noStream: true }).scope).createCanvas({ width: 2, height: 2 }));
  assert.throws(() => createBrowserEnv({}).createCanvas({ width: 2, height: 2 }));
});

test("the recorder gets the stream and the options it is given", () => {
  const { scope, log } = fakeScope();
  const env = createBrowserEnv(scope);
  const stream = { id: "s" };
  const options = { mimeType: "video/webm", videoBitsPerSecond: 1_000_000 };
  const recorder = env.recorder.createRecorder(stream as never, options) as unknown as { created: unknown[] };
  assert.deepEqual(recorder.created, [stream, options]);
  assert.deepEqual(log, ["recorder"]);
  assert.throws(() => createBrowserEnv({}).recorder.createRecorder(stream as never, options));
});

test("supported types come from the browser's recorder", () => {
  const env = createBrowserEnv(fakeScope().scope);
  assert.equal(env.recorder.isTypeSupported("video/webm"), true);
  assert.equal(env.recorder.isTypeSupported("video/mp4"), false);
  assert.equal(createBrowserEnv({}).recorder.isTypeSupported("video/webm"), false);
});

test("frames come from the animation frame and can be cancelled", async () => {
  const { scope, log } = fakeScope();
  const env = createBrowserEnv(scope);
  let called = 0;
  const cancel = env.recorder.nextFrame(() => { called++; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, 1);
  cancel();
  assert.deepEqual(log, ["raf", "cancel7"]);
  assert.throws(() => createBrowserEnv({}).recorder.nextFrame(() => {}));
});

test("the clock is the browser's, with a fallback", () => {
  assert.equal(createBrowserEnv(fakeScope().scope).recorder.now(), 1234);
  const before = Date.now();
  const fallback = createBrowserEnv({}).recorder.now();
  assert.ok(fallback >= before);
});
