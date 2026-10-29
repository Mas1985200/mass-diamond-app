// tests/web/sources-card.test.ts
// The "sources" card can be built from search results (real addresses only,
// one per site), but a web answer does not show it: that is a product decision.
// The model never sees an address either way.

import test from "node:test";
import assert from "node:assert/strict";

import {
  runWebSearch,
  sourcesCard,
} from "../../supabase/functions/ai-chat/tools/web.ts";
import type {
  ToolContext,
  WebResult,
} from "../../supabase/functions/ai-chat/types.ts";

const signal = new AbortController().signal;

const context: ToolContext = {
  now: new Date("2026-10-29T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: "test-key",
};

function result(title: string, url: string, source: string): WebResult {
  return { title, url, source, published: "", snippet: "text" };
}

test("sourcesCard: one entry per site, in the order of the results", () => {
  const card = sourcesCard(
    [
      result("A", "https://news-a.com/1", "news-a.com"),
      result("B", "https://news-b.org/2", "news-b.org"),
      result("A again", "https://news-a.com/3", "news-a.com"),
    ],
    "fa",
  );

  assert.deepEqual(card, {
    t: "sources",
    lang: "fa",
    items: [
      { url: "https://news-a.com/1", host: "news-a.com", title: "A" },
      { url: "https://news-b.org/2", host: "news-b.org", title: "B" },
    ],
  });
});

test("sourcesCard: no results, no card", () => {
  assert.equal(sourcesCard([], "en"), null);
});

test("runWebSearch: no sources card is shown under a web answer, and the model gets no address", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Story",
            url: "https://www.sources-card-a.com/world/1",
            content: "Body",
          },
          {
            title: "Other",
            url: "https://sources-card-b.org/2",
            content: "Body 2",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const outcome = await runWebSearch(
      { query: "sources card query" },
      context,
      signal,
    );

    assert.equal(outcome.cards, undefined);
    assert.ok(Array.isArray((outcome.data as { results?: unknown }).results));
    assert.ok(!JSON.stringify(outcome.data).includes("http"));
  } finally {
    globalThis.fetch = original;
  }
});

test("runWebSearch: a failed or empty search shows no sources card", async () => {
  const original = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const empty = await runWebSearch(
      { query: "sources card empty" },
      context,
      signal,
    );

    assert.equal(empty.cards, undefined);

    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as typeof fetch;

    const failed = await runWebSearch(
      { query: "sources card failed" },
      context,
      signal,
    );

    assert.equal(failed.cards, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
