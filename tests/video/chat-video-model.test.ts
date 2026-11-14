// tests/video/chat-video-model.test.ts
// The video model the person picked in the app: reading it from the request
// and making it win over the chat model's own guess.

import test from "node:test";
import assert from "node:assert/strict";

import { parseVideoModel, pinModel } from "../../supabase/functions/ai-chat/video/mode.ts";
import type { VideoPort, VideoCreateResult } from "../../supabase/functions/ai-chat/video/port.ts";
import type { CreateVideoArgs } from "../../supabase/functions/ai-chat/video/args.ts";

test("a plain model id is accepted", () => {
  assert.equal(parseVideoModel("fal-wan22"), "fal-wan22");
  assert.equal(parseVideoModel("  hf-wan22-space  "), "hf-wan22-space");
  assert.equal(parseVideoModel("a.b_c-1"), "a.b_c-1");
});

test("auto, nothing and anything that is not a plain id mean no pick", () => {
  for (const value of [undefined, null, 5, {}, [], "", "  ", "auto", " AUTO ", "a b", "../x", "x?y=1", "a".repeat(65), "<b>"]) {
    assert.equal(parseVideoModel(value), undefined);
  }
});

const RESULT: VideoCreateResult = {
  ok: true,
  jobId: "j",
  status: "queued",
  existing: false,
  aspectRatio: "16:9",
  durationSeconds: 5,
  quality: "standard",
  creditsCharged: 10,
};

function recorder(): { port: VideoPort; seen: CreateVideoArgs[]; keys: string[] } {
  const seen: CreateVideoArgs[] = [];
  const keys: string[] = [];
  const port: VideoPort = {
    create: async (args, options) => {
      seen.push(args);
      keys.push(options.requestKey);
      return RESULT;
    },
  };
  return { port, seen, keys };
}

const ARGS = {
  idea: "a cat",
  enginePrompt: "A cat plays in the snow",
  style: "auto",
  aspectRatio: "16:9",
  durationSeconds: 5,
  quality: "standard",
  model: "auto",
} as unknown as CreateVideoArgs;

test("a picked model wins over the chat model's guess", async () => {
  const { port, seen, keys } = recorder();
  const result = await pinModel(port, "fal-wan22").create(
    { ...ARGS, model: "something-else" } as CreateVideoArgs,
    { requestKey: "k1" },
  );
  assert.equal(result, RESULT);
  assert.equal(seen[0].model, "fal-wan22");
  assert.equal(seen[0].enginePrompt, "A cat plays in the snow");
  assert.equal(keys[0], "k1");
});

test("without a pick the port is used as it is", () => {
  const { port } = recorder();
  assert.equal(pinModel(port, undefined), port);
  assert.equal(pinModel(port, ""), port);
});

// end of chat-video-model.test.ts
