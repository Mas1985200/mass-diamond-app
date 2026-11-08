// tests/video/chat-video-args.test.ts
// What the model writes when it asks for a video: required parts, safe
// fallbacks for sloppy settings, and the limits. Pure code.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VIDEO_SECONDS,
  MAX_ENGINE_PROMPT_CHARS,
  MAX_IDEA_CHARS,
  MAX_VIDEO_SECONDS,
  parseCreateVideoArgs,
} from "../../supabase/functions/ai-chat/video/args.ts";

const good = { idea: "یک روباه در برف", engine_prompt: "A red fox walks through falling snow, cinematic." };

test("the idea and the engine prompt are required", () => {
  assert.equal(parseCreateVideoArgs({}).ok, false);
  assert.equal(parseCreateVideoArgs({ idea: "x" }).ok, false);
  assert.equal(parseCreateVideoArgs({ engine_prompt: "x" }).ok, false);
  assert.equal(parseCreateVideoArgs({ idea: "  ", engine_prompt: "x" }).ok, false);
  assert.equal(parseCreateVideoArgs({ idea: 5, engine_prompt: {} }).ok, false);
  const refused = parseCreateVideoArgs({ engine_prompt: "x" });
  assert.ok(!refused.ok && /idea/.test(refused.hint));
});

test("a good request gets the defaults for everything else", () => {
  const result = parseCreateVideoArgs(good);
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    idea: "یک روباه در برف",
    enginePrompt: "A red fox walks through falling snow, cinematic.",
    style: "auto",
    aspectRatio: "16:9",
    durationSeconds: DEFAULT_VIDEO_SECONDS,
    quality: "standard",
    model: "auto",
  });
});

test("every setting is read, in any letter case", () => {
  const result = parseCreateVideoArgs({
    ...good, style: "Cinematic", aspect_ratio: "9:16", duration_seconds: 3, quality: "HIGH", model: "hf-wan22-space",
  });
  assert.ok(result.ok);
  assert.equal(result.value.style, "cinematic");
  assert.equal(result.value.aspectRatio, "9:16");
  assert.equal(result.value.durationSeconds, 3);
  assert.equal(result.value.quality, "high");
  assert.equal(result.value.model, "hf-wan22-space");
});

test("the same shape is understood however it is written", () => {
  const shape = (aspect_ratio: unknown) => {
    const r = parseCreateVideoArgs({ ...good, aspect_ratio });
    assert.ok(r.ok);
    return r.value.aspectRatio;
  };
  for (const v of ["16:9", "16/9", "16x9", "16 : 9", "landscape", "Wide", "horizontal"]) assert.equal(shape(v), "16:9", String(v));
  for (const v of ["9:16", "9/16", "9x16", "vertical", "Portrait"]) assert.equal(shape(v), "9:16", String(v));
  for (const v of ["1:1", "1/1", "square"]) assert.equal(shape(v), "1:1", String(v));
  for (const v of ["4:3", "", 7, null, undefined]) assert.equal(shape(v), "16:9", String(v));
});

test("a sloppy setting falls back to a safe value, it never loses the idea", () => {
  const result = parseCreateVideoArgs({ ...good, style: "weird", quality: "ultra", model: "bad model!", duration_seconds: "abc" });
  assert.ok(result.ok);
  assert.equal(result.value.style, "auto");
  assert.equal(result.value.quality, "standard");
  assert.equal(result.value.model, "auto");
  assert.equal(result.value.durationSeconds, DEFAULT_VIDEO_SECONDS);
});

test("the length is a whole number from 1 up to the longest engine", () => {
  const len = (duration_seconds: unknown) => {
    const r = parseCreateVideoArgs({ ...good, duration_seconds });
    assert.ok(r.ok);
    return r.value.durationSeconds;
  };
  assert.equal(len(0), 1);
  assert.equal(len(-3), 1);
  assert.equal(len(2.6), 3);
  assert.equal(len("4"), 4);
  assert.equal(len(60), MAX_VIDEO_SECONDS);
  assert.equal(len(Number.POSITIVE_INFINITY), DEFAULT_VIDEO_SECONDS);
  assert.equal(len(null), DEFAULT_VIDEO_SECONDS);
  assert.equal(len(undefined), DEFAULT_VIDEO_SECONDS);
  assert.equal(len(""), DEFAULT_VIDEO_SECONDS);
});

test("overlong text is cut, never refused", () => {
  const result = parseCreateVideoArgs({ idea: "a".repeat(5000), engine_prompt: "b".repeat(5000) });
  assert.ok(result.ok);
  assert.equal(result.value.idea.length, MAX_IDEA_CHARS);
  assert.equal(result.value.enginePrompt.length, MAX_ENGINE_PROMPT_CHARS);
});
