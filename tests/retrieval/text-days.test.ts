// tests/retrieval/text-days.test.ts
// Words and dates written inside a page describe the day the page was written,
// not the day the user asks on. The app says so with every date note.

import test from "node:test";
import assert from "node:assert/strict";

import {
  evidenceNote,
  selectEvidence,
} from "../../supabase/functions/ai-chat/retrieval/evidence.ts";
import type { WebResult } from "../../supabase/functions/ai-chat/types.ts";

// Thursday 29 Oct 2026, 20:00 in Tehran.
const NOW = new Date("2026-10-29T16:30:00Z");
const OPTIONS = { now: NOW, zone: "Asia/Tehran", recencyMatters: true };

function found(published: string) {
  const item: WebResult = {
    title: "Football story",
    snippet: "football news",
    source: "a.com",
    url: "https://a.com/x",
    published,
  };

  return selectEvidence([item], "football news", OPTIONS);
}

test("every date note says that a day written inside a page means the page's own day", () => {
  for (const published of ["2026-10-29", "2026-10-26", ""]) {
    assert.match(
      evidenceNote(found(published), true) ?? "",
      /means the day that page was published/,
    );
  }
});

test("the date notes still say what they said before", () => {
  assert.match(evidenceNote(found("2026-10-29"), true) ?? "", /At least one result is from today/);
  assert.match(evidenceNote(found("2026-10-26"), true) ?? "", /None of these results is from today/);
  assert.match(evidenceNote(found(""), true) ?? "", /No result states a publication date/);
});

test("ordinary searches carry no date note", () => {
  assert.equal(evidenceNote(found("2026-10-26"), false), null);
});
