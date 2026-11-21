// tests/video/studio-recorder.test.ts
// Recording the film: which file type is picked, how big the bitrate is, that
// frames are drawn from 0 to the end at the clock's pace, the last frame is kept,
// and that cancelling, a broken recorder, an unsupported browser and an empty
// recording each give a clear answer and always release the stream. No browser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  pickRecordingType,
  recordProject,
  videoBitrate,
  type RecorderDeps,
  type RecorderLike,
} from "../../src/features/video/studio/recorder.ts";

class FakeRecorder implements RecorderLike {
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  onerror: RecorderLike["onerror"] = null;
  started: number | undefined;
  stopped = 0;
  emptyAtStop = false;
  throwOnStop = false;
  start(timeslice?: number) {
    this.started = timeslice;
  }
  stop() {
    this.stopped++;
    if (this.throwOnStop) throw new Error("stop failed");
    if (!this.emptyAtStop) this.ondataavailable?.({ data: new Blob(["video-bytes"]) });
    this.onstop?.();
  }
}

function harness(over: Partial<{ supported: string[]; frameMs: number }> = {}) {
  let clock = 1000;
  let pending: (() => void) | null = null;
  const recorder = new FakeRecorder();
  const trackStops = { count: 0 };
  const frameMs = over.frameMs ?? 100;
  const supported = over.supported ?? ["video/webm"];
  const info: { mimeType?: string; bits?: number; fps?: number } = {};
  const deps: RecorderDeps = {
    canvas: {
      captureStream(fps) {
        info.fps = fps;
        return { getTracks: () => [{ stop: () => { trackStops.count++; } }] };
      },
    },
    createRecorder(_stream, options) {
      info.mimeType = options.mimeType;
      info.bits = options.videoBitsPerSecond;
      return recorder;
    },
    isTypeSupported: (t) => supported.includes(t),
    nextFrame(cb) {
      pending = cb;
      return () => { if (pending === cb) pending = null; };
    },
    now: () => clock,
  };
  // Runs animation frames until none is waiting.
  const run = (max = 100000) => {
    let n = 0;
    while (pending && n++ < max) {
      const cb = pending;
      pending = null;
      clock += frameMs;
      cb();
    }
    return n;
  };
  return { deps, recorder, trackStops, info, run, hasPending: () => pending !== null };
}

const SIZE = { width: 640, height: 360 };

test("MP4 is preferred, WebM is the fallback, nothing supported gives null", () => {
  assert.equal(pickRecordingType((t) => t === "video/mp4"), "video/mp4");
  assert.equal(pickRecordingType(() => true), "video/mp4;codecs=avc1.42E01E");
  assert.equal(pickRecordingType((t) => t.startsWith("video/webm")), "video/webm;codecs=vp9");
  assert.equal(pickRecordingType((t) => t === "video/webm"), "video/webm");
  assert.equal(pickRecordingType(() => false), null);
  assert.equal(pickRecordingType(() => { throw new Error("no"); }), null);
});

test("the bitrate grows with size and quality and stays in a sane range", () => {
  const draft = videoBitrate({ width: 640, height: 360 }, "draft");
  const standard = videoBitrate({ width: 1280, height: 720 }, "standard");
  const high = videoBitrate({ width: 1920, height: 1080 }, "high");
  assert.ok(draft < standard && standard < high);
  assert.equal(videoBitrate({ width: 16, height: 16 }, "draft"), 500_000);
  assert.equal(videoBitrate({ width: 7680, height: 4320 }, "high"), 20_000_000);
  assert.equal(videoBitrate({ width: Number.NaN, height: 10 }, "high"), 500_000);
});

test("a film is drawn from the first moment to the last at the clock's pace and gives a file", async () => {
  const h = harness();
  const drawn: number[] = [];
  const progress: number[] = [];
  const promise = recordProject(h.deps, {
    seconds: 2, size: SIZE, quality: "standard",
    drawAt: (t) => drawn.push(t), onProgress: (p) => progress.push(p),
  });
  h.run();
  const result = await promise;
  assert.ok(result.ok);
  assert.equal(result.mimeType, "video/webm");
  assert.equal(result.seconds, 2);
  assert.ok(result.blob.size > 0);
  assert.equal(result.blob.type, "video/webm");
  assert.equal(drawn[0], 0);
  assert.equal(drawn[drawn.length - 1], 2);
  assert.ok(drawn.every((t, i) => i === 0 || t >= drawn[i - 1]));
  assert.ok(drawn.every((t) => t >= 0 && t <= 2));
  assert.equal(progress[progress.length - 1], 1);
  assert.ok(progress.every((p) => p >= 0 && p <= 1));
  assert.equal(h.recorder.started, 1000);
  assert.equal(h.recorder.stopped, 1);
  assert.equal(h.info.fps, 30);
  assert.equal(h.info.bits, videoBitrate(SIZE, "standard"));
  assert.equal(h.trackStops.count, 1);
});

