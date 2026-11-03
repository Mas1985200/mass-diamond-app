// tests/retrieval/today-split.test.ts
// When only some of the results the model reads are from today, the app tells
// it how many, so the first sentence never calls the whole list today's.

import test from "node:test";
import assert from "node:assert/strict";

import {
  evidenceNote,
  type Evidence,
  type EvidenceItem,
} from "../../supabase/functions/ai-chat/retrieval/evidence.ts";

function item(ageDays: number | null): EvidenceItem {
  return {
    title: "T",
    snippet: "S",
    published: "",
    ageDays,
    independentSources: 1,
    relevance: 1,
  };
}

function evidenceOf(ages: readonly (number | null)[]): Evidence {
  const items = ages.map(item);
  const known = ages.filter((age): age is number => age !== null);

  return {
    items,
    newestAgeDays: known.length > 0 ? Math.min(...known) : null,
    datedCount: known.length,
    weakMatch: false,
    stats: {
      considered: items.length,
      droppedIrrelevant: 0,
      droppedStale: 0,
      merged: 0,
      relevance: items.map(() => 1),
      ageDays: ages,
    },
  };
}

test("one result from today among older ones: the note says only the first one is", () => {
  const note = evidenceNote(evidenceOf([0, 1, 3, 4]), true) ?? "";

  assert.match(note, /At least one result is from today/);
  assert.match(note, /Only the first 1 of 4 is from today/);
});

test("several from today among older ones: the note counts them", () => {
  const note = evidenceNote(evidenceOf([0, 0, 2, 5, 6]), true) ?? "";

  assert.match(note, /Only the first 2 of 5 are from today/);
});

test("only the results the model reads are counted", () => {
  // Seven results, all from today: the model reads five, so none is older.
  const note = evidenceNote(evidenceOf([0, 0, 0, 0, 0, 0, 0]), true) ?? "";

  assert.match(note, /At least one result is from today/);
  assert.doesNotMatch(note, /Only the first/);
});

test("every result from today: no split sentence", () => {
  const note = evidenceNote(evidenceOf([0, 0]), true) ?? "";

  assert.doesNotMatch(note, /Only the first/);
});

test("nothing from today: the older note is used, with no split sentence", () => {
  const note = evidenceNote(evidenceOf([1, 2]), true) ?? "";

  assert.match(note, /None of these results is from today/);
  assert.doesNotMatch(note, /Only the first/);
});
