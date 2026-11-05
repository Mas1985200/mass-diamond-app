// tests/web/sources-search.test.ts
// News searches go first to the trusted sites of the country and field, and
// open up to the whole web only when those give too little.

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

const item = (tag: string, score: number) => ({
  title: `Cup final report ${tag}`,
  url: `https://site${tag}.example/${tag}`,
  content: `The team won the cup final ${tag}`,
  published_date: "2026-11-01",
  score,
});

async function run(
  args: Record<string, unknown>,
  limited: unknown[],
  open: unknown[],
): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;
  const oldLog = console.log;

  g.Deno = { env: { get: () => undefined } };
  console.log = () => {};
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;

    if (String(url).includes("tavily")) {
      bodies.push(body);

      return new Response(
        JSON.stringify({ results: body.include_domains ? limited : open }),
        { status: 200 },
      );
    }

    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;

  try {
    await runWebSearch(args, ctx, new AbortController().signal);

    return bodies;
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

test("enough strong results on trusted sites: one search, limited to them", async () => {
  const strong = ["a1", "a2", "a3", "a4", "a5"].map((t) => item(t, 0.9));
  const bodies = await run(
    { query: "cup final sources one", news: true, fresh: true, country: "IR", topic: "sports", place_language: "en", language: "en" },
    strong,
    [],
  );

  assert.equal(bodies.length, 1);
  assert.ok((bodies[0].include_domains as string[]).includes("varzesh3.com"));
});

test("too little on trusted sites: the whole web is searched as well", async () => {
  const bodies = await run(
    { query: "cup final sources two", news: true, fresh: true, country: "IR", topic: "sports", place_language: "en", language: "en" },
    [item("b1", 0.9)],
    ["b2", "b3", "b4"].map((t) => item(t, 0.9)),
  );

  assert.ok(bodies.length >= 2);
  assert.ok(bodies[0].include_domains);
  assert.equal(bodies[1].include_domains, undefined);
});

test("no country or unknown country: no site limit", async () => {
  const strong = ["c1", "c2", "c3", "c4"].map((t) => item(t, 0.9));
  const bodies = await run(
    { query: "cup final sources three", news: true, fresh: true, country: "ZZ", place_language: "en", language: "en" },
    [],
    strong,
  );

  assert.equal(bodies[0].include_domains, undefined);
});

test("a search that is not about recent events is never site-limited", async () => {
  const strong = ["d1", "d2", "d3", "d4"].map((t) => item(t, 0.9));
  const bodies = await run(
    { query: "history of the cup sources four", country: "IR", topic: "sports", place_language: "en", language: "en" },
    [],
    strong,
  );

  assert.equal(bodies[0].include_domains, undefined);
});
