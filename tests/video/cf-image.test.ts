// tests/video/cf-image.test.ts
// The text-to-picture step: the secrets, the request body for every shape and
// model kind, and how every kind of answer or failure is read. A faked network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_SIZES,
  buildImageBody,
  generateImage,
  imageError,
  mimeOfBase64,
  readImageConfig,
} from "../../supabase/functions/video-engine/providers/cf-image.ts";
import { ProviderError } from "../../supabase/functions/video-engine/providers/types.ts";

const config = { accountId: "acc1", token: "tok", model: DEFAULT_IMAGE_MODEL };
const PNG_B64 = "iVBORw0KGgo" + "A".repeat(200);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the engine is configured only with both secrets, and the model can be changed", () => {
  assert.equal(readImageConfig({}), null);
  assert.equal(readImageConfig({ CF_ACCOUNT_ID: "a" }), null);
  assert.equal(readImageConfig({ CF_AI_TOKEN: "t" }), null);
  assert.deepEqual(readImageConfig({ CF_ACCOUNT_ID: " a ", CF_AI_TOKEN: " t " }), {
    accountId: "a",
    token: "t",
    model: DEFAULT_IMAGE_MODEL,
  });
  assert.equal(
    readImageConfig({ CF_ACCOUNT_ID: "a", CF_AI_TOKEN: "t", CF_IMAGE_MODEL: "@cf/x/y" })?.model,
    "@cf/x/y",
  );
});

test("a sized model gets the width and height of the shape", () => {
  for (const aspectRatio of ["16:9", "9:16", "1:1"] as const) {
    const body = buildImageBody(DEFAULT_IMAGE_MODEL, { prompt: "a fox", aspectRatio });
    const [width, height] = IMAGE_SIZES[aspectRatio];
    assert.equal(body.width, width);
    assert.equal(body.height, height);
    assert.equal((body.width as number) % 8, 0);
    assert.equal((body.height as number) % 8, 0);
  }
  const wide = IMAGE_SIZES["16:9"];
  const tall = IMAGE_SIZES["9:16"];
  assert.ok(wide[0] > wide[1]);
  assert.ok(tall[1] > tall[0]);
  assert.equal(IMAGE_SIZES["1:1"][0], IMAGE_SIZES["1:1"][1]);
});

test("a flux-1 model gets no size, the prompt is trimmed and cut, the seed is kept valid", () => {
  const body = buildImageBody("@cf/black-forest-labs/flux-1-schnell", {
    prompt: "  " + "x".repeat(3000) + "  ",
    aspectRatio: "16:9",
    seed: 123.9,
  });
  assert.equal("width" in body, false);
  assert.equal("height" in body, false);
  assert.equal((body.prompt as string).length, 1000);
  assert.equal(body.seed, 123);
  assert.equal(buildImageBody(DEFAULT_IMAGE_MODEL, { prompt: "a", aspectRatio: "1:1" }).seed, undefined);
  const odd = buildImageBody(DEFAULT_IMAGE_MODEL, { prompt: "a", aspectRatio: "1:1", seed: -5e12 });
  assert.ok((odd.seed as number) >= 0 && (odd.seed as number) < 2_147_483_647);
});

test("the picture type is found from the first bytes", () => {
  assert.equal(mimeOfBase64("/9j/4AAQ"), "image/jpeg");
  assert.equal(mimeOfBase64("iVBORw0KGgo"), "image/png");
  assert.equal(mimeOfBase64("UklGRiQ"), "image/webp");
  assert.equal(mimeOfBase64("zzzz"), "image/png");
});

test("a JSON answer with a base64 picture becomes a data link", async () => {
  let seenUrl = "";
  let seenBody = "";
  let seenAuth = "";
  const fake = (async (url: string, init: RequestInit) => {
    seenUrl = url;
    seenBody = String(init.body);
    seenAuth = (init.headers as Record<string, string>).Authorization;
    return jsonResponse({ success: true, result: { image: PNG_B64 } });
  }) as unknown as typeof fetch;
  const link = await generateImage(config, { prompt: "a fox", aspectRatio: "9:16" }, fake);
  assert.ok(link.startsWith("data:image/png;base64,iVBOR"));
  assert.ok(seenUrl.includes("/accounts/acc1/ai/run/@cf/bytedance/stable-diffusion-xl-lightning"));
  assert.equal(seenAuth, "Bearer tok");
  assert.equal(JSON.parse(seenBody).height, 1024);
});

test("an answer that is the picture itself becomes a data link", async () => {
  const bytes = new Uint8Array(300).fill(65);
  const fake = (async () =>
    new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
  const link = await generateImage(config, { prompt: "a fox", aspectRatio: "16:9" }, fake);
  assert.ok(link.startsWith("data:image/jpeg;base64,"));
  assert.equal(link, `data:image/jpeg;base64,${btoa("A".repeat(300))}`);
});

test("a result that is a plain base64 string works, and a ready data link is kept", async () => {
  const plain = (async () => jsonResponse({ success: true, result: PNG_B64 })) as unknown as typeof fetch;
  assert.ok((await generateImage(config, { prompt: "a", aspectRatio: "1:1" }, plain)).startsWith("data:image/png;base64,"));
  const ready = "data:image/webp;base64," + "B".repeat(200);
  const kept = (async () => jsonResponse({ success: true, result: { image: ready } })) as unknown as typeof fetch;
  assert.equal(await generateImage(config, { prompt: "a", aspectRatio: "1:1" }, kept), ready);
});

test("an answer without a real picture is an error, never a made-up picture", async () => {
  for (const body of [{ success: true, result: {} }, { success: true, result: { image: "tiny" } }, null]) {
    const fake = (async () => jsonResponse(body)) as unknown as typeof fetch;
    await assert.rejects(
      generateImage(config, { prompt: "a", aspectRatio: "1:1" }, fake),
      (e: unknown) => e instanceof ProviderError && e.code === "bad_response" && e.retryable,
    );
  }
  const empty = (async () =>
    new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  await assert.rejects(
    generateImage(config, { prompt: "a", aspectRatio: "1:1" }, empty),
    (e: unknown) => e instanceof ProviderError && e.code === "bad_response",
  );
});

test("every failure gets a clear code and the right retry advice", () => {
  const code = (status: number, text = "") => {
    const e = imageError(status, text);
    return [e.code, e.retryable];
  };
  assert.deepEqual(code(400, "you have used up your daily free allocation of 10,000 neurons"), ["quota_exhausted", false]);
  assert.deepEqual(code(400, "NSFW content detected"), ["content_rejected", false]);
  assert.deepEqual(code(401), ["engine_error", false]);
  assert.deepEqual(code(403), ["engine_error", false]);
  assert.deepEqual(code(429), ["rate_limited", true]);
  assert.deepEqual(code(503), ["engine_busy", true]);
  assert.deepEqual(code(400, "something else"), ["engine_error", false]);
});

test("an HTTP error answer is read from its error list", async () => {
  const fake = (async () =>
    jsonResponse({ success: false, errors: [{ code: 4006, message: "daily free allocation used" }] }, 400)) as unknown as typeof fetch;
  await assert.rejects(
    generateImage(config, { prompt: "a", aspectRatio: "1:1" }, fake),
    (e: unknown) => e instanceof ProviderError && e.code === "quota_exhausted",
  );
});

test("a failed network call is a retryable timeout", async () => {
  const fake = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  await assert.rejects(
    generateImage(config, { prompt: "a", aspectRatio: "1:1" }, fake),
    (e: unknown) => e instanceof ProviderError && e.code === "timeout" && e.retryable,
  );
});
