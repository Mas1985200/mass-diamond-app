// tests/video/wan-space.test.ts
// The free Wan engine: how a request becomes the Space's settings, how its
// event stream and errors are read, and how submit/poll behave with a faked
// network. No real network is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCallData,
  buildWanInputs,
  classifyEngineError,
  createWanSpaceProvider,
  extractVideoUrl,
  parseSseEvents,
  readOutcome,
  readWanConfig,
} from "../../supabase/functions/video-engine/providers/wan-space.ts";
import type { VideoRequest } from "../../supabase/functions/video-engine/providers/types.ts";

const BASE = "https://example-space.hf.space";

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  kind: "text_to_video",
  prompt: "a red fox in snow",
  style: "cinematic",
  aspectRatio: "16:9",
  durationSeconds: 3,
  quality: "standard",
  seed: 7,
  imageUrls: [],
  ...over,
});

test("settings stay inside what the Space accepts for every size, quality and length", () => {
  for (const quality of ["draft", "standard", "high"] as const) {
    for (const aspectRatio of ["16:9", "9:16", "1:1"] as const) {
      for (const durationSeconds of [1, 3, 5]) {
        const i = buildWanInputs(request({ quality, aspectRatio, durationSeconds }));
        assert.ok(i.width >= 512 && i.width <= 1920);
        assert.ok(i.height >= 512 && i.height <= 1080);
        assert.ok(i.width % 32 === 0 && i.height % 32 === 0);
        assert.ok(i.numFrames >= 25 && i.numFrames <= 145);
        assert.ok(i.steps >= 20 && i.steps <= 60);
      }
    }
  }
});

test("the shape follows the aspect ratio and the length follows the seconds", () => {
  const wide = buildWanInputs(request({ aspectRatio: "16:9" }));
  const tall = buildWanInputs(request({ aspectRatio: "9:16" }));
  const square = buildWanInputs(request({ aspectRatio: "1:1" }));
  assert.ok(wide.width > wide.height);
  assert.ok(tall.height > tall.width);
  assert.equal(square.width, square.height);
  assert.equal(buildWanInputs(request({ durationSeconds: 3 })).numFrames, 73);
  assert.equal(buildWanInputs(request({ durationSeconds: 1 })).numFrames, 25);
  assert.equal(buildWanInputs(request({ durationSeconds: 99 })).numFrames, 145);
});

test("the same seed gives the same settings; no seed gives a valid random one", () => {
  assert.equal(buildWanInputs(request()).seed, 7);
  const random = buildWanInputs(request({ seed: undefined })).seed;
  assert.ok(Number.isInteger(random) && random >= 0);
});

test("call data is in the Space's order and carries the picture only for image-to-video", () => {
  const text = buildCallData(buildWanInputs(request()));
  assert.equal(text.length, 8);
  assert.equal(text[0], "a red fox in snow");
  assert.equal(text[1], null);
  const image = buildCallData(
    buildWanInputs(
      request({ kind: "image_to_video", imageUrls: ["https://x.test/a.png"] }),
    ),
  );
  assert.deepEqual(image[1], {
    path: "https://x.test/a.png",
    url: "https://x.test/a.png",
    meta: { _type: "gradio.FileData" },
  });
});

test("event stream: finished blocks are read, an unfinished one is left out", () => {
  const events = parseSseEvents(
    "event: heartbeat\ndata: null\n\nevent: complete\ndata: [1]\n\nevent: comp",
  );
  assert.deepEqual(events, [
    { event: "heartbeat", data: "null" },
    { event: "complete", data: "[1]" },
  ]);
  assert.deepEqual(parseSseEvents("event: complete\ndata: [1]"), []);
});

test("the video link is found in every shape the Space may answer with", () => {
  assert.equal(
    extractVideoUrl([{ video: { url: `${BASE}/f/v.mp4`, path: "/tmp/v.mp4" } }, "ok"], BASE),
    `${BASE}/f/v.mp4`,
  );
  assert.equal(
    extractVideoUrl([{ video: { path: "/tmp/v.mp4" } }], BASE),
    `${BASE}/gradio_api/file=/tmp/v.mp4`,
  );
  assert.equal(extractVideoUrl(["/gradio_api/file=/tmp/v.mp4"], BASE), `${BASE}/gradio_api/file=/tmp/v.mp4`);
  assert.equal(extractVideoUrl([{ subtitles: null }], BASE), null);
  assert.equal(extractVideoUrl(null, BASE), null);
});

