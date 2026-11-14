// tests/video/video-models.test.ts
// The pure rules of the video model chooser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_MODEL_ID,
  creditsForVideo,
  DEFAULT_CREDITS_PER_SECOND,
  MAX_MODELS,
  modelChoices,
  modelToSend,
  parseModelsAnswer,
  resolveChoice,
  type VideoModel,
} from "../../src/features/video/videoModels.ts";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "fal-wan22",
  label: "Wan 2.2",
  free: false,
  available: true,
  kinds: ["text_to_video"],
  aspectRatios: ["16:9", "9:16", "1:1"],
  maxDurationSeconds: 5,
  ...over,
});

const answer = (models: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  default: "auto",
  models,
  ...extra,
});

function models(body: unknown): readonly VideoModel[] {
  const result = parseModelsAnswer(body);
  assert.equal(result.ok, true);
  return result.ok ? result.models : [];
}

test("a good answer is read", () => {
  const list = models(answer([raw(), raw({ id: "hf-wan22-space", label: "Wan 2.2 (free)", free: true, kinds: ["text_to_video", "image_to_video"] })]));
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "fal-wan22");
  assert.equal(list[0].textToVideo, true);
  assert.equal(list[0].imageToVideo, false);
  assert.equal(list[1].free, true);
  assert.equal(list[1].imageToVideo, true);
  assert.deepEqual(list[0].aspectRatios, ["16:9", "9:16", "1:1"]);
});

test("a broken answer is not ok", () => {
  for (const body of [null, undefined, 5, "x", [], {}, { ok: false }, { ok: true }, { ok: true, models: "x" }]) {
    assert.deepEqual(parseModelsAnswer(body), { ok: false });
  }
});

test("bad entries are dropped and the rest is made safe", () => {
  const list = models(
    answer([
      null,
      "x",
      raw({ id: "" }),
      raw({ id: "bad id!" }),
      raw({ id: "../evil" }),
      raw({ id: "auto" }),
      raw({ id: "AUTO" }),
      raw({ id: "a".repeat(65) }),
      raw({ id: "ok-1", label: "  " }),
      raw({ id: "ok-1", label: "duplicate" }),
      raw({ id: "ok-2", label: "x".repeat(100), maxDurationSeconds: 9999, aspectRatios: ["4:3", "16:9", "16:9"], kinds: "nope", available: "yes", free: 1 }),
    ]),
  );
  assert.deepEqual(list.map((m) => m.id), ["ok-1", "ok-2"]);
  assert.equal(list[0].label, "ok-1");
  assert.equal(list[1].label.length, 40);
  assert.equal(list[1].maxDurationSeconds, 60);
  assert.deepEqual(list[1].aspectRatios, ["16:9"]);
  assert.equal(list[1].available, false);
  assert.equal(list[1].free, false);
  assert.equal(list[1].textToVideo, false);
});

test("a missing or wrong duration becomes a safe number", () => {
  assert.equal(models(answer([raw({ maxDurationSeconds: undefined })]))[0].maxDurationSeconds, 5);
  assert.equal(models(answer([raw({ maxDurationSeconds: 0 })]))[0].maxDurationSeconds, 1);
  assert.equal(models(answer([raw({ maxDurationSeconds: NaN })]))[0].maxDurationSeconds, 5);
});

test("the list is never longer than the limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => raw({ id: `m${i}` }));
  assert.equal(models(answer(many)).length, MAX_MODELS);
});

test("prices are read, clamped and defaulted", () => {
  const good = parseModelsAnswer(answer([], { creditsPerSecond: { draft: 1, standard: 2.2, high: 5 } }));
  assert.equal(good.ok && good.creditsPerSecond.standard, 3);
  assert.equal(good.ok && good.creditsPerSecond.high, 5);
  const bad = parseModelsAnswer(answer([], { creditsPerSecond: { draft: -4, standard: "x", high: 1e9 } }));
  assert.deepEqual(bad.ok && bad.creditsPerSecond, DEFAULT_CREDITS_PER_SECOND);
  const none = parseModelsAnswer(answer([]));
  assert.deepEqual(none.ok && none.creditsPerSecond, DEFAULT_CREDITS_PER_SECOND);
});

test("the choices start with Auto and follow the language", () => {
  const list = models(answer([raw(), raw({ id: "other", available: false })]));
  const fa = modelChoices(list, "fa");
  assert.equal(fa[0].id, AUTO_MODEL_ID);
  assert.equal(fa[0].label, "خودکار");
  assert.equal(fa[0].available, true);
  assert.deepEqual(fa.map((c) => c.id), ["auto", "fal-wan22", "other"]);
  assert.equal(modelChoices(list, "en")[0].label, "Auto");
});

test("Auto is not pickable when no model is connected", () => {
  assert.equal(modelChoices([], "en")[0].available, false);
  assert.equal(modelChoices(models(answer([raw({ available: false })])), "en")[0].available, false);
});

test("a saved choice is kept only while it is usable", () => {
  const list = models(answer([raw(), raw({ id: "off", available: false })]));
  assert.equal(resolveChoice("fal-wan22", list), "fal-wan22");
  assert.equal(resolveChoice("off", list), AUTO_MODEL_ID);
  assert.equal(resolveChoice("gone", list), AUTO_MODEL_ID);
  assert.equal(resolveChoice("", list), AUTO_MODEL_ID);
  assert.equal(resolveChoice(null, list), AUTO_MODEL_ID);
  assert.equal(resolveChoice(undefined, list), AUTO_MODEL_ID);
  assert.equal(resolveChoice("AUTO", list), AUTO_MODEL_ID);
  assert.equal(resolveChoice("fal-wan22", []), AUTO_MODEL_ID);
});

test("Auto sends nothing and a model sends its id", () => {
  assert.equal(modelToSend("auto"), null);
  assert.equal(modelToSend(" Auto "), null);
  assert.equal(modelToSend(""), null);
  assert.equal(modelToSend("fal-wan22"), "fal-wan22");
});

test("the price follows the server's rule", () => {
  assert.equal(creditsForVideo(5, "standard"), 10);
  assert.equal(creditsForVideo(5, "draft"), 5);
  assert.equal(creditsForVideo(5, "high"), 15);
  assert.equal(creditsForVideo(4.2, "standard"), 10);
  assert.equal(creditsForVideo(0, "standard"), 2);
  assert.equal(creditsForVideo(NaN, "high"), 3);
  assert.equal(creditsForVideo(5, "weird"), 10);
  assert.equal(creditsForVideo(2, "high", { draft: 1, standard: 4, high: 9 }), 18);
});

// end of video-models.test.ts
