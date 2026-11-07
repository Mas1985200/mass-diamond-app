// tests/video/video-registry.test.ts
// Which engine makes a video: "auto" with fallback order, a picked model that
// is never swapped silently, and the list for the model chooser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_MODEL,
  describeModels,
  selectProviders,
  usableProviders,
} from "../../supabase/functions/video-engine/providers/registry.ts";
import type {
  ProviderCapabilities,
  VideoProvider,
  VideoRequest,
} from "../../supabase/functions/video-engine/providers/types.ts";

const fake = (
  over: Partial<ProviderCapabilities>,
  keyName: string,
): VideoProvider => ({
  capabilities: {
    id: "x",
    label: "X",
    kinds: ["text_to_video", "image_to_video"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    maxDurationSeconds: 5,
    free: false,
    costMicroUsdPerSecond: 0,
    ...over,
  },
  isConfigured: (env) => Boolean(env[keyName]),
  submit: () => Promise.reject(new Error("not used")),
  poll: () => Promise.reject(new Error("not used")),
});

const paid = fake({ id: "paid", label: "Paid", maxDurationSeconds: 10, costMicroUsdPerSecond: 20000 }, "PAID_KEY");
const free = fake({ id: "free", label: "Free", free: true }, "FREE_KEY");
const imageOnly = fake({ id: "img", label: "Img", kinds: ["image_to_video"] }, "IMG_KEY");
const all = [paid, free, imageOnly];

const request = (over: Partial<VideoRequest> = {}): VideoRequest => ({
  kind: "text_to_video",
  prompt: "p",
  style: "auto",
  aspectRatio: "16:9",
  durationSeconds: 5,
  quality: "standard",
  imageUrls: [],
  ...over,
});

const ids = (list: readonly VideoProvider[]) => list.map((p) => p.capabilities.id);

test("auto uses every connected engine that can make the request, best first", () => {
  const env = { PAID_KEY: "1", FREE_KEY: "1", IMG_KEY: "1" };
  assert.deepEqual(ids(usableProviders(all, request(), env)), ["paid", "free"]);
  assert.deepEqual(ids(usableProviders(all, request({ kind: "image_to_video", imageUrls: ["u"] }), env)), ["paid", "free", "img"]);
});

test("auto skips engines without a key and engines that cannot do the length", () => {
  assert.deepEqual(ids(usableProviders(all, request(), { FREE_KEY: "1" })), ["free"]);
  const env = { PAID_KEY: "1", FREE_KEY: "1" };
  assert.deepEqual(ids(usableProviders(all, request({ durationSeconds: 8 }), env)), ["paid"]);
});

test("auto with nothing usable says so; blank and missing model mean auto", () => {
  assert.deepEqual(selectProviders(all, request(), {}, AUTO_MODEL), { ok: false, reason: "not_available" });
  const env = { FREE_KEY: "1" };
  for (const model of [undefined, null, "", "  ", "auto"]) {
    const result = selectProviders(all, request(), env, model);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && ids(result.providers), ["free"]);
  }
});

test("a picked model is used alone and never replaced silently", () => {
  const env = { PAID_KEY: "1", FREE_KEY: "1" };
  const picked = selectProviders(all, request(), env, "free");
  assert.deepEqual(picked.ok && ids(picked.providers), ["free"]);
  assert.deepEqual(selectProviders(all, request(), { FREE_KEY: "1" }, "paid"), { ok: false, reason: "not_available" });
  assert.deepEqual(selectProviders(all, request({ durationSeconds: 8 }), env, "free"), { ok: false, reason: "unsupported_request" });
  assert.deepEqual(selectProviders(all, request(), env, "nope"), { ok: false, reason: "unknown_model" });
});

test("the model list tells which engines are connected", () => {
  const list = describeModels(all, { FREE_KEY: "1" });
  assert.deepEqual(list.map((m) => [m.id, m.available]), [["paid", false], ["free", true], ["img", false]]);
  assert.equal(list[1].free, true);
});
