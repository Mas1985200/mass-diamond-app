// tests/web/relevance-note.test.ts
// A news search tells the model to use only results about the question, and
// the model never reads a result's own site name. The network is replaced by a
// fake fetch.

import test from "node:test";
import assert from "node:assert/strict";

import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

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

const stories = [
  "alpha bravo charlie delta - SomeSite.com",
  "echo foxtrot golf hotel (OtherSite.net)",
  "india juliet kilo lima",
].map((title, index) => ({
  title,
  url: `https://relevance${index}.example/story`,
  content: `Body ${index} from relevance${index}.com`,
  score: 0.9 - index / 10,
  published_date: "2026-10-14",
}));

async function search(news: boolean): Promise<{
  note?: string;
  results: { title: string; snippet: string }[];
}> {
  const original = globalThis.fetch;

  globalThis.fetch = (async () => reply(stories)) as typeof fetch;

  try {
    const outcome = await runWebSearch(
      { query: `relevance-case ${news}`, news },
      context,
      signal,
    );

    return outcome.data as {
      note?: string;
      results: { title: string; snippet: string }[];
    };
  } finally {
    globalThis.fetch = original;
  }
}

test("a news search carries the relevance note", async () => {
  const data = await search(true);

  assert.match(data.note ?? "", /Use only results about what was asked/);
  assert.match(data.note ?? "", /never present its entries as played or as news/);
});

test("a plain search does not carry the news note", async () => {
  const data = await search(false);

  assert.doesNotMatch(data.note ?? "", /never present its entries as played/);
});

test("no title or snippet carries a site name or address", async () => {
  const data = await search(true);

  for (const item of data.results) {
    assert.doesNotMatch(item.title, /SomeSite|OtherSite/i);
    assert.doesNotMatch(item.snippet, /relevance\d\.com/i);
  }
});
