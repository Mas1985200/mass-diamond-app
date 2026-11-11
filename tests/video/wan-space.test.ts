// tests/video/wan-space.test.ts
// The free Wan engine: how a request becomes the Space's settings, how a text
// becomes a picture first, how its event stream and errors are read, and how
// submit/poll behave with a faked network. No real network is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCallData,
  buildWanInputs,
  classifyEngineError,
  createWanSpaceProvider,
  extractVideoUrl,
  parseSseEvents,
  pictureFileName,
  pictureFromDataLink,
  readOutcome,
  readWanConfig,
} from "../../supabase/functions/video-engine/providers/wan-space.ts";
import type { VideoRequest } from "../../supabase/functions/video-engine/providers/types.ts";

const BASE = "https://example-space.hf.space";
const PNG_B64 = "iVBORw0KGgo" + "A".repeat(200);
const ENV = { HF_TOKEN: "secret", HF_VIDEO_SPACE_URL: BASE };
const ENV_TEXT = { ...ENV, CF_ACCOUNT_ID: "acc", CF_AI_TOKEN: "cf" };

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

test("settings stay inside what the Space accepts for every quality and length", () => {
  for (const quality of ["draft", "standard", "high"] as const) {
    for (const durationSeconds of [0, 0.2, 1, 3, 5, 99, Number.NaN]) {
      const i = buildWanInputs(request({ quality, durationSeconds }));
      assert.ok(i.durationSeconds >= 0.5 && i.durationSeconds <= 5);
      assert.ok(i.steps >= 1 && i.steps <= 30);
      assert.ok(i.guidance >= 0 && i.guidance <= 10);
      assert.ok(i.guidance2 >= 0 && i.guidance2 <= 10);
      assert.ok(i.seed >= 0 && i.seed <= 2_147_483_647);
    }
  }
  assert.ok(buildWanInputs(request({ quality: "high" })).steps > buildWanInputs(request({ quality: "draft" })).steps);
});

test("the length follows the seconds and the same seed gives the same settings", () => {
  assert.equal(buildWanInputs(request({ durationSeconds: 3 })).durationSeconds, 3);
  assert.equal(buildWanInputs(request({ durationSeconds: 99 })).durationSeconds, 5);
  assert.equal(buildWanInputs(request({ durationSeconds: 0 })).durationSeconds, 0.5);
  assert.equal(buildWanInputs(request()).seed, 7);
  const random = buildWanInputs(request({ seed: undefined })).seed;
  assert.ok(Number.isInteger(random) && random >= 0);
});

test("call data is in the Space's order and the picture is a file reference", () => {
  const data = buildCallData(buildWanInputs(request()), "/tmp/gradio/x/picture.png");
  assert.equal(data.length, 9);
  assert.deepEqual(data[0], { path: "/tmp/gradio/x/picture.png", meta: { _type: "gradio.FileData" } });
  assert.equal(data[1], "a red fox in snow");
  assert.equal(data[2], 6);
  assert.equal(typeof data[3], "string");
  assert.equal(data[4], 3);
  assert.equal(data[7], 7);
  assert.equal(data[8], false);
});

