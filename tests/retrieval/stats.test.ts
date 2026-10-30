// tests/retrieval/stats.test.ts
// The retrieval step reports numbers only (never text) about what it did, so a
// weak answer can be traced to the search or to the filter.

import test from "node:test";
import assert from "node:assert/strict";

import { selectEvidence } from "../../supabase/functions/ai-chat/retrieval/evidence.ts";
import type { WebResult } from "../../supabase/functions/ai-chat/types.ts";

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

test("selectEvidence: the stats count what each step did, with numbers only", () => {
  const evidence = selectEvidence(
    [
      result("Persepolis beat Sepahan in derby match", "text one", "a.com", "2026-10-29"),
      result("Persepolis beat Sepahan in the derby match", "text two", "b.org", "2026-10-28"),
      result("Gold price falls", "gold market news", "c.net", "2026-10-29"),
      result("Persepolis old derby story archive", "Persepolis Sepahan derby", "d.com", "2026-08-01"),
    ],
    "Persepolis Sepahan derby",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );

  assert.equal(evidence.stats.considered, 4);
  assert.equal(evidence.stats.droppedIrrelevant, 1);
  assert.equal(evidence.stats.droppedStale, 1);
  assert.equal(evidence.stats.merged, 1);
  assert.equal(evidence.items.length, 1);
  // One number per result the search returned, in the search order.
  assert.deepEqual(evidence.stats.ageDays, [0, 1, 0, 89]);
  assert.equal(evidence.stats.relevance.length, 4);
  assert.ok(evidence.stats.relevance.every((value) => typeof value === "number"));
});

test("selectEvidence: the stats never hold any text of the question or the pages", () => {
  const evidence = selectEvidence(
    [result("Secret headline", "secret body text", "private-site.com", "2026-10-29")],
    "secret question",
    { now: NOW, zone: ZONE, recencyMatters: true },
  );
  const text = JSON.stringify(evidence.stats);

  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("private-site"));
});
