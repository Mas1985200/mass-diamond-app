// tests/retrieval/evidence.test.ts
// The retrieval and verification step: the age of a result, relevance to the
// question, the same story from several sites, ordering by freshness and the
// honest note when nothing is from today. No network is used.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ageInDays,
  publishedDay,
  whenLabel,
} from "../../supabase/functions/ai-chat/retrieval/dates.ts";
import {
  evidenceNote,
  relevanceOf,
  selectEvidence,
  tokensOf,
} from "../../supabase/functions/ai-chat/retrieval/evidence.ts";
import type { WebResult } from "../../supabase/functions/ai-chat/types.ts";

// Thursday 29 Oct 2026, 20:00 in Tehran.
const NOW = new Date("2026-10-29T16:30:00Z");
const ZONE = "Asia/Tehran";

function result(
  title: string,
  snippet: string,
  source: string,
  published = "",
): WebResult {
  return { title, snippet, source, url: `https://${source}/x`, published };
}

test("ageInDays: today, yesterday and older, in the user's own zone", () => {
  assert.equal(ageInDays("2026-10-29", NOW, ZONE), 0);
  assert.equal(ageInDays("2026-10-28", NOW, ZONE), 1);
  assert.equal(ageInDays("2026-10-26", NOW, ZONE), 3);
  assert.equal(ageInDays("Thu, 29 Oct 2026 05:00:00 GMT", NOW, ZONE), 0);
});

test("ageInDays: the zone decides which calendar day it is", () => {
  // 21:00 UTC on the 28th is already the 29th in Tehran but not in London.
  const published = "2026-10-28T21:00:00Z";

  assert.equal(ageInDays(published, NOW, "Asia/Tehran"), 0);
  assert.equal(ageInDays(published, NOW, "Europe/London"), 1);
  // An unknown zone falls back to UTC instead of failing.
  assert.equal(ageInDays(published, NOW, null), 1);
  assert.equal(ageInDays(published, NOW, "Not/AZone"), 1);
});

test("ageInDays: missing, unreadable and impossible dates are unknown", () => {
  assert.equal(ageInDays("", NOW, ZONE), null);
  assert.equal(ageInDays("last Tuesday-ish", NOW, ZONE), null);
  // A Persian-calendar year read as a Gregorian one makes no sense.
  assert.equal(ageInDays("1405-08-07", NOW, ZONE), null);
  // A date well in the future is not believable.
  assert.equal(ageInDays("2026-12-25", NOW, ZONE), null);
});

test("ageInDays: Persian digits are read as digits", () => {
  assert.equal(ageInDays("۲۰۲۶-۱۰-۲۶", NOW, ZONE), 3);
  assert.equal(publishedDay("۲۰۲۶-۱۰-۲۶", NOW, ZONE), "2026-10-26");
});

test("whenLabel: a plain label the model can translate", () => {
  assert.equal(whenLabel(0), "today");
  assert.equal(whenLabel(1), "yesterday");
  assert.equal(whenLabel(3), "3 days ago");
  assert.equal(whenLabel(null), "date not stated");
});

test("tokensOf: folds spellings and splits Chinese into pairs", () => {
  assert.deepEqual(tokensOf("فوتبال ایران"), ["فوتبال", "ایران"]);
  // Arabic ي and ك meet the Persian ی and ک.
  assert.deepEqual(tokensOf("كتاب"), tokensOf("کتاب"));
  assert.deepEqual(tokensOf("足球新闻"), ["足球", "球新", "新闻"]);
});

test("relevanceOf: inflected forms of a word still match", () => {
  const words = tokensOf("آخرین خبرهای فوتبال ایران");

  assert.equal(
    relevanceOf(words, { title: "خبر فوتبال ایران", snippet: "آخرین" }),
    1,
  );
  assert.equal(
    relevanceOf(words, { title: "قیمت طلا", snippet: "کاهش یافت" }),
    0,
  );
});

