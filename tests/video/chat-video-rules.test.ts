// tests/video/chat-video-rules.test.ts
// The video prompt rule keeps its promises: facts that the tool really
// enforces are in it, and nothing in it depends on one example.

import test from "node:test";
import assert from "node:assert/strict";

import { VIDEO_TOOL_RULE } from "../../supabase/functions/ai-chat/video/rules.ts";
import { MAX_VIDEO_SECONDS } from "../../supabase/functions/ai-chat/video/args.ts";

test("the rule names the tool and states the real maximum length", () => {
  assert.match(VIDEO_TOOL_RULE, /^- create_video:/);
  assert.ok(VIDEO_TOOL_RULE.includes(`at most ${MAX_VIDEO_SECONDS} seconds`));
});

test("the rule covers the engine prompt, the one question, changes and honesty", () => {
  assert.match(VIDEO_TOOL_RULE, /in English, 40 to 120 words/);
  assert.match(VIDEO_TOOL_RULE, /ONE short question/);
  assert.match(VIDEO_TOOL_RULE, /change, redo or vary/);
  assert.match(VIDEO_TOOL_RULE, /never say it is finished/);
  assert.match(VIDEO_TOOL_RULE, /real person's face/);
});

test("the rule is one line and tied to no single example", () => {
  assert.equal(VIDEO_TOOL_RULE.includes("\n"), false);
  assert.equal(/fox|cat|dog|sunset|car\b/i.test(VIDEO_TOOL_RULE), false);
});