test("the last frame is drawn once and one more screen frame passes before the stop", async () => {
  const h = harness({ frameMs: 500 });
  const drawn: number[] = [];
  const promise = recordProject(h.deps, { seconds: 1, size: SIZE, quality: "draft", drawAt: (t) => drawn.push(t) });
  h.run();
  await promise;
  assert.equal(drawn.filter((t) => t === 1).length, 1);
  assert.deepEqual(drawn, [0, 0.5, 1]);
});

test("cancelling stops at once with no file and releases the stream", async () => {
  const h = harness();
  let frames = 0;
  const promise = recordProject(h.deps, {
    seconds: 60, size: SIZE, quality: "draft",
    drawAt: () => { frames++; }, isCancelled: () => frames >= 3,
  });
  h.run();
  assert.deepEqual(await promise, { ok: false, code: "cancelled" });
  assert.equal(h.recorder.stopped, 1);
  assert.equal(h.trackStops.count, 1);
  assert.equal(h.hasPending(), false);
});

test("a drawing that throws ends the recording as failed", async () => {
  const h = harness();
  let calls = 0;
  const promise = recordProject(h.deps, {
    seconds: 5, size: SIZE, quality: "draft",
    drawAt: () => { if (++calls === 3) throw new Error("bad picture"); },
  });
  h.run();
  assert.deepEqual(await promise, { ok: false, code: "failed" });
  assert.equal(h.trackStops.count, 1);
});

test("a recorder error ends the recording as failed", async () => {
  const h = harness();
  const promise = recordProject(h.deps, { seconds: 5, size: SIZE, quality: "draft", drawAt: () => {} });
  h.recorder.onerror?.(new Error("boom"));
  assert.deepEqual(await promise, { ok: false, code: "failed" });
  assert.equal(h.trackStops.count, 1);
});

test("a recording with no data is a failure, not an empty file", async () => {
  const h = harness();
  h.recorder.emptyAtStop = true;
  const promise = recordProject(h.deps, { seconds: 1, size: SIZE, quality: "draft", drawAt: () => {} });
  h.run();
  assert.deepEqual(await promise, { ok: false, code: "failed" });
});

test("a recorder that cannot stop is a failure and still releases the stream", async () => {
  const h = harness();
  h.recorder.throwOnStop = true;
  const promise = recordProject(h.deps, { seconds: 1, size: SIZE, quality: "draft", drawAt: () => {} });
  h.run();
  assert.deepEqual(await promise, { ok: false, code: "failed" });
  assert.equal(h.trackStops.count, 1);
});

test("a browser that cannot record says unsupported before drawing anything", async () => {
  const none = harness({ supported: [] });
  let drawn = 0;
  assert.deepEqual(
    await recordProject(none.deps, { seconds: 1, size: SIZE, quality: "draft", drawAt: () => { drawn++; } }),
    { ok: false, code: "unsupported" },
  );
  assert.equal(drawn, 0);

  const broken = harness();
  const deps: RecorderDeps = { ...broken.deps, createRecorder() { throw new Error("no recorder"); } };
  assert.deepEqual(
    await recordProject(deps, { seconds: 1, size: SIZE, quality: "draft", drawAt: () => {} }),
    { ok: false, code: "unsupported" },
  );
});

test("a film with no length or a frame with no size is invalid", async () => {
  const h = harness();
  for (const seconds of [0, -1, Number.NaN, Infinity]) {
    assert.deepEqual(
      await recordProject(h.deps, { seconds, size: SIZE, quality: "draft", drawAt: () => {} }),
      { ok: false, code: "invalid" },
    );
  }
  assert.deepEqual(
    await recordProject(h.deps, { seconds: 1, size: { width: 0, height: 360 }, quality: "draft", drawAt: () => {} }),
    { ok: false, code: "invalid" },
  );
});
