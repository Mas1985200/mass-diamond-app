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

test("fresh: only the web tools are offered and one is required", () => {
  const options = firstRoundOptions(say("latest news"), all, "fresh");

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options), ["web_search", "get_market_prices"]);
});

test("unknown: every tool, chosen by the model", () => {
  const options = firstRoundOptions(say("tell me a joke"), all, null);

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
  assert.equal(names(options).length, all.length);
});

test("a place question still forces the map tool", () => {
  for (const capability of ["fresh", "place", null] as const) {
    const options = firstRoundOptions(
      say("where is the Louvre"),
      all,
      capability,
    );

    assert.ok(options);
    assert.equal(options.toolChoice, "required");
    assert.deepEqual(names(options), ["find_place"]);
  }
});

test("place by the router: the map tool is required", () => {
  const options = firstRoundOptions(say("Louvre opening hours address"), all, "place");

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options), ["find_place"]);
});

test("know: only the knowledge tool, and it is required", () => {
  const options = firstRoundOptions(
    say("how do black holes form"),
    [...all, tool("lookup_knowledge")],
    "know",
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options), ["lookup_knowledge"]);
});

test("time: only the clock tool, chosen by the model", () => {
  const options = firstRoundOptions(
    say("what time is it in Tokyo"),
    all.filter((item) => item.function.name === "get_datetime"),
    "time",
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
  assert.deepEqual(names(options), ["get_datetime"]);
});

test("chat without any tool: a single round without tools", () => {
  assert.equal(firstRoundOptions(say("tell me a joke"), [], "chat"), null);
});

test("fresh but no web tool (no key): normal behaviour", () => {
  const options = firstRoundOptions(
    say("latest news"),
    all.filter((item) => item.function.name !== "web_search"),
    "fresh",
  );

  assert.ok(options);
  assert.equal(options.toolChoice, "auto");
});
