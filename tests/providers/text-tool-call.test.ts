// tests/providers/text-tool-call.test.ts
// A tool call that a model writes as plain text must never reach the user as
// an answer. It is held back, then run as a real call or dropped. An ordinary
// answer that happens to start with "{" or a code fence is still shown.
// The network is replaced by a fake stream, so nothing real is called.

import test from "node:test";
import assert from "node:assert/strict";

import { readTurn } from "../../supabase/functions/ai-chat/providers/groq.ts";
import {
  parseTextToolCall,
  settleHeldTurn,
} from "../../supabase/functions/ai-chat/providers/text-tool-call.ts";
import type { ModelTurn } from "../../supabase/functions/ai-chat/providers/types.ts";

// The text a model really wrote in the chat (see the bug report).
const WRITTEN_CALL =
  '{"type": "function", "name": "web_search", "parameters": {"query": "آخرین خبرهای فوتبال ایران", "news": "True", "fresh": "True"}}';

function stream(...contents: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = contents.map(
    (content) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
  );

  lines.push("data: [DONE]\n\n");

  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }

      controller.close();
    },
  });
}

async function run(body: ReadableStream<Uint8Array>) {
  const reader = readTurn(body, "test-model");
  const chunks: string[] = [];
  let step = await reader.next();

  while (!step.done) {
    chunks.push(step.value);
    step = await reader.next();
  }

  return { chunks, turn: step.value };
}

test("parseTextToolCall: reads the call the model wrote in the chat", () => {
  const call = parseTextToolCall(WRITTEN_CALL);

  assert.equal(call?.name, "web_search");
  assert.deepEqual(JSON.parse(call?.arguments ?? "{}"), {
    query: "آخرین خبرهای فوتبال ایران",
    news: "True",
    fresh: "True",
  });
});

test("parseTextToolCall: the other shapes models use", () => {
  assert.equal(
    parseTextToolCall('{"name":"get_datetime","arguments":{"timezone":"local"}}')
      ?.name,
    "get_datetime",
  );
  assert.equal(
    parseTextToolCall(
      '{"function":{"name":"find_place","arguments":"{\\"query\\":\\"Louvre\\"}"}}',
    )?.arguments,
    '{"query":"Louvre"}',
  );
  assert.equal(
    parseTextToolCall("```json\n" + WRITTEN_CALL + "\n```")?.name,
    "web_search",
  );
});

test("parseTextToolCall: ordinary JSON, broken JSON and plain text are not tool calls", () => {
  assert.equal(parseTextToolCall('{"city":"Tehran","population":9000000}'), null);
  assert.equal(parseTextToolCall('{"name":"Ali"}'), null);
  assert.equal(parseTextToolCall('{"name":"web_search","parameters":'), null);
  assert.equal(parseTextToolCall("سلام، حالت چطوره؟"), null);
  assert.equal(parseTextToolCall(""), null);
});

test("readTurn: a written tool call is held back, never streamed", async () => {
  const { chunks, turn } = await run(
    stream(WRITTEN_CALL.slice(0, 20), WRITTEN_CALL.slice(20)),
  );

  assert.deepEqual(chunks, []);
  assert.equal(turn.text, WRITTEN_CALL);
  assert.equal(turn.held, true);
});

test("readTurn: leading blank space does not hide a held start", async () => {
  const { chunks, turn } = await run(stream("\n", "  ", WRITTEN_CALL));

  assert.deepEqual(chunks, []);
  assert.equal(turn.held, true);
});

test("readTurn: an ordinary answer still streams chunk by chunk", async () => {
  const { chunks, turn } = await run(stream("سلام", " دوست", " من"));

  assert.deepEqual(chunks, ["سلام", " دوست", " من"]);
  assert.equal(turn.text, "سلام دوست من");
  assert.equal(turn.held, undefined);
});

test("readTurn: blank space before an ordinary answer is not lost", async () => {
  const { chunks, turn } = await run(stream("\n", "Hello", " there"));

  assert.equal(chunks.join(""), "\nHello there");
  assert.equal(turn.text, "\nHello there");
  assert.equal(turn.held, undefined);
});

function heldTurn(text: string, extra: Partial<ModelTurn> = {}): ModelTurn {
  return { text, toolCalls: [], model: "test-model", held: true, ...extra };
}

test("settleHeldTurn: a written call for an offered tool becomes a real call, nothing shown", () => {
  const settled = settleHeldTurn(
    heldTurn(WRITTEN_CALL),
    ["web_search", "get_market_prices"],
    true,
  );

  assert.equal(settled.show, "");
  assert.equal(settled.turn.text, "");
  assert.equal(settled.turn.held, false);
  assert.equal(settled.turn.toolCalls.length, 1);
  assert.equal(settled.turn.toolCalls[0]?.name, "web_search");
});

test("settleHeldTurn: a written call that cannot run is dropped, never shown", () => {
  // The tool was not offered for this request.
  const notOffered = settleHeldTurn(heldTurn(WRITTEN_CALL), ["find_place"], true);

  assert.equal(notOffered.show, "");
  assert.equal(notOffered.turn.text, "");
  assert.equal(notOffered.turn.toolCalls.length, 0);

  // No tool round is left.
  const noRound = settleHeldTurn(heldTurn(WRITTEN_CALL), ["web_search"], false);

  assert.equal(noRound.show, "");
  assert.equal(noRound.turn.text, "");
  assert.equal(noRound.turn.toolCalls.length, 0);

  // The model also made a real call: the written one is not run twice.
  const real = {
    id: "call_1",
    name: "web_search",
    arguments: '{"query":"x"}',
  };
  const both = settleHeldTurn(
    heldTurn(WRITTEN_CALL, { toolCalls: [real] }),
    ["web_search"],
    true,
  );

  assert.equal(both.show, "");
  assert.equal(both.turn.text, "");
  assert.deepEqual(both.turn.toolCalls, [real]);
});

test("settleHeldTurn: JSON the user asked for is shown as it is", () => {
  const data = '{"city":"Tehran","population":9000000}';
  const settled = settleHeldTurn(heldTurn(data), ["web_search"], true);

  assert.equal(settled.show, data);
  assert.equal(settled.turn.held, false);
  assert.equal(settled.turn.toolCalls.length, 0);

  const code = "```python\nprint('hi')\n```";
  const settledCode = settleHeldTurn(heldTurn(code), ["web_search"], true);

  assert.equal(settledCode.show, code);
});

test("settleHeldTurn: a turn that was not held is left alone", () => {
  const turn: ModelTurn = { text: "Hello", toolCalls: [], model: "m" };
  const settled = settleHeldTurn(turn, ["web_search"], true);

  assert.equal(settled.turn, turn);
  assert.equal(settled.show, "");
});