test("selectEvidence: a result about something else is dropped (any language)", () => {
  const persian = selectEvidence(
    [
      result("اخبار فوتبال ایران", "آخرین خبرهای فوتبال ایران و لیگ برتر", "a.ir", "2026-10-29"),
      result("قیمت طلا امروز", "طلای ۱۸ عیار کاهش یافت و ایران", "b.ir", "2026-10-29"),
    ],
    "آخرین خبرهای فوتبال ایران",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    persian.items.map((item) => item.title),
    ["اخبار فوتبال ایران"],
  );

  const english = selectEvidence(
    [
      result("Iran football league results", "football news from Iran league", "a.com", "2026-10-29"),
      result("Gold price falls", "gold market news from today", "b.com", "2026-10-29"),
    ],
    "latest Iran football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    english.items.map((item) => item.title),
    ["Iran football league results"],
  );
});

test("selectEvidence: when nothing can be judged, nothing is dropped", () => {
  const evidence = selectEvidence(
    [
      result("Story", "Body", "a.com"),
      result("Other", "Body 2", "b.org"),
    ],
    "q run-ok",
    { now: NOW, zone: ZONE, recencyMatters: false },
  );

  assert.equal(evidence.items.length, 2);
  assert.deepEqual(
    evidence.items.map((item) => item.title),
    ["Story", "Other"],
  );
});

test("selectEvidence: the same story from several sites is one item with a count", () => {
  const evidence = selectEvidence(
    [
      result("Persepolis beat Sepahan in derby match", "text one", "a.com", "2026-10-29"),
      result("Persepolis beat Sepahan in the derby match", "text two", "b.org", "2026-10-28"),
      result("Persepolis beat Sepahan derby match tonight", "text three", "c.net", "2026-10-29"),
      result("Transfer window opens for Esteghlal", "other news", "d.com", "2026-10-29"),
    ],
    "Persepolis Sepahan derby Esteghlal transfer",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(evidence.items.length, 2);

  const derby = evidence.items.find((item) => item.title.includes("derby"));

  assert.equal(derby?.independentSources, 3);
  // The newest copy of the story leads.
  assert.equal(derby?.ageDays, 0);
});

test("selectEvidence: two pages of one site are not independent sources", () => {
  const evidence = selectEvidence(
    [
      result("Persepolis beat Sepahan in derby match", "one", "a.com", "2026-10-29"),
      result("Persepolis beat Sepahan in derby match report", "two", "a.com", "2026-10-29"),
    ],
    "Persepolis Sepahan derby",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0]?.independentSources, 1);
});

test("selectEvidence: news is ordered by freshness, undated last; plain searches keep their order", () => {
  const input = [
    result("Football story old", "football news", "a.com", "2026-10-20"),
    result("Football story undated", "football news", "b.com"),
    result("Football story newest", "football news", "c.com", "2026-10-29"),
  ];
  const news = selectEvidence(input, "football news", {
    now: NOW,
    zone: ZONE,
    recencyMatters: true,
  });

  assert.deepEqual(
    news.items.map((item) => item.title),
    ["Football story newest", "Football story old", "Football story undated"],
  );

  const plain = selectEvidence(input, "football news", {
    now: NOW,
    zone: ZONE,
    recencyMatters: false,
  });

  assert.deepEqual(
    plain.items.map((item) => item.title),
    input.map((item) => item.title),
  );
});

test("selectEvidence: very old news is dropped only when fresher news exists", () => {
  const mixed = selectEvidence(
    [
      result("Football story ancient", "football news", "a.com", "2026-08-01"),
      result("Football story recent", "football news", "b.com", "2026-10-27"),
    ],
    "football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.deepEqual(
    mixed.items.map((item) => item.title),
    ["Football story recent"],
  );

  const onlyOld = selectEvidence(
    [result("Football story ancient", "football news", "a.com", "2026-08-01")],
    "football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(onlyOld.items.length, 1);
});

test("evidenceNote: says plainly when nothing is from today or no date is stated", () => {
  const old = selectEvidence(
    [result("Football story", "football news", "a.com", "2026-10-26")],
    "football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.match(evidenceNote(old, true) ?? "", /None of these results is from today; the newest is 3 days old/);

  const undated = selectEvidence(
    [result("Football story", "football news", "a.com")],
    "football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.match(evidenceNote(undated, true) ?? "", /No result states a publication date/);

  const today = selectEvidence(
    [result("Football story", "football news", "a.com", "2026-10-29")],
    "football news",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(evidenceNote(today, true), null);
  // For ordinary (non-news) questions there is no note at all.
  assert.equal(evidenceNote(old, false), null);
});