test("a picture is read from a data link, and a bad link is refused", () => {
  const ok = pictureFromDataLink(`data:image/png;base64,${btoa("hello")}`);
  assert.equal(ok?.mime, "image/png");
  assert.equal(new TextDecoder().decode(ok!.bytes), "hello");
  assert.equal(pictureFromDataLink("data:text/plain;base64,aGk="), null);
  assert.equal(pictureFromDataLink("https://x.test/a.png"), null);
  assert.equal(pictureFromDataLink("data:image/png;base64,"), null);
  assert.equal(pictureFileName("image/jpeg"), "picture.jpg");
  assert.equal(pictureFileName("image/webp"), "picture.webp");
  assert.equal(pictureFileName("image/png"), "picture.png");
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
    extractVideoUrl([{ path: "/tmp/v.mp4", url: `${BASE}/f/v.mp4` }, 42], BASE),
    `${BASE}/f/v.mp4`,
  );
  assert.equal(
    extractVideoUrl([{ video: { url: `${BASE}/f/v.mp4`, path: "/tmp/v.mp4" } }, "ok"], BASE),
    `${BASE}/f/v.mp4`,
  );
  assert.equal(
    extractVideoUrl([{ path: "/tmp/v.mp4" }, 1], BASE),
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
    `event: complete\ndata: [{"path":"/tmp/v.mp4","url":"${BASE}/f/v.mp4"},42]\n\n`,
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

test("text to video is offered only when the picture maker is configured", () => {
  assert.deepEqual(createWanSpaceProvider(ENV).capabilities.kinds, ["image_to_video"]);
  assert.deepEqual(createWanSpaceProvider(ENV_TEXT).capabilities.kinds, ["text_to_video", "image_to_video"]);
});

test("without the token the engine is not configured and refuses to start", async () => {
  const provider = createWanSpaceProvider({});
  assert.equal(provider.isConfigured({}), false);
  assert.equal(provider.isConfigured({ HF_TOKEN: "t" }), true);
  await assert.rejects(() => provider.submit(request()), { code: "not_configured" });
});

// A faked network that answers the picture maker, the upload and the call.
function network(over: { call?: Response; upload?: Response; image?: Response; source?: Response } = {}) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    if (url.includes("api.cloudflare.com")) {
      return over.image ?? new Response(JSON.stringify({ success: true, result: { image: PNG_B64 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/gradio_api/upload")) {
      return over.upload ?? new Response(JSON.stringify(["/tmp/gradio/abc/picture.png"]), { status: 200 });
    }
    if (url.includes("/gradio_api/call/")) {
      return over.call ?? new Response(JSON.stringify({ event_id: "abc123" }), { status: 200 });
    }
    return over.source ?? new Response(new Uint8Array(300).fill(1), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  }) as unknown as typeof fetch;
  return { fake, seen };
}

test("text to video: a picture is made, uploaded, then the call is started with the token", async () => {
  const { fake, seen } = network();
  const provider = createWanSpaceProvider(ENV_TEXT, fake);
  const result = await provider.submit(request({ aspectRatio: "9:16" }));
  assert.deepEqual(result, { providerJobId: "abc123" });

  assert.equal(seen.length, 3);
  assert.ok(seen[0].url.includes("api.cloudflare.com"));
  assert.equal(JSON.parse(String(seen[0].init!.body)).height, 1024);
  assert.equal(seen[1].url, `${BASE}/gradio_api/upload`);
  assert.equal((seen[1].init!.headers as Record<string, string>).Authorization, "Bearer secret");
  assert.ok(seen[1].init!.body instanceof FormData);
  assert.equal(seen[2].url, `${BASE}/gradio_api/call/generate_video`);
  const data = JSON.parse(String(seen[2].init!.body)).data;
  assert.equal(data.length, 9);
  assert.equal(data[0].path, "/tmp/gradio/abc/picture.png");
  assert.equal(data[1], "a red fox in snow");
});

test("text to video without the picture maker's secrets stops with a clear error", async () => {
  const { fake, seen } = network();
  const provider = createWanSpaceProvider(ENV, fake);
  await assert.rejects(() => provider.submit(request()), { code: "not_configured", retryable: false });
  assert.equal(seen.length, 0);
});

test("image to video: the person's picture is downloaded and uploaded, no picture is made", async () => {
  const { fake, seen } = network();
  const provider = createWanSpaceProvider(ENV, fake);
  const result = await provider.submit(
    request({ kind: "image_to_video", imageUrls: ["https://files.test/a.jpg"] }),
  );
  assert.deepEqual(result, { providerJobId: "abc123" });
  assert.equal(seen[0].url, "https://files.test/a.jpg");
  assert.equal(seen.some((s) => s.url.includes("api.cloudflare.com")), false);
  assert.equal(seen.length, 3);
});

test("image to video accepts a data link and refuses a missing or unusable picture", async () => {
  const { fake, seen } = network();
  const provider = createWanSpaceProvider(ENV, fake);
  await provider.submit(request({ kind: "image_to_video", imageUrls: [`data:image/png;base64,${PNG_B64}`] }));
  assert.equal(seen[0].url, `${BASE}/gradio_api/upload`);

  await assert.rejects(
    () => provider.submit(request({ kind: "image_to_video", imageUrls: [] })),
    { code: "unsupported_request" },
  );
  const text = network({ source: new Response("not a picture", { status: 200, headers: { "content-type": "text/html" } }) });
  await assert.rejects(
    () => createWanSpaceProvider(ENV, text.fake).submit(request({ kind: "image_to_video", imageUrls: ["https://files.test/x"] })),
    { code: "unsupported_request", retryable: false },
  );
  await assert.rejects(
    () => provider.submit(request({ kind: "multi_image_to_video", imageUrls: ["a", "b"] })),
    { code: "unsupported_request" },
  );
});

test("submit maps refusals and a missing event id to clear errors", async () => {
  const make = (call: Response) =>
    createWanSpaceProvider(ENV_TEXT, network({ call }).fake);
  await assert.rejects(() => make(new Response("{}", { status: 429 })).submit(request()), { code: "rate_limited", retryable: true });
  await assert.rejects(() => make(new Response("{}", { status: 503 })).submit(request()), { code: "engine_busy", retryable: true });
  await assert.rejects(() => make(new Response("{}", { status: 401 })).submit(request()), { retryable: false });
  await assert.rejects(() => make(new Response("{}", { status: 200 })).submit(request()), { code: "bad_response" });
});

test("a failed upload or a failed picture stops before the video is started", async () => {
  const badUpload = network({ upload: new Response("{}", { status: 503 }) });
  await assert.rejects(() => createWanSpaceProvider(ENV_TEXT, badUpload.fake).submit(request()), { code: "engine_busy" });
  assert.equal(badUpload.seen.some((s) => s.url.includes("/gradio_api/call/")), false);

  const noPath = network({ upload: new Response("[]", { status: 200 }) });
  await assert.rejects(() => createWanSpaceProvider(ENV_TEXT, noPath.fake).submit(request()), { code: "bad_response" });

  const badImage = network({ image: new Response(JSON.stringify({ success: false, errors: [{ message: "daily free allocation used" }] }), { status: 400 }) });
  await assert.rejects(() => createWanSpaceProvider(ENV_TEXT, badImage.fake).submit(request()), { code: "quota_exhausted" });
  assert.equal(badImage.seen.some((s) => s.url.endsWith("/gradio_api/upload")), false);
});

test("poll returns the video when the stream completes, stops when the caller cancels, and fails on an empty stream", async () => {
  const streamOf = (text: string) =>
    (async () => new Response(text, { status: 200 })) as unknown as typeof fetch;
  const done = createWanSpaceProvider(
    ENV,
    streamOf(`event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"url":"${BASE}/v.mp4"},1]\n\n`),
  );
  assert.deepEqual(await done.poll("e1"), { state: "succeeded", videoUrl: `${BASE}/v.mp4` });

  const silent = createWanSpaceProvider(
    ENV,
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

  const closedEmpty = createWanSpaceProvider(ENV, streamOf(""));
  const result = await closedEmpty.poll("e3");
  assert.equal(result.state === "failed" && result.code, "bad_response");
});
