// tests/retrieval/score.test.ts
// The search service scores every page against the question (it understands
// meaning). A match report is found for "latest football news" although it
// shares no word with the question, so when scores are present the app trusts
// them and drops only pages far below the best one. Without scores the old
// word comparison still applies. No network.

import test from "node:test";
import assert from "node:assert/strict";

import { selectEvidence } from "../../supabase/functions/ai-chat/retrieval/evidence.ts";
import { tavilySearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type { WebResult } from "../../supabase/functions/ai-chat/types.ts";

// Thursday 29 Oct 2026, 20:00 in Tehran.
const NOW = new Date("2026-10-29T16:30:00Z");
const ZONE = "Asia/Tehran";

function page(
  title: string,
  source: string,
  published: string,
  score?: number,
): WebResult {
  return {
    title,
    snippet: title,
    source,
    url: `https://${source}/x`,
    published,
    ...(score === undefined ? {} : { score }),
  };
}

test("a page that shares no word with the question is kept when the service scores it well", () => {
  const evidence = selectEvidence(
    [
      page("برتری سپاهان برابر خیبر بازگشت زردپوشان به صدر جدول", "a.ir", "2026-10-28", 0.55),
      page("حکم جدید کمیته انضباطی برای ملوان و تراکتور", "b.ir", "2026-10-29", 0.5),
      page("قیمت طلا و سکه امروز", "c.ir", "2026-10-29", 0.05),
    ],
    "آخرین خبرهای امروز دربارهٔ فوتبال ایران",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    evidence.items.map((item) => item.title),
    [
      "حکم جدید کمیته انضباطی برای ملوان و تراکتور",
      "برتری سپاهان برابر خیبر بازگشت زردپوشان به صدر جدول",
    ],
  );
  assert.equal(evidence.stats.droppedIrrelevant, 1);
});

test("today's page is not dropped for sharing few words with the question", () => {
  const evidence = selectEvidence(
    [
      page("Sepahan won at home", "a.com", "2026-10-29", 0.45),
      page("Football league table", "b.com", "2026-10-26", 0.6),
    ],
    "latest news about iran football today",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(evidence.items[0]?.ageDays, 0);
  assert.equal(evidence.items.length, 2);
});

test("without scores the words of the question are compared as before", () => {
  const evidence = selectEvidence(
    [
      page("اخبار فوتبال ایران", "a.ir", "2026-10-29"),
      page("قیمت طلا امروز", "b.ir", "2026-10-29"),
    ],
    "آخرین خبرهای فوتبال ایران",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    evidence.items.map((item) => item.title),
    ["اخبار فوتبال ایران"],
  );
});

test("scores on only some of the pages are not trusted", () => {
  const evidence = selectEvidence(
    [
      page("اخبار فوتبال ایران", "a.ir", "2026-10-29", 0.9),
      page("قیمت طلا امروز", "b.ir", "2026-10-29"),
    ],
    "آخرین خبرهای فوتبال ایران",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    evidence.items.map((item) => item.title),
    ["اخبار فوتبال ایران"],
  );
});

test("tavilySearch keeps the service's score, kept between 0 and 1", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          { title: "A", url: "https://a.com/1", content: "x", score: 0.42 },
          { title: "B", url: "https://b.com/2", content: "y", score: 7 },
          { title: "C", url: "https://c.com/3", content: "z", score: "high" },
          { title: "D", url: "https://d.com/4", content: "w" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const results = await tavilySearch(
      "q score-parse",
      "key",
      4,
      new AbortController().signal,
    );

    assert.deepEqual(
      results?.map((result) => result.score),
      [0.42, 1, undefined, undefined],
    );
  } finally {
    globalThis.fetch = original;
  }
});
