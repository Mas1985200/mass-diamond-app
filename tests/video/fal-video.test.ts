import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFalInput,
  createFalVideoProvider,
  decodeHandle,
  encodeHandle,
  extractFalVideoUrl,
  falError,
  falErrorText,
  isFalUrl,
  readFalConfig,
  DEFAULT_FAL_MODEL,
} from "../../supabase/functions/video-engine/providers/fal-video.ts";
import {
  ProviderError,
  type VideoRequest,
} from "../../supabase/functions/video-engine/providers/types.ts";

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  kind: "text_to_video",
  prompt: "  A cat plays in the snow  ",
  style: "auto",
  aspectRatio: "16:9",
  durationSeconds: 5,
  quality: "standard",
  imageUrls: [],
  ...over,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("the config needs a clean key and falls back to the default model", () => {
  assert.equal(readFalConfig({}), null);
  assert.equal(readFalConfig({ FAL_KEY: "  " }), null);
  assert.equal(readFalConfig({ FAL_KEY: "ab cd" }), null);
  assert.equal(readFalConfig({ FAL_KEY: "ab\ncd" }), null);
  assert.equal(readFalConfig({ FAL_KEY: "key\u200F" }), null);
  const ok = readFalConfig({ FAL_KEY: " id:secret " });
  assert.deepEqual(ok, { key: "id:secret", model: DEFAULT_FAL_MODEL });
  assert.equal(
    readFalConfig({ FAL_KEY: "k", FAL_VIDEO_MODEL: "fal-ai/other/model" })?.model,
    "fal-ai/other/model",
  );
  assert.equal(
    readFalConfig({ FAL_KEY: "k", FAL_VIDEO_MODEL: "../evil?x=1" })?.model,
    DEFAULT_FAL_MODEL,
  );
});

test("the input follows the request", () => {
  const input = buildFalInput(request());
  assert.equal(input.prompt, "A cat plays in the snow");
  assert.equal(input.num_frames, 121);
  assert.equal(input.frames_per_second, 24);
  assert.equal(input.resolution, "720p");
  assert.equal(input.aspect_ratio, "16:9");
  assert.equal(input.num_inference_steps, 30);
  assert.equal(input.enable_safety_checker, true);
  assert.equal(input.enable_output_safety_checker, true);
  assert.equal("seed" in input, false);
});

test("quality, ratio, duration and seed are always safe values", () => {
  assert.equal(buildFalInput(request({ quality: "draft" })).resolution, "580p");
  assert.equal(buildFalInput(request({ quality: "high" })).num_inference_steps, 40);
  assert.equal(buildFalInput(request({ aspectRatio: "9:16" })).aspect_ratio, "9:16");
  assert.equal(buildFalInput(request({ durationSeconds: 99 })).num_frames, 121);
  assert.equal(buildFalInput(request({ durationSeconds: 0 })).num_frames, 25);
  assert.equal(buildFalInput(request({ durationSeconds: NaN })).num_frames, 121);
  assert.equal(buildFalInput(request({ seed: -42.9 })).seed, 43);
  assert.equal(buildFalInput(request({ seed: NaN })).seed, undefined);
});

test("only fal addresses are trusted", () => {
  assert.equal(isFalUrl("https://queue.fal.run/a/b"), true);
  assert.equal(isFalUrl("https://x.fal.run/a"), true);
  assert.equal(isFalUrl("http://queue.fal.run/a"), false);
  assert.equal(isFalUrl("https://fal.run.evil.com/a"), false);
  assert.equal(isFalUrl("https://evilfal.run/a"), false);
  assert.equal(isFalUrl("nonsense"), false);
  assert.equal(isFalUrl(5), false);
});

test("the job handle survives a round trip and refuses bad links", () => {
  const handle = {
    statusUrl: "https://queue.fal.run/fal-ai/wan/requests/1/status",
    resultUrl: "https://queue.fal.run/fal-ai/wan/requests/1",
  };
  assert.deepEqual(decodeHandle(encodeHandle(handle)), handle);
  assert.equal(decodeHandle("nonsense"), null);
  assert.equal(decodeHandle('{"s":"https://evil.com/a","r":"https://queue.fal.run/b"}'), null);
});

test("error texts are read from both fal shapes", () => {
  assert.equal(falErrorText({ detail: "plain" }), "plain");
  assert.equal(
    falErrorText({ detail: [{ type: "content_policy_violation", msg: "no" }] }),
    "content_policy_violation: no",
  );
  assert.equal(falErrorText({ message: "m" }), "m");
  assert.equal(falErrorText(null), "");
});

test("failed answers become honest codes", () => {
  assert.equal(falError(422, "content_policy_violation: x", "r").code, "content_rejected");
  assert.equal(falError(403, "Exhausted balance. User is locked", "s").code, "quota_exhausted");
  assert.equal(falError(402, "", "s").code, "quota_exhausted");
  assert.equal(falError(401, "", "s").code, "engine_error");
  assert.equal(falError(429, "", "s").retryable, true);
  assert.equal(falError(422, "bad value", "s").code, "unsupported_request");
  assert.equal(falError(503, "", "s").code, "engine_busy");
  assert.equal(falError(418, "", "s").code, "engine_error");
});

test("the video link is read and must be https", () => {
  assert.equal(extractFalVideoUrl({ video: { url: "https://v3.fal.media/a.mp4" } }), "https://v3.fal.media/a.mp4");
  assert.equal(extractFalVideoUrl({ video: { url: "http://x/a.mp4" } }), null);
  assert.equal(extractFalVideoUrl({ video: {} }), null);
  assert.equal(extractFalVideoUrl(null), null);
});

