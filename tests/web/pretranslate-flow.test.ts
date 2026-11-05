// tests/web/pretranslate-flow.test.ts
// A news search about a place goes out in the place's own language, whatever
// language the model wrote it in, so that the same question asked in any
// language finds the same pages.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";
import { scriptsOfLanguage } from "../../supabase/functions/ai-chat/retrieval/script.ts";

const g = globalThis as unknown as Record<string, unknown>;

const ctx: ToolContext = {
  now: new Date("2026-11-01T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "t",
};

type Call = { kind: "tavily" | "groq"; body: Record<string, unknown> };

// Strong, fresh pages: nothing here makes a second search necessary.
const STRONG = [
  ["Alpha club wins the cup final", "The captain scored twice in the last minutes"],
  ["Bravo coach signs a new contract", "The federation announced a two year extension"],
  ["Charlie striker retires after surgery", "He told reporters the knee would not recover"],
  ["Delta stadium reopens to supporters", "Thousands filled the stands for the first match"],
].map(([title, content], index) => ({
  title,
  url: `https://strong.example/${index}`,
  content,
  published_date: "2026-11-01",
  score: 0.9,
}));

const WEAK = [
  { title: "Loose page", url: "https://loose.example/x", content: "unrelated", published_date: "2026-11-01", score: 0.1 },
];

async function run(
  args: Record<string, unknown>,
  groq: () => Response,
  tavily: () => unknown[] = () => STRONG,
): Promise<Call[]> {
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

      return new Response(JSON.stringify({ results: tavily() }), { status: 200 });
    }

    // The question of whether a news search is broad (retrieval/aspects.ts) is
    // answered "not broad" here and not counted: these tests are about other
    // steps. tests/web/aspects-flow.test.ts covers it.
    if (JSON.stringify(body).includes("asks for news")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "NONE" } }] }),
        { status: 200 },
      );
    }

    calls.push({ kind: "groq", body });

    return groq();
  }) as unknown as typeof fetch;

  try {
    await runWebSearch(args, ctx, new AbortController().signal);

    return calls;
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

const says = (text: string) => () =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

const queries = (calls: Call[]) =>
  calls.filter((c) => c.kind === "tavily").map((c) => c.body.query);

test("a Latin-script search for a Persian place is translated before it goes out", async () => {
  const calls = await run(
    { query: "pre football iran news", news: true, fresh: true, place_language: "fa", language: "es" },
    says("اخبار فوتبال ایران"),
  );

  assert.deepEqual(queries(calls), ["اخبار فوتبال ایران"]);
});

test("a search already in the place's script is sent as it is", async () => {
  const calls = await run(
    { query: "اخبار والیبال ایران", news: true, fresh: true, place_language: "fa", language: "es" },
    says("never used"),
  );

  assert.deepEqual(queries(calls), ["اخبار والیبال ایران"]);
  // (The small model is still asked to label the results, but never to
  // translate the search.)
  const translating = calls.filter(
    (c) =>
      c.kind === "groq" &&
      JSON.stringify(c.body.messages).includes("Translate the user's web search"),
  );
  assert.equal(translating.length, 0);
});

test("a place whose language shares the Latin script is not translated first", async () => {
  const calls = await run(
    { query: "pre football germany news", news: true, fresh: true, place_language: "de", language: "es" },
    says("Fußball Deutschland Nachrichten"),
  );

  assert.deepEqual(queries(calls), ["pre football germany news"]);
});

test("the place's language is the user's language: nothing is translated", async () => {
  const calls = await run(
    { query: "pre football news", news: true, fresh: true, place_language: "en", language: "en" },
    says("x"),
  );

  assert.deepEqual(queries(calls), ["pre football news"]);
});

test("when the translation cannot be had the model's own search goes out", async () => {
  const calls = await run(
    { query: "pre football iran two", news: true, fresh: true, place_language: "fa", language: "es" },
    () => new Response("no", { status: 500 }),
  );

  assert.equal(queries(calls)[0], "pre football iran two");
});

test("a translated search that finds only weak pages falls back to the model's wording", async () => {
  const calls = await run(
    { query: "pre football iran three", news: true, fresh: true, place_language: "fa", language: "es" },
    says("اخبار فوتبال سه"),
    () => WEAK,
  );

  assert.deepEqual(queries(calls), ["اخبار فوتبال سه", "pre football iran three"]);
});

test("a search that is not news is never translated first", async () => {
  const calls = await run(
    { query: "pre why is the sky blue", place_language: "fa", language: "es" },
    says("x"),
  );

  assert.deepEqual(queries(calls), ["pre why is the sky blue"]);
});

test("scriptsOfLanguage knows non-Latin languages only", () => {
  assert.deepEqual(scriptsOfLanguage("fa-IR"), ["arabic"]);
  assert.deepEqual(scriptsOfLanguage("ja"), ["kana", "han"]);
  assert.equal(scriptsOfLanguage("es"), null);
  assert.equal(scriptsOfLanguage("en"), null);
  assert.equal(scriptsOfLanguage(null), null);
});
