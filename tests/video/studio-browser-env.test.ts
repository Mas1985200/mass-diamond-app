// tests/video/studio-browser-env.test.ts
// Joining the studio to the browser, with a fake browser: the canvas is made at
// the right size, the recorder gets what it is given, frames and the clock come
// from the browser, and a browser that lacks something says so clearly. Also the
// browser side of the 3D photo: reading a picture's pixels, making and freeing layer
// canvases, and a depth model that is not asked again once it has failed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  canMakeFilm,
  createBrowserEnv,
  rememberFailure,
  type BrowserScope,
} from "../../src/features/video/studio/browserEnv.ts";
import type { DepthEngine } from "../../src/features/video/studio/depthModel.ts";

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

// A fake browser whose canvases write down what is done to them.
interface FakeCanvasRecord {
  width: number;
  height: number;
  calls: unknown[][];
  put: Uint8ClampedArray | null;
}

function pixelScope(options: { noContext?: boolean } = {}) {
  const canvases: FakeCanvasRecord[] = [];
  const scope: BrowserScope = {
    document: {
      createElement() {
        const record: FakeCanvasRecord = { width: 0, height: 0, calls: [], put: null };
        canvases.push(record);
        return {
          get width() { return record.width; },
          set width(value: number) { record.width = value; },
          get height() { return record.height; },
          set height(value: number) { record.height = value; },
          getContext() {
            if (options.noContext) return null;
            return {
              drawImage: (...args: unknown[]) => { record.calls.push(["draw", ...args]); },
              getImageData: (_x: number, _y: number, w: number, h: number) => ({
                width: w,
                height: h,
                data: new Uint8ClampedArray(w * h * 4).fill(7),
              }),
              createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
              putImageData: (data: { data: Uint8ClampedArray }) => { record.put = data.data; },
            };
          },
        };
      },
    },
  };
  return { scope, canvases };
}

test("without a document there is no 3D photo", () => {
  assert.equal(createBrowserEnv({}).parallax, undefined);
});

test("the depth model can be switched off, and by default the real one is ready but not asked", () => {
  const off = createBrowserEnv(pixelScope().scope, { depthEngine: null });
  assert.equal(off.parallax?.depthEngine, null);
  const real = createBrowserEnv(pixelScope().scope);
  assert.equal(typeof real.parallax?.depthEngine?.estimate, "function");
});

test("the picture is read as its middle part, scaled to the frame, and the scratch canvas is freed", () => {
  const { scope, canvases } = pixelScope();
  const deps = createBrowserEnv(scope, { depthEngine: null }).parallax!.layerDeps(
    { width: 400, height: 100 },
    { width: 100, height: 100 },
  )!;
  const pixels = deps.readPixels()!;
  assert.equal(pixels.width, 100);
  assert.equal(pixels.height, 100);
  assert.equal(pixels.data.length, 40000);
  assert.deepEqual(canvases[0].calls[0].slice(2), [150, 0, 100, 100, 0, 0, 100, 100]);
  assert.equal(canvases[0].width, 0);
  assert.equal(canvases[0].height, 0);
});

test("a picture that cannot be read gives nothing instead of failing", () => {
  const noContext = createBrowserEnv(pixelScope({ noContext: true }).scope, { depthEngine: null });
  assert.equal(noContext.parallax!.layerDeps({ width: 10, height: 10 }, { width: 4, height: 4 })!.readPixels(), null);
  const silly = createBrowserEnv(pixelScope().scope, { depthEngine: null });
  assert.equal(silly.parallax!.layerDeps({ width: 0, height: 0 }, { width: 4, height: 4 })!.readPixels(), null);
});

test("a layer is a canvas of the same size holding the same pixels", () => {
  const { scope, canvases } = pixelScope();
  const deps = createBrowserEnv(scope, { depthEngine: null }).parallax!.layerDeps(
    { width: 4, height: 4 },
    { width: 2, height: 2 },
  )!;
  const data = new Uint8ClampedArray(16).map((_, i) => i * 10);
  const layer = deps.makeLayer({ width: 2, height: 2, data }) as unknown as { width: number; height: number };
  assert.equal(layer.width, 2);
  assert.equal(layer.height, 2);
  assert.deepEqual(Array.from(canvases[0].put!), Array.from(data));
});

test("a layer that cannot get a canvas is an error the film maker can handle", () => {
  const env = createBrowserEnv(pixelScope({ noContext: true }).scope, { depthEngine: null });
  const deps = env.parallax!.layerDeps({ width: 4, height: 4 }, { width: 2, height: 2 })!;
  assert.throws(() => deps.makeLayer({ width: 2, height: 2, data: new Uint8ClampedArray(16) }));
});

test("letting go of layers frees their canvases and ignores anything else", () => {
  const { scope } = pixelScope();
  const env = createBrowserEnv(scope, { depthEngine: null });
  const layers = [
    { width: 5, height: 6 },
    { width: 7, height: 8 },
  ];
  env.parallax!.release!({ width: 5, height: 6, layers: [...layers, "text", null, 42] });
  assert.deepEqual(layers, [
    { width: 0, height: 0 },
    { width: 0, height: 0 },
  ]);
});

test("a depth model that answers is passed through and stays usable", async () => {
  let calls = 0;
  const engine: DepthEngine = {
    estimate: async () => {
      calls += 1;
      return { width: 2, height: 2, data: [1, 2, 3, 4] };
    },
  };
  const wrapped = rememberFailure(engine, 1000);
  assert.equal((await wrapped.estimate("a")).width, 2);
  assert.equal((await wrapped.estimate("b")).width, 2);
  assert.equal(calls, 2);
});

test("after one failure the depth model is not asked again", async () => {
  let calls = 0;
  const engine: DepthEngine = {
    estimate: async () => {
      calls += 1;
      throw new Error("blocked");
    },
  };
  const wrapped = rememberFailure(engine, 1000);
  await assert.rejects(wrapped.estimate("a"), /blocked/);
  await assert.rejects(wrapped.estimate("b"), /unavailable/);
  await assert.rejects(wrapped.estimate("c"), /unavailable/);
  assert.equal(calls, 1);
});

test("a depth model that is too slow counts as failed, once", async () => {
  let calls = 0;
  const engine: DepthEngine = {
    estimate: () => {
      calls += 1;
      return new Promise<never>(() => {});
    },
  };
  const wrapped = rememberFailure(engine, 20);
  await assert.rejects(wrapped.estimate("a"), /too slow/);
  await assert.rejects(wrapped.estimate("b"), /unavailable/);
  assert.equal(calls, 1);
});
