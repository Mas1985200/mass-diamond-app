// tests/web/schedule-flow.test.ts
// A broad news answer may keep up to two timetables, apart from the news and
// marked as schedules; every other answer leaves timetables out as before.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import { TOOL_RESULT_CHAR_CAP } from "../../supabase/functions/ai-chat/config.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const g = globalThis as unknown as Record<string, unknown>;

const ctx: ToolContext = {
  now: new Date("2026-11-01T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "t",
};

let serial = 0;

const page = (kind: "news" | "table", day: string, snippet: string) => {
  serial += 1;

  return {
    title: `${kind === "table" ? "Timetable fixtures" : "Report"}${serial} alpha${serial} bravo${serial} charlie${serial}`,
    url: `https://site.example/${serial}`,
    content: snippet,
    published_date: day,
    score: 0.9,
  };
};

type Out = { results: Record<string, string>[]; note?: string };

async function run(
  args: Record<string, unknown>,
  aspects: string,
  fixture: { news: number; tables: number; newsDay?: string; snippet?: string },
): Promise<Out> {
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;
  const oldLog = console.log;

  g.Deno = { env: { get: (k: string) => (k === "GROQ_API_KEY" ? "k" : undefined) } };
  console.log = () => {};
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      messages?: { role: string; content: string }[];
    };

    if (String(url).includes("tavily")) {
      // The other sides of the subject each find one more news page.
      const query = (JSON.parse(init.body) as { query: string }).query;

      if (query.startsWith("side")) {
        return new Response(
          JSON.stringify({ results: [page("news", fixture.newsDay ?? "2026-11-01", "Another report")] }),
          { status: 200 },
        );
      }

      const results = [
        ...Array.from({ length: fixture.news }, () =>
          page("news", fixture.newsDay ?? "2026-11-01", fixture.snippet ?? "The team won the final match"),
        ),
        ...Array.from({ length: fixture.tables }, () => page("table", "2026-11-01", "Round 12 fixtures")),
      ];

      return new Response(JSON.stringify({ results }), { status: 200 });
    }

    const system = body.messages?.[0]?.content ?? "";
    const user = body.messages?.[1]?.content ?? "";
    let content = aspects;

    if (system.includes("You label web search results")) {
      content = user
        .split("\n")
        .map((line, index) => `${index + 1}: ${line.includes("Timetable") ? "SCHEDULE" : "EVENT"}`)
        .join("\n");
    }

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const outcome = await runWebSearch(args, ctx, new AbortController().signal);

    return outcome.data as Out;
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

// The other sides carry the name of their test: found pages are remembered for
// a few minutes by search words, and tests must not share them.
const sides = (tag: string, count = 3) =>
  ["a", "b", "c"].slice(0, count).map((id) => `side ${id} ${tag}`).join("\n");
const kinds = (data: Out) => data.results.map((item) => item.kind ?? "news");

test("a broad news answer keeps two timetables apart, after the news, marked as schedules", async () => {
  const data = await run(
    { query: "schedule broad one", news: true, fresh: true },
    sides("one"),
    { news: 2, tables: 2 },
  );
  const order = kinds(data);

  assert.equal(order.filter((kind) => kind === "schedule").length, 2);
  assert.deepEqual(order.slice(-2), ["schedule", "schedule"]);
  assert.ok(order.slice(0, -2).every((kind) => kind === "news"));
  assert.match(data.note ?? "", /kind schedule/);
});

test("at most two timetables are kept however many are found", async () => {
  const data = await run(
    { query: "schedule broad two", news: true, fresh: true },
    sides("two"),
    { news: 2, tables: 4 },
  );

  assert.equal(kinds(data).filter((kind) => kind === "schedule").length, 2);
});

test("a question that is not broad leaves timetables out as before", async () => {
  const data = await run(
    { query: "schedule narrow three", news: true, fresh: true },
    "NONE",
    { news: 4, tables: 2 },
  );

  assert.equal(kinds(data).filter((kind) => kind === "schedule").length, 0);
  assert.equal(data.results.length, 4);
  assert.doesNotMatch(data.note ?? "", /kind schedule/);
});

test("without enough news the answer stays the usual short one: no timetables", async () => {
  const data = await run(
    { query: "schedule thin four", news: true, fresh: true },
    sides("four", 2),
    { news: 1, tables: 2 },
  );

  assert.equal(kinds(data).filter((kind) => kind === "schedule").length, 0);
});

test("timetables dated today never make older news look like today's", async () => {
  const data = await run(
    { query: "schedule dates five", news: true, fresh: true },
    sides("five"),
    { news: 2, tables: 2, newsDay: "2026-10-30" },
  );

  assert.match(data.note ?? "", /None of these results is from today/);
});

test("the largest answer with timetables fits the tool-result cap", async () => {
  const data = await run(
    { query: "schedule largest six", news: true, fresh: true },
    sides("six"),
    { news: 4, tables: 4, snippet: "ک".repeat(2000) },
  );

  assert.equal(kinds(data).filter((kind) => kind === "schedule").length, 2);
  assert.ok(data.results.length <= 8);
  assert.ok(JSON.stringify({ data }).length <= TOOL_RESULT_CHAR_CAP);
});
