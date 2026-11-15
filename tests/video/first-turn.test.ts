// tests/video/first-turn.test.ts
// In video mode the first message of the chat must start the video: the model
// is required to call create_video. Later messages stay free.

import test from "node:test";
import assert from "node:assert/strict";

import {
  firstRoundOptions,
  isFirstUserTurn,
} from "../../supabase/functions/ai-chat/agent.ts";
import type {
  AIMessage,
  ToolDefinition,
} from "../../supabase/functions/ai-chat/types.ts";

function tool(name: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    },
  };
}

const videoTools = [tool("create_video")];

const user = (content: string): AIMessage => ({ role: "user", content });
const assistant = (content: string): AIMessage => ({ role: "assistant", content });

test("the first user message is recognized, in any language", () => {
  assert.equal(isFirstUserTurn([user("یک گربه روی دیوار قدم می‌زند")]), true);
  assert.equal(isFirstUserTurn([user("a cat walking on a wall")]), true);
  assert.equal(
    isFirstUserTurn([user("one"), assistant("ok"), user("two")]),
    false,
  );
  assert.equal(isFirstUserTurn([]), false);
});

test("video mode, first message: create_video is required", () => {
  const options = firstRoundOptions(
    [user("یک گربه روی دیوار قدم می‌زند")],
    videoTools,
    "video",
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(
    options.tools.map((item) => item.function.name),
    ["create_video"],
  );
});

test("video mode, later messages: the model stays free to answer", () => {
  const options = firstRoundOptions(
    [user("a cat"), assistant("Making it."), user("how long is left?")],
    videoTools,
    "video",
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
});

test("other modes are not forced by this rule", () => {
  const options = firstRoundOptions([user("hello")], videoTools, null);

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
});

// end of first-turn.test.ts