test("errors from the Space get an honest code and the right retry flag", () => {
  assert.deepEqual(classifyEngineError("You have exceeded your GPU quota"), {
    code: "quota_exhausted",
    retryable: true,
  });
  assert.equal(classifyEngineError("queue is full").code, "engine_busy");
  assert.deepEqual(classifyEngineError("blocked by safety policy"), {
    code: "content_rejected",
    retryable: false,
  });
  assert.equal(classifyEngineError("something broke").code, "engine_error");
});

test("readOutcome: running, success, error and a broken answer", () => {
  assert.equal(readOutcome("event: heartbeat\ndata: null\n\n", BASE), null);
  const ok = readOutcome(
    `event: complete\ndata: [{"video":{"url":"${BASE}/f/v.mp4"}},"done"]\n\n`,
    BASE,
  );
  assert.deepEqual(ok, { state: "succeeded", videoUrl: `${BASE}/f/v.mp4` });
  const err = readOutcome("event: error\ndata: GPU quota exceeded\n\n", BASE);
  assert.equal(err?.state, "failed");
  assert.equal(err?.state === "failed" && err.code, "quota_exhausted");
  const broken = readOutcome("event: complete\ndata: not json\n\n", BASE);
  assert.equal(broken?.state === "failed" && broken.code, "bad_response");
  const empty = readOutcome("event: complete\ndata: [null]\n\n", BASE);
  assert.equal(empty?.state === "failed" && empty.code, "bad_response");
});

test("config needs the token; address and name have safe defaults and are cleaned", () => {
  assert.equal(readWanConfig({}), null);
  assert.equal(readWanConfig({ HF_TOKEN: "  " }), null);
  const c = readWanConfig({
    HF_TOKEN: "t",
    HF_VIDEO_SPACE_URL: "https://a.hf.space///",
    HF_VIDEO_API_NAME: "/gen",
  });
  assert.deepEqual(c, { token: "t", spaceUrl: "https://a.hf.space", apiName: "gen" });
  assert.equal(readWanConfig({ HF_TOKEN: "t" })?.apiName, "generate_video");
});

test("without the token the engine is not configured and refuses to start", async () => {
  const provider = createWanSpaceProvider({});
  assert.equal(provider.isConfigured({}), false);
  assert.equal(provider.isConfigured({ HF_TOKEN: "t" }), true);
  await assert.rejects(() => provider.submit(request()), { code: "not_configured" });
});

test("submit sends the token and data and returns the event id", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ event_id: "abc123" }), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = createWanSpaceProvider(
    { HF_TOKEN: "secret", HF_VIDEO_SPACE_URL: BASE },
    fake,
  );
  const result = await provider.submit(request());
  assert.deepEqual(result, { providerJobId: "abc123" });
  assert.equal(seen!.url, `${BASE}/gradio_api/call/generate_video`);
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(String(seen!.init.body)).data.length, 8);
});

test("submit maps refusals and a missing event id to clear errors", async () => {
  const make = (status: number, body: unknown) =>
    createWanSpaceProvider(
      { HF_TOKEN: "t", HF_VIDEO_SPACE_URL: BASE },
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
    );
  await assert.rejects(() => make(429, {}).submit(request()), { code: "rate_limited", retryable: true });
  await assert.rejects(() => make(503, {}).submit(request()), { code: "engine_busy", retryable: true });
  await assert.rejects(() => make(401, {}).submit(request()), { retryable: false });
  await assert.rejects(() => make(200, {}).submit(request()), { code: "bad_response" });
});

test("poll returns the video when the stream completes, stops when the caller cancels, and fails on an empty stream", async () => {
  const streamOf = (text: string) =>
    (async () => new Response(text, { status: 200 })) as unknown as typeof fetch;
  const done = createWanSpaceProvider(
    { HF_TOKEN: "t", HF_VIDEO_SPACE_URL: BASE },
    streamOf(`event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"video":{"url":"${BASE}/v.mp4"}}]\n\n`),
  );
  assert.deepEqual(await done.poll("e1"), { state: "succeeded", videoUrl: `${BASE}/v.mp4` });

  const silent = createWanSpaceProvider(
    { HF_TOKEN: "t", HF_VIDEO_SPACE_URL: BASE },
    (async (_u: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: heartbeat\ndata: null\n\n"));
          init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch,
  );
  const controller = new AbortController();
  // The caller cancelling is a real stop, not "running".
  const pending = silent.poll("e2", controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => pending);

  const closedEmpty = createWanSpaceProvider(
    { HF_TOKEN: "t", HF_VIDEO_SPACE_URL: BASE },
    streamOf(""),
  );
  const result = await closedEmpty.poll("e3");
  assert.equal(result.state === "failed" && result.code, "bad_response");
});
