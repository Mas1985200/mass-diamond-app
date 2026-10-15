// tests/agent/first-round.test.ts
// Which tools the first model round may use.

import test from "node:test";
import assert from "node:assert/strict";

import { firstRoundOptions } from "../../supabase/functions/ai-chat/agent.ts";
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

const all = [
  tool("get_datetime"),
  tool("find_place"),
  tool("web_search"),
  tool("get_market_prices"),
  tool("remember"),
];

const say = (text: string): AIMessage[] => [{ role: "user", content: text }];

function names(options: ReturnType<typeof firstRoundOptions>): string[] {
  return options ? options.tools.map((item) => item.function.name) : [];
}

test("fresh question: only the web tools are offered and one is required", () => {
  const options = firstRoundOptions(say("latest news"), all, true);

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options), ["web_search", "get_market_prices"]);
});

test("not fresh or unknown: every tool, chosen by the model", () => {
  for (const fresh of [false, null] as const) {
    const options = firstRoundOptions(say("tell me a joke"), all, fresh);

    assert.ok(options);
    assert.equal(options.toolChoice, "auto");
    assert.equal(names(options).length, all.length);
  }
});

test("a place question still forces the map tool, even when fresh", () => {
  const options = firstRoundOptions(say("where is the Louvre"), all, true);

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options), ["find_place"]);
});

test("fresh but no web tool (no key): normal behaviour", () => {
  const options = firstRoundOptions(
    say("latest news"),
    all.filter((item) => item.function.name !== "web_search"),
    true,
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
});
