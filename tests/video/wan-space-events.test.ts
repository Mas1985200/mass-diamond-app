// tests/video/wan-space-events.test.ts
// An engine error also says which events came before it, so a failure can be
// located (never the content of the events).

import test from "node:test";
import assert from "node:assert/strict";

import {
  createWanSpaceProvider,
  eventNames,
  readOutcome,
} from "../../supabase/functions/video-engine/providers/wan-space.ts";

const BASE = "https://example-space.hf.space";

test("event names are listed once, in order, without their content", () => {
  const text =
    'event: heartbeat\ndata: null\n\nevent: heartbeat\ndata: null\n\nevent: generating\ndata: ["secret"]\n\nevent: error\ndata: "x"\n\n';
  assert.equal(eventNames(text), "heartbeat,generating,error");
  assert.equal(eventNames(""), "none");
});

test("the error message keeps the Space's words and adds the events", () => {
  const result = readOutcome(
    'event: heartbeat\ndata: null\n\nevent: error\ndata: "404: Not Found"\n\n',
    BASE,
  );
  assert.equal(result?.state, "failed");
  assert.ok(result?.state === "failed" && result.message.includes("404: Not Found"));
  assert.ok(result?.state === "failed" && result.message.endsWith("[events: heartbeat,error]"));
});

test("a broken or timed-out line is a failure that can be retried, never 'running'", async () => {
  const provider = createWanSpaceProvider(
    { HF_TOKEN: "t", HF_VIDEO_SPACE_URL: BASE },
    async () => {
      throw new TypeError("connection closed");
    },
  );
  const result = await provider.poll("event-1");
  assert.equal(result.state, "failed");
  assert.ok(result.state === "failed" && result.retryable);
  assert.ok(result.state === "failed" && result.message.includes("[events: none]"));
});

// end of wan-space-events.test.ts
