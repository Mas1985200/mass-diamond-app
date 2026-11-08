// tests/video/chat-video-mode.test.ts
// The helpers of the video chat mode: reading the mode, the prompt block and
// the request key of a chat turn.

import test from "node:test";
import assert from "node:assert/strict";

import { parseMode, scopeToTurn, turnKeyOf, withVideoRules } from "../../supabase/functions/ai-chat/video/mode.ts";
import { VIDEO_TOOL_RULE } from "../../supabase/functions/ai-chat/video/rules.ts";
import type { VideoCreateOptions, VideoPort } from "../../supabase/functions/ai-chat/video/port.ts";

test("only the exact word video turns the mode on", () => {
  assert.equal(parseMode("video"), "video");
  for (const other of ["Video", "chat", "", null, undefined, 1, true, {}, ["video"]]) {
    assert.equal(parseMode(other), undefined);
  }
});

test("the video rule is added after the prompt and leaves it untouched", () => {
  const out = withVideoRules("BASE PROMPT");
  assert.ok(out.startsWith("BASE PROMPT\n\n"));
  assert.ok(out.endsWith(VIDEO_TOOL_RULE));
});

test("the same turn gives the same key; a later turn with the same words a new one", () => {
  const a = turnKeyOf("c1", 4, "یک روباه");
  assert.equal(a, turnKeyOf("c1", 4, "یک روباه"));
  assert.notEqual(a, turnKeyOf("c1", 6, "یک روباه"));
  assert.notEqual(a, turnKeyOf("c2", 4, "یک روباه"));
  assert.notEqual(a, turnKeyOf("c1", 4, "یک گربه"));
});

test("a scoped door adds the turn key to the request key and keeps everything else", async () => {
  const seen: VideoCreateOptions[] = [];
  const inner: VideoPort = {
    async create(_args, options) {
      seen.push(options);
      return { ok: false, code: "temporary", retryable: true };
    },
  };
  const scoped = scopeToTurn(inner, "turn-1");
  const args = { idea: "i", enginePrompt: "p", style: "auto", aspectRatio: "16:9", durationSeconds: 5, quality: "standard", model: null } as never;
  const result = await scoped.create(args, { requestKey: "k", parentJobId: "parent" });
  assert.equal(result.ok, false);
  assert.equal(seen[0].requestKey, "turn-1|k");
  assert.equal(seen[0].parentJobId, "parent");
});
