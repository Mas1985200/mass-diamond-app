// tests/tools/registry-log.test.ts
// The tool log has the name, time, success and result count, never the text.

import test from "node:test";
import assert from "node:assert/strict";

import { executeTool } from "../../supabase/functions/ai-chat/tools/registry.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: undefined,
};

test("executeTool: logs name, success and count without the question", async () => {
  const lines: string[] = [];
  const original = console.log;

  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };

  try {
    const secret = "very private question 12345";
    const outcome = await executeTool(
      "web_search",
      JSON.stringify({ query: secret }),
      context,
      new AbortController().signal,
    );

    assert.deepEqual(outcome.data, { error: "Web search is not available." });

    const entry = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;

    assert.equal(entry.event, "tool");
    assert.equal(entry.name, "web_search");
    assert.equal(entry.ok, false);
    assert.equal(entry.results, 0);
    assert.equal(typeof entry.ms, "number");
    assert.ok(!lines.join("\n").includes(secret));
  } finally {
    console.log = original;
  }
});

test("executeTool: an unknown tool is an honest error and is logged", async () => {
  const lines: string[] = [];
  const original = console.log;

  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };

  try {
    const outcome = await executeTool(
      "nope",
      "{}",
      context,
      new AbortController().signal,
    );

    assert.deepEqual(outcome.data, { error: "Unknown tool: nope" });
    assert.equal(
      (JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>).ok,
      false,
    );
  } finally {
    console.log = original;
  }
});
