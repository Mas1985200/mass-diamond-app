// tests/web/widen-today.test.ts
// A news search with nothing from today is repeated in the language of the
// place, even when its best page scores well: the same story is often
// published today in the place's own language first. The network is replaced
// by a fake fetch.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const HEADLINES = [
  "alpha bravo charlie delta",
  "echo foxtrot golf hotel",
  "india juliet kilo lima",
  "mike november oscar papa",
  "quebec romeo sierra tango",
  "uniform victor whiskey xray",
];

function story(n: number, day: string) {
  return {
    title: HEADLINES[n] ?? `unique${n} words${n} here${n}`,
    url: `https://today${n}.example/story`,
    content: `Body ${n}`,
    score: 0.9,
    published_date: day,
  };
}

function reply(results: readonly unknown[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const signal = new AbortController().signal;

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
};

async function queriesFor(
  first: readonly unknown[],
  news: boolean,
  tag: string,
): Promise<string[]> {
  const original = globalThis.fetch;
  const queries: string[] = [];

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };

    queries.push(body.query);

    return reply(body.query === `${tag} first` ? first : [story(4, "2026-10-14")]);
  }) as typeof fetch;

  try {
    await runWebSearch(
      { query: `${tag} first`, local_query: `${tag} local`, news },
      context,
      signal,
    );
  } finally {
    globalThis.fetch = original;
  }

  return queries;
}

test("news with nothing from today is repeated in the local language", async () => {
  const old = [story(0, "2026-10-11"), story(1, "2026-10-12"), story(2, "2026-10-12")];

  assert.deepEqual(await queriesFor(old, true, "today-old"), [
    "today-old first",
    "today-old local",
  ]);
});

test("news with a page from today is not repeated", async () => {
  const fresh = [story(0, "2026-10-14"), story(1, "2026-10-12"), story(2, "2026-10-12")];

  assert.deepEqual(await queriesFor(fresh, true, "today-new"), [
    "today-new first",
  ]);
});

test("a search that is not about news is not repeated for lack of today's page", async () => {
  const old = [story(0, "2026-10-11"), story(1, "2026-10-12"), story(2, "2026-10-12")];

  assert.deepEqual(await queriesFor(old, false, "today-plain"), [
    "today-plain first",
  ]);
});
