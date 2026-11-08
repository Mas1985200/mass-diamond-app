// tests/video/chat-video-tool.test.ts
// The create_video tool: what it sends to the video function, the card it
// shows, and what it tells the model for every outcome. A fake door, no network.

import test from "node:test";
import assert from "node:assert/strict";

import { CREATE_VIDEO_TOOL, runCreateVideo } from "../../supabase/functions/ai-chat/tools/video.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";
import type { CreateVideoArgs } from "../../supabase/functions/ai-chat/video/args.ts";
import type { VideoCreateOptions, VideoCreateResult, VideoPort } from "../../supabase/functions/ai-chat/video/port.ts";

function context(answer: VideoCreateResult | null, lang: "fa" | "en" = "fa") {
  const calls: Array<{ args: CreateVideoArgs; options: VideoCreateOptions }> = [];
  const video: VideoPort | null = answer
    ? { async create(args, options) { calls.push({ args, options }); return answer; } }
    : null;
  const ctx: ToolContext = { now: new Date(), timeZone: null, location: null, lang, tavilyKey: undefined, video };
  return { ctx, calls };
}

const good = { idea: "یک روباه", engine_prompt: "A red fox in snow", aspect_ratio: "9:16", duration_seconds: 4 };
const started: VideoCreateResult = {
  ok: true, jobId: "job-1", status: "processing", existing: false, aspectRatio: "9:16", durationSeconds: 4, quality: "standard", creditsCharged: 8,
};
const data = (o: { data: unknown }) => o.data as Record<string, unknown>;

test("the tool offers the model every setting and requires only the idea and the prompt", () => {
  const fn = CREATE_VIDEO_TOOL.function;
  assert.equal(fn.name, "create_video");
  const params = fn.parameters as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(Object.keys(params.properties).sort(), ["aspect_ratio", "duration_seconds", "engine_prompt", "idea", "model", "quality", "style"]);
  assert.deepEqual(params.required, ["idea", "engine_prompt"]);
});

test("a started video shows a card with the job and the settings, and tells the model what to say", async () => {
  const { ctx, calls } = context(started);
  const outcome = await runCreateVideo(good, ctx);
  assert.deepEqual(outcome.cards, [
    { t: "video", lang: "fa", jobId: "job-1", aspectRatio: "9:16", durationSeconds: 4, quality: "standard" },
  ]);
  assert.equal(data(outcome).status, "started");
  assert.match(String(data(outcome).hint), /never say it is finished/i);
  assert.equal(calls[0].args.enginePrompt, "A red fox in snow");
  assert.equal(calls[0].args.aspectRatio, "9:16");
});

test("the card follows the language of the chat", async () => {
  const { ctx } = context(started, "en");
  const outcome = await runCreateVideo(good, ctx);
  assert.equal((outcome.cards?.[0] as { lang: string }).lang, "en");
});

test("the model never sees the job id or the credits in its data", async () => {
  const { ctx } = context(started);
  const text = JSON.stringify((await runCreateVideo(good, ctx)).data);
  assert.equal(text.includes("job-1"), false);
  assert.equal(/credits_charged|creditsCharged/.test(text), false);
});

test("the same settings give the same request key, different settings a different one", async () => {
  const a = context(started);
  const b = context(started);
  const c = context(started);
  await runCreateVideo(good, a.ctx);
  await runCreateVideo({ ...good, idea: "a different sentence, same video" }, b.ctx);
  await runCreateVideo({ ...good, engine_prompt: "Another scene entirely" }, c.ctx);
  assert.equal(a.calls[0].options.requestKey, b.calls[0].options.requestKey);
  assert.notEqual(a.calls[0].options.requestKey, c.calls[0].options.requestKey);
});

test("a repeated request is reported as already started", async () => {
  const { ctx } = context({ ...started, existing: true });
  const outcome = await runCreateVideo(good, ctx);
  assert.equal(data(outcome).status, "already_started");
  assert.equal(outcome.cards?.length, 1);
});

test("no door means no video and no card; a bad request is explained to the model", async () => {
  const none = await runCreateVideo(good, context(null).ctx);
  assert.deepEqual(none.data, { status: "video_unavailable" });
  assert.equal(none.cards, undefined);
  const { ctx, calls } = context(started);
  const bad = await runCreateVideo({ idea: "x" }, ctx);
  assert.equal(data(bad).status, "invalid");
  assert.match(String(data(bad).hint), /engine_prompt/);
  assert.equal(calls.length, 0);
});

test("every failure gives the model a plain instruction and shows no card", async () => {
  const failures = ["quota_exceeded", "engine_unavailable", "unsupported", "invalid", "not_signed_in", "temporary"] as const;
  for (const code of failures) {
    const { ctx } = context({ ok: false, code, retryable: code === "temporary" });
    const outcome = await runCreateVideo(good, ctx);
    assert.equal(data(outcome).status, code);
    assert.equal(data(outcome).retryable, code === "temporary");
    assert.ok(String(data(outcome).hint).length > 20, code);
    assert.equal(outcome.cards, undefined);
  }
  const { ctx } = context({ ok: false, code: "quota_exceeded", retryable: false, quota: { used: 18, quota: 20, plan: "free" } });
  const quota = data(await runCreateVideo(good, ctx));
  assert.equal(quota.used, 18);
  assert.equal(quota.quota, 20);
});

test("a strange setting in the answer never breaks the card", async () => {
  const { ctx } = context({ ...started, aspectRatio: "weird", quality: "weird" });
  const card = (await runCreateVideo(good, ctx)).cards?.[0] as { aspectRatio: string; quality: string };
  assert.equal(card.aspectRatio, "16:9");
  assert.equal(card.quality, "standard");
});
