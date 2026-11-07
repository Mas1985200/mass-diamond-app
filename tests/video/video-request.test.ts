// tests/video/video-request.test.ts
// The checks on a "make a video" request: defaults for what is absent, a clear
// refusal for what is wrong, and no way to reach another person's files.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PROMPT_CHARS,
  parseVideoRequest,
} from "../../supabase/functions/video-engine/request.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const base = (over: Record<string, unknown> = {}) => ({
  client_request_id: REQ,
  prompt: "  a red fox in the snow  ",
  ...over,
});
const bad = (over: Record<string, unknown>) => parseVideoRequest(base(over), USER);

test("a minimal request gets the defaults and a trimmed idea", () => {
  const result = parseVideoRequest(base(), USER);
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    clientRequestId: REQ,
    conversationId: null,
    parentJobId: null,
    kind: "text_to_video",
    userPrompt: "a red fox in the snow",
    enginePrompt: null,
    style: "auto",
    aspectRatio: "16:9",
    durationSeconds: 5,
    quality: "standard",
    model: "auto",
    seed: null,
    imagePaths: [],
  });
});

test("every setting can be given, in any language of idea", () => {
  const conv = "33333333-3333-4333-8333-333333333333";
  const result = bad({
    prompt: "یک روباه قرمز در برف",
    engine_prompt: " A red fox ",
    style: "cinematic",
    aspect_ratio: "9:16",
    duration_seconds: 8,
    quality: "high",
    model: "hf-wan22-space",
    seed: 42,
    conversation_id: conv,
    parent_job_id: conv.toUpperCase(),
  });
  assert.ok(result.ok);
  assert.equal(result.value.userPrompt, "یک روباه قرمز در برف");
  assert.equal(result.value.enginePrompt, "A red fox");
  assert.equal(result.value.parentJobId, conv);
  assert.equal(result.value.aspectRatio, "9:16");
  assert.equal(result.value.seed, 42);
});

test("the request id and the idea are required", () => {
  assert.equal(parseVideoRequest(null, USER).ok, false);
  assert.equal(parseVideoRequest([], USER).ok, false);
  assert.deepEqual(parseVideoRequest({ prompt: "x" }, USER), { ok: false, field: "client_request_id", message: "A request id (uuid) is required." });
  assert.equal(bad({ client_request_id: "nope" }).ok, false);
  assert.equal(bad({ prompt: "   " }).ok, false);
  assert.equal(bad({ prompt: 5 }).ok, false);
  assert.equal(bad({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }).ok, false);
  assert.equal(bad({ prompt: "x".repeat(MAX_PROMPT_CHARS) }).ok, true);
});

test("a wrong value is refused, not replaced by a default", () => {
  for (const over of [
    { style: "weird" },
    { aspect_ratio: "4:3" },
    { quality: "ultra" },
    { duration_seconds: 0 },
    { duration_seconds: 61 },
    { duration_seconds: 2.5 },
    { duration_seconds: "5" },
    { model: "bad model!" },
    { model: "x".repeat(65) },
    { seed: -1 },
    { seed: 1.5 },
    { conversation_id: "abc" },
    { parent_job_id: 7 },
    { engine_prompt: 3 },
  ]) {
    const result = bad(over);
    assert.equal(result.ok, false, JSON.stringify(over));
    assert.equal(!result.ok && result.field, Object.keys(over)[0]);
  }
});

test("the kind follows the pictures and cannot disagree with them", () => {
  const a = `${USER}/uploads/a.png`;
  const b = `${USER}/uploads/b.png`;
  assert.equal(bad({ image_paths: [a] }).ok && bad({ image_paths: [a] }).value.kind, "image_to_video");
  assert.equal(bad({ image_paths: [a, b] }).ok && bad({ image_paths: [a, b] }).value.kind, "multi_image_to_video");
  assert.equal(bad({ kind: "image_to_video" }).ok, false);
  assert.equal(bad({ kind: "text_to_video", image_paths: [a] }).ok, false);
  assert.equal(bad({ kind: "image_to_video", image_paths: [a] }).ok, true);
});

test("pictures must be the owner's own, with no way out of the folder", () => {
  const other = "99999999-9999-4999-8999-999999999999";
  for (const path of [
    `${other}/uploads/a.png`,
    `${USER}/../${other}/a.png`,
    `${USER}/./a.png`,
    `${USER}//a.png`,
    `${USER}/`,
    USER,
    `${USER}\\a.png`,
    `${USER}/${"x".repeat(600)}`,
    42,
  ]) {
    assert.equal(bad({ image_paths: [path] }).ok, false, String(path));
  }
  assert.equal(bad({ image_paths: [`${USER}/uploads/a.png`, `${USER}/uploads/a.png`] }).ok, false);
  const many = Array.from({ length: 11 }, (_, i) => `${USER}/uploads/${i}.png`);
  assert.equal(bad({ image_paths: many }).ok, false);
  assert.equal(bad({ image_paths: "x" }).ok, false);
});
