// tests/web/simplify-flow.test.ts
// A weak news search with no other language to try is repeated once as plain
// keywords; nothing else triggers that repeat.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const g = globalThis as unknown as Record<string, unknown>;

const ctx: ToolContext = {
  now: new Date("2026-11-01T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "t",
};

type Call = { kind: "tavily" | "groq"; body: Record<string, unknown> };

const weak = (tag: string) => [
  { title: `Loose page ${tag}`, url: `https://loose.example/${tag}`, content: "unrelated", published_date: "2026-11-01", score: 0.1 },
];

const strong = (tag: string) => [
  { title: `Plain keywords match ${tag}`, url: `https://strong.example/${tag}`, content: "The team won the cup final", published_date: "2026-11-01", score: 0.9 },
];

async function run(
  args: Record<string, unknown>,
  groq: () => Response,
): Promise<{ calls: Call[]; titles: string[] }> {
  const calls: Call[] = [];
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;
  const oldLog = console.log;

  g.Deno = { env: { get: (k: string) => (k === "GROQ_API_KEY" ? "k" : undefined) } };
  console.log = () => {};
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;

    if (String(url).includes("tavily")) {
      calls.push({ kind: "tavily", body });
      const plain = String(body.query).startsWith("plain");

      return new Response(
        JSON.stringify({ results: plain ? strong(String(calls.length)) : weak(String(calls.length)) }),
        { status: 200 },
      );
    }

    calls.push({ kind: "groq", body });

    return groq();
  }) as unknown as typeof fetch;

  try {
    const outcome = await runWebSearch(args, ctx, new AbortController().signal);
    const data = outcome.data as { results?: { title: string }[] };

    return { calls, titles: (data.results ?? []).map((r) => r.title) };
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

const answer = (text: string) => () =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

test("a weak news search is repeated once as plain keywords", async () => {
  const { calls, titles } = await run(
    { query: "long dated news question one", news: true, fresh: true },
    answer("plain keywords one"),
  );

  const searches = calls.filter((c) => c.kind === "tavily");

  assert.equal(searches.length, 2);
  assert.equal(searches[1]?.body.query, "plain keywords one");
  assert.ok(titles.some((t) => t.startsWith("Plain keywords match")));
});

test("when the keywords cannot be had the first search stands", async () => {
  const { calls } = await run(
    { query: "long dated news question two", news: true, fresh: true },
    () => new Response("no", { status: 500 }),
  );

  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});

test("a search that is not news is never simplified", async () => {
  const { calls } = await run({ query: "why is the sky blue three" }, answer("plain sky"));

  assert.equal(calls.filter((c) => c.kind === "groq").length, 0);
  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});

test("keywords equal to the search are not searched twice", async () => {
  const { calls } = await run(
    { query: "same words four", news: true, fresh: true },
    answer("same words four"),
  );

  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});
