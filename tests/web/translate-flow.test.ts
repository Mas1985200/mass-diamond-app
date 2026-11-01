// tests/web/translate-flow.test.ts
// The second search in the language of the place: when it happens, and when it
// must not (a question that is not about a place, or a place that speaks the
// answer language).

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

// A weak first result, so that a wider search is wanted.
const WEAK = [
  { title: "Unrelated page", url: "https://a.com/x", content: "nothing here", score: 0.1 },
];

function run(args: Record<string, unknown>, tag: string) {
  const calls: { kind: "tavily" | "groq"; body: Record<string, unknown> }[] = [];
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;
  g.Deno = { env: { get: (k: string) => (k === "GROQ_API_KEY" ? "k" : undefined) } };
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (String(url).includes("tavily")) {
      calls.push({ kind: "tavily", body });
      return new Response(JSON.stringify({ results: WEAK.map((r) => ({ ...r, url: r.url + tag + calls.length })) }), { status: 200 });
    }
    calls.push({ kind: "groq", body });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ترجمه شده" } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  return runWebSearch(args, ctx, new AbortController().signal).then(
    () => calls,
    (e) => { throw e; },
  ).finally(() => {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
  });
}

test("a place that speaks another language gets a translated second search", async () => {
  const calls = await run(
    { query: "iran economy news", news: true, fresh: true, place_language: "fa", language: "es" },
    "a",
  );
  assert.equal(calls.filter((c) => c.kind === "groq").length, 1);
  const searches = calls.filter((c) => c.kind === "tavily");
  assert.equal(searches.length, 2);
  assert.equal(searches[1]?.body.query, "ترجمه شده");
});

test("a question that is not about a place never translates", async () => {
  const calls = await run(
    { query: "why is the sky blue", place_language: "es", language: "es" },
    "b",
  );
  assert.equal(calls.filter((c) => c.kind === "groq").length, 0);
  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});

test("a missing or invalid place_language never translates", async () => {
  const calls = await run(
    { query: "turkey politics news", news: true, fresh: true, place_language: "Persian", language: "es" },
    "c",
  );
  assert.equal(calls.filter((c) => c.kind === "groq").length, 0);
  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});
