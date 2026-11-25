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

test("the rule covers the engine prompt, changes and honesty", () => {
  assert.match(VIDEO_TOOL_RULE, /in English, 40 to 120 words/);
  assert.match(VIDEO_TOOL_RULE, /change, redo or vary/);
  assert.match(VIDEO_TOOL_RULE, /never say it is finished/);
  assert.match(VIDEO_TOOL_RULE, /real person's face/);
});

test("the rule makes the chat a director with a fixed order", () => {
  assert.match(VIDEO_TOOL_RULE, /film director/);
  assert.match(VIDEO_TOOL_RULE, /ask what the video is about and offer three short ideas/);
  assert.match(VIDEO_TOOL_RULE, /at most TWO short questions in ONE message, and only once/);
  assert.match(VIDEO_TOOL_RULE, /Never ask about shape, size, quality, length/);
  assert.match(VIDEO_TOOL_RULE, /\[\[choices: first \| second \| third\]\]/);
  assert.match(VIDEO_TOOL_RULE, /anything else to add/);
  assert.match(VIDEO_TOOL_RULE, /Call create_video only after they confirm/);
  assert.match(VIDEO_TOOL_RULE, /just make it/);
  assert.match(VIDEO_TOOL_RULE, /Never say you are making a video in a message where you did not call create_video/);
});

test("the rule is one line and tied to no single example", () => {
  assert.equal(VIDEO_TOOL_RULE.includes("\n"), false);
  assert.equal(/fox|cat|dog|sunset|car\b/i.test(VIDEO_TOOL_RULE), false);
});
