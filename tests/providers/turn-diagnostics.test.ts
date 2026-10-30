// tests/providers/turn-diagnostics.test.ts
// For the logs only: how a model ended its turn and whether it sent reasoning.
// An empty answer is then explained by numbers (for example "length" with
// reasoning only), never by any text.

import test from "node:test";
import assert from "node:assert/strict";

import { readTurn } from "../../supabase/functions/ai-chat/providers/groq.ts";

function stream(chunks: readonly unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

async function run(chunks: readonly unknown[]) {
  const reader = readTurn(stream(chunks), "m");

  while (true) {
    const step = await reader.next();

    if (step.done) {
      return step.value;
    }
  }
}

test("a turn that only thought and ran out of room says so", async () => {
  const turn = await run([
    { choices: [{ delta: { reasoning: "thinking..." } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
  ]);

  assert.equal(turn.text, "");
  assert.equal(turn.finish, "length");
  assert.equal(turn.thought, true);
});

test("an ordinary answer reports how it stopped and no reasoning", async () => {
  const turn = await run([
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ]);

  assert.equal(turn.text, "Hello");
  assert.equal(turn.finish, "stop");
  assert.equal(turn.thought, undefined);
});

test("a stream with no stated end leaves the fields out", async () => {
  const turn = await run([{ choices: [{ delta: { content: "Hi" } }] }]);

  assert.equal(turn.finish, undefined);
  assert.equal(turn.thought, undefined);
});