test("submit sends the key and returns a handle with fal's own links", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = createFalVideoProvider({ FAL_KEY: "id:secret" }, async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return json({
      request_id: "r1",
      status_url: "https://queue.fal.run/fal-ai/wan/requests/r1/status",
      response_url: "https://queue.fal.run/fal-ai/wan/requests/r1",
    });
  });
  const result = await provider.submit(request());
  assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/wan/v2.2-5b/text-to-video");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Key id:secret");
  assert.equal(JSON.parse(String(calls[0].init.body)).prompt, "A cat plays in the snow");
  assert.equal(decodeHandle(result.providerJobId)?.statusUrl, "https://queue.fal.run/fal-ai/wan/requests/r1/status");
});

test("submit builds the links itself when fal sends only an id", async () => {
  const provider = createFalVideoProvider({ FAL_KEY: "k" }, async () => json({ request_id: "r 2" }));
  const result = await provider.submit(request());
  assert.equal(
    decodeHandle(result.providerJobId)?.statusUrl,
    "https://queue.fal.run/fal-ai/wan/v2.2-5b/text-to-video/requests/r%202/status",
  );
});

test("submit reports clear errors", async () => {
  const fail = (status: number, body: unknown) =>
    createFalVideoProvider({ FAL_KEY: "k" }, async () => json(body, status));
  await assert.rejects(
    fail(403, { detail: "Exhausted balance" }).submit(request()),
    (e: unknown) => e instanceof ProviderError && e.code === "quota_exhausted" && !e.retryable,
  );
  await assert.rejects(
    createFalVideoProvider({ FAL_KEY: "k" }, async () => json({})).submit(request()),
    (e: unknown) => e instanceof ProviderError && e.code === "bad_response",
  );
  await assert.rejects(
    createFalVideoProvider({}).submit(request()),
    (e: unknown) => e instanceof ProviderError && e.code === "not_configured",
  );
  await assert.rejects(
    createFalVideoProvider({ FAL_KEY: "k" }).submit(request({ kind: "image_to_video" })),
    (e: unknown) => e instanceof ProviderError && e.code === "unsupported_request",
  );
});

test("a network failure is a retryable timeout with the real reason", async () => {
  const provider = createFalVideoProvider({ FAL_KEY: "k" }, async () => {
    throw new TypeError("connection reset");
  });
  await assert.rejects(
    provider.submit(request()),
    (e: unknown) =>
      e instanceof ProviderError &&
      e.code === "timeout" &&
      e.retryable &&
      e.message.includes("connection reset"),
  );
});

const handleText = encodeHandle({
  statusUrl: "https://queue.fal.run/fal-ai/wan/requests/r1/status",
  resultUrl: "https://queue.fal.run/fal-ai/wan/requests/r1",
});

test("poll says running while queued or in progress", async () => {
  for (const status of ["IN_QUEUE", "IN_PROGRESS"]) {
    const provider = createFalVideoProvider({ FAL_KEY: "k" }, async () => json({ status }));
    assert.deepEqual(await provider.poll(handleText), { state: "running" });
  }
});

test("poll returns the video when completed", async () => {
  const urls: string[] = [];
  const provider = createFalVideoProvider({ FAL_KEY: "k" }, async (url) => {
    urls.push(String(url));
    return String(url).endsWith("/status")
      ? json({ status: "COMPLETED" })
      : json({ video: { url: "https://v3.fal.media/f.mp4" }, seed: 1 });
  });
  assert.deepEqual(await provider.poll(handleText), {
    state: "succeeded",
    videoUrl: "https://v3.fal.media/f.mp4",
  });
  assert.equal(urls.length, 2);
});

test("poll turns a failed job into a failed result", async () => {
  const provider = createFalVideoProvider({ FAL_KEY: "k" }, async (url) =>
    String(url).endsWith("/status")
      ? json({ status: "COMPLETED" })
      : json({ detail: [{ type: "content_policy_violation", msg: "x" }] }, 422),
  );
  const result = await provider.poll(handleText);
  assert.equal(result.state, "failed");
  if (result.state === "failed") {
    assert.equal(result.code, "content_rejected");
    assert.equal(result.retryable, false);
  }
});

test("poll handles a missing video, a bad handle and an unknown status", async () => {
  const noVideo = createFalVideoProvider({ FAL_KEY: "k" }, async (url) =>
    String(url).endsWith("/status") ? json({ status: "COMPLETED" }) : json({}),
  );
  const a = await noVideo.poll(handleText);
  assert.equal(a.state === "failed" && a.code, "bad_response");

  const bad = await createFalVideoProvider({ FAL_KEY: "k" }).poll("nonsense");
  assert.equal(bad.state === "failed" && bad.retryable, false);

  const odd = createFalVideoProvider({ FAL_KEY: "k" }, async () => json({ status: "???" }));
  await assert.rejects(odd.poll(handleText), (e: unknown) => e instanceof ProviderError && e.code === "bad_response");
});

test("poll never sends the key to a foreign address", async () => {
  const provider = createFalVideoProvider({ FAL_KEY: "k" }, async () => {
    throw new Error("must not be called");
  });
  const result = await provider.poll('{"s":"https://evil.com/a","r":"https://evil.com/b"}');
  assert.equal(result.state, "failed");
});

test("the engine is configured only with a key", () => {
  const provider = createFalVideoProvider({});
  assert.equal(provider.isConfigured({}), false);
  assert.equal(provider.isConfigured({ FAL_KEY: "k" }), true);
  assert.equal(provider.capabilities.free, false);
  assert.deepEqual([...provider.capabilities.kinds], ["text_to_video"]);
});

// end of fal-video.test.ts
