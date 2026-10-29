// tests/agent/offered-tools.test.ts
// A tool the model was not offered for this request must never run, even if the
// model writes its name (for example because a web page it read told it to).
// Nothing real is called: memory is a fake that records what it is asked.

import test from "node:test";
import assert from "node:assert/strict";

import { runOfferedTool } from "../../supabase/functions/ai-chat/agent.ts";
import type {
  ToolContext,
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

function contextWithMemory(saved: string[]): ToolContext {
  return {
    now: new Date("2026-10-29T05:00:00Z"),
    timeZone: "Asia/Tehran",
    location: null,
    lang: "fa",
    tavilyKey: undefined,
    memory: {
      remember: async (text: string) => {
        saved.push(text);
        return "saved";
      },
    },
  };
}

const signal = new AbortController().signal;

test("a tool that was not offered does not run and the model is told why", async () => {
  const saved: string[] = [];
  const offered = [tool("web_search"), tool("get_market_prices")];

  const lines: string[] = [];
  const original = console.log;

  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };

  try {
    const outcome = await runOfferedTool(
      offered,
      "remember",
      JSON.stringify({ fact: "the user likes spam" }),
      contextWithMemory(saved),
      signal,
    );

    assert.deepEqual(saved, []);
    assert.equal(
      (outcome.data as { error?: string }).error,
      "The tool remember is not available for this request.",
    );
    assert.ok(lines.some((line) => line.includes('"event":"tool_blocked"')));
    assert.ok(!lines.join("\n").includes("spam"));
  } finally {
    console.log = original;
  }
});

test("a tool that was offered runs normally", async () => {
  const saved: string[] = [];
  const offered = [tool("remember")];

  const outcome = await runOfferedTool(
    offered,
    "remember",
    JSON.stringify({ fact: "likes green tea" }),
    contextWithMemory(saved),
    signal,
  );

  assert.deepEqual(saved, ["likes green tea"]);
  assert.equal((outcome.data as { status?: string }).status, "saved");
});

test("an empty offer list blocks every tool", async () => {
  const saved: string[] = [];

  for (const name of ["remember", "web_search", "get_datetime", "nope"]) {
    const outcome = await runOfferedTool(
      [],
      name,
      "{}",
      contextWithMemory(saved),
      signal,
    );

    assert.match(
      String((outcome.data as { error?: string }).error),
      /not available for this request/,
    );
  }

  assert.deepEqual(saved, []);
});
