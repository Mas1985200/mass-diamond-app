// tests/web/aspects-flow.test.ts
// A broad news question is searched side by side (a league, a national team, a
// club) and answered by side; a question about one event is not.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import { splitAspects } from "../../supabase/functions/ai-chat/retrieval/aspects.ts";
import {
  TOOL_RESULT_CHAR_CAP,
  WEB_BROAD_RESULTS,
  WEB_BROAD_SNIPPET_CHARS,
} from "../../supabase/functions/ai-chat/config.ts";
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

// Every search finds results that no other search finds (each title has words
// of its own), so that merging them is visible.
let serial = 0;

const found = (query: string, count: number, snippet = "The team won the final match") =>
  Array.from({ length: count }, (_, index) => {
    serial += 1;

    return {
      title: `Story${serial} alpha${serial} bravo${serial} charlie${serial} delta${serial}`,
      url: `https://site.example/${encodeURIComponent(query)}/${index}`,
      content: snippet,
      published_date: "2026-11-01",
      score: 0.9,
    };
  });

async function run(
  args: Record<string, unknown>,
  aspects: string,
  options: { perSearch?: number; snippet?: string } = {},
): Promise<{ calls: Call[]; data: Record<string, unknown> & { results: Record<string, string>[]; note?: string } }> {
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

      return new Response(
        JSON.stringify({ results: found(String(body.query), options.perSearch ?? 3, options.snippet) }),
        { status: 200 },
      );
    }

    calls.push({ kind: "groq", body });
    const system = JSON.stringify(body);
    const content = system.includes("asks for news") ? aspects : "1: EVENT";

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const outcome = await runWebSearch(args, ctx, new AbortController().signal);

    return {
      calls,
      data: outcome.data as never,
    };
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

const abort = () => new AbortController().signal;

test("splitAspects: NONE, a single line or no answer means not broad", async () => {
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;

  g.Deno = { env: { get: (k: string) => (k === "GROQ_API_KEY" ? "k" : undefined) } };

  try {
    for (const [answer, expected] of [
      ["NONE", 0],
      ["only one line", 0],
      ["league news\nnational team news", 2],
      ["1. league news\n2) national team news\n- club news\nfourth side", 3],
      ["same words\nsame words", 0],
      ["league news\n\nnational team news\n", 2],
    ] as const) {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 })) as unknown as typeof fetch;

      assert.equal((await splitAspects("same words", abort())).length, expected, answer);
    }

    globalThis.fetch = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    assert.deepEqual(await splitAspects("anything", abort()), []);
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
  }
});

test("a broad news question: each side is searched and the answer is laid out by side", async () => {
  const { calls, data } = await run(
    { query: "broad topic news one", news: true, fresh: true },
    "league side one\nnational team side one\nbig clubs side one",
  );
  const searches = calls.filter((c) => c.kind === "tavily").map((c) => c.body.query);

  assert.deepEqual(searches, [
    "broad topic news one",
    "league side one",
    "national team side one",
    "big clubs side one",
  ]);
  assert.equal(data.results.length, 8);
  assert.match(data.note ?? "", /several sides of one subject/);
  assert.match(data.note ?? "", /At least one result is from today/);
});

test("a question about one event gets no extra search and no layout note", async () => {
  const { calls, data } = await run(
    { query: "one event news two", news: true, fresh: true },
    "NONE",
  );

  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
  assert.doesNotMatch(data.note ?? "", /several sides/);
});

test("a search that is not news never asks whether it is broad", async () => {
  const { calls } = await run({ query: "not news three" }, "a\nb\nc");

  assert.equal(calls.filter((c) => c.kind === "groq").length, 0);
  assert.equal(calls.filter((c) => c.kind === "tavily").length, 1);
});

test("few results: the usual short answer, without the layout note", async () => {
  const { data } = await run(
    { query: "few results news four", news: true, fresh: true },
    "side a four\nside b four",
    { perSearch: 1 },
  );

  assert.ok(data.results.length < 4);
  assert.doesNotMatch(data.note ?? "", /several sides/);
});

test("the largest broad answer fits the tool-result cap", async () => {
  const { data } = await run(
    { query: "largest broad news five", news: true, fresh: true, language: "fa" },
    "side a five\nside b five\nside c five",
    { perSearch: 12, snippet: "ک".repeat(2000) },
  );

  assert.equal(data.results.length, WEB_BROAD_RESULTS);

  for (const item of data.results) {
    assert.ok(item.snippet.length <= WEB_BROAD_SNIPPET_CHARS);
  }

  assert.ok(JSON.stringify(data).length <= TOOL_RESULT_CHAR_CAP);
});
