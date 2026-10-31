// tests/web/evidence-log.test.ts
// The web_evidence log line holds numbers only: what the search found, what the
// app kept, and how long each shown snippet is. Never the question or any text.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
};

test("web_evidence log: carries the snippet lengths and no page text", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const lines: string[] = [];

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Alpha bravo charlie delta",
            url: "https://one.example/a",
            content: "x".repeat(120),
            score: 0.9,
            published_date: "2026-10-14",
          },
          {
            title: "Echo foxtrot golf hotel",
            url: "https://two.example/b",
            content: "menu",
            score: 0.8,
            published_date: "2026-10-14",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  try {
    await runWebSearch(
      { query: "log-case league", news: true },
      context,
      new AbortController().signal,
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }

  const line = lines.find((entry) => entry.includes('"web_evidence"'));

  assert.ok(line, "a web_evidence line was logged");

  const logged = JSON.parse(line) as { snippetChars: number[] };

  assert.deepEqual([...logged.snippetChars].sort((a, b) => a - b), [4, 120]);
  assert.ok(!line.includes("log-case"), "the question is never logged");
  assert.ok(!line.includes("Alpha"), "no page text is logged");
});
