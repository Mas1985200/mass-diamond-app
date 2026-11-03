// tests/web/kind-flow.test.ts
// A news search leaves out timetables, previews and roundups before the model
// reads anything, and changes nothing when the labels cannot be had.

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

// Four results, newest first once the app has ordered them: the first and the
// third are not reports, the second and the fourth are.
const RESULTS = [
  { title: "Alpha preview tonight kickoff", content: "The match is expected at midnight", published_date: "2026-11-01", score: 0.9 },
  { title: "Bravo veteran striker retires after surgery", content: "He announced his retirement today", published_date: "2026-10-31", score: 0.8 },
  { title: "Charlie broadcast timetable channels", content: "Live schedule of all the games", published_date: "2026-10-30", score: 0.7 },
  { title: "Delta champions beat rivals late goal", content: "The league leaders won the derby", published_date: "2026-10-29", score: 0.6 },
].map((item, index) => ({ ...item, url: `https://site${index}.example/page` }));

type Call = { kind: "tavily" | "groq"; body: Record<string, unknown> };

async function run(
  args: Record<string, unknown>,
  groq: () => Response,
): Promise<{ calls: Call[]; data: { results: { title: string }[]; note?: string } }> {
  const calls: Call[] = [];
  const oldFetch = globalThis.fetch;
  const oldDeno = g.Deno;
  const logs: string[] = [];
  const oldLog = console.log;

  g.Deno = { env: { get: (k: string) => (k === "GROQ_API_KEY" ? "k" : undefined) } };
  console.log = (line: unknown) => {
    logs.push(String(line));
  };
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;

    if (String(url).includes("tavily")) {
      calls.push({ kind: "tavily", body });

      return new Response(JSON.stringify({ results: RESULTS }), { status: 200 });
    }

    calls.push({ kind: "groq", body });

    return groq();
  }) as unknown as typeof fetch;

  try {
    const outcome = await runWebSearch(args, ctx, new AbortController().signal);

    return {
      calls,
      data: outcome.data as { results: { title: string }[]; note?: string },
    };
  } finally {
    globalThis.fetch = oldFetch;
    g.Deno = oldDeno;
    console.log = oldLog;
  }
}

const labels = (text: string) => () =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  });

const titlesOf = (data: { results: { title: string }[] }) =>
  data.results.map((result) => result.title.split(" ")[0]);

test("news: previews and timetables are left out before the model reads", async () => {
  const { calls, data } = await run(
    { query: "kind news one", news: true, fresh: true },
    labels("1: PREVIEW\n2: EVENT\n3: SCHEDULE\n4: EVENT"),
  );

  assert.deepEqual(titlesOf(data), ["Bravo", "Delta"]);
  assert.equal(calls.filter((call) => call.kind === "groq").length, 1);
  // With the preview gone nothing is from today, and the note says so.
  assert.match(data.note ?? "", /None of these results is from today/);
});

test("news: when the labels cannot be had every result is kept", async () => {
  const { data } = await run(
    { query: "kind news two", news: true, fresh: true },
    () => new Response("no", { status: 500 }),
  );

  assert.deepEqual(titlesOf(data), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("news: an answer that is not in the label form keeps every result", async () => {
  const { data } = await run(
    { query: "kind news three", news: true, fresh: true },
    labels("I think the first one is a preview."),
  );

  assert.deepEqual(titlesOf(data), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("news: when every result is not a report none is removed", async () => {
  const { data } = await run(
    { query: "kind news four", news: true, fresh: true },
    labels("1: PREVIEW\n2: SCHEDULE\n3: ROUNDUP\n4: PREVIEW"),
  );

  assert.equal(data.results.length, 4);
});

test("a search that is not news never asks for labels", async () => {
  const { calls, data } = await run(
    { query: "kind plain five" },
    labels("1: PREVIEW\n2: EVENT\n3: SCHEDULE\n4: EVENT"),
  );

  assert.equal(calls.filter((call) => call.kind === "groq").length, 0);
  assert.equal(data.results.length, 4);
});
