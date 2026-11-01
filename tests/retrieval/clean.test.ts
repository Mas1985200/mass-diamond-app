// tests/retrieval/clean.test.ts
// The model never reads the name of a result's own website.

import test from "node:test";
import assert from "node:assert/strict";

import { withoutSiteNames } from "../../supabase/functions/ai-chat/retrieval/clean.ts";

test("a site name after the headline is removed", () => {
  assert.equal(
    withoutSiteNames("Iran wins the tournament - SomeSite.com"),
    "Iran wins the tournament",
  );
});

test("a site name in brackets is removed with its brackets", () => {
  assert.equal(
    withoutSiteNames("Der Kader gewann das Turnier (PersianFootball.com) in Belarus"),
    "Der Kader gewann das Turnier in Belarus",
  );
});

test("a full address is removed", () => {
  assert.equal(
    withoutSiteNames("Read more at https://www.example.com/news/1 today"),
    "Read more at today",
  );
});

test("ordinary text, numbers and dates stay", () => {
  const text = "Score 2.5 goals on 31.10.2026, coach says: e.g. a win";

  assert.equal(withoutSiteNames(text), text);
});
