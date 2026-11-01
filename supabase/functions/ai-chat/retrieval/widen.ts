// supabase/functions/ai-chat/retrieval/widen.ts
// When a search comes back thin, the app searches once more in the language of
// the place the question is about (the model supplies that second wording).
// A question about Iranian football asked in German finds few German pages;
// the same question in Persian finds many. Nothing here depends on a language
// or a topic: it counts what the first search left standing.

import type { WebResult } from "../types.ts";
import type { Evidence } from "./evidence.ts";

// Fewer kept results than this, or only weak matches, means the search was thin.
export const MIN_USEFUL_RESULTS = 3;

// The search service scores every page from 0 to 1. A page that really answers
// the question scores well above this; when even the best page stays below it,
// the first wording found only loosely related pages.
export const STRONG_SCORE = 0.6;

// True when the search service scored the pages and none reached STRONG_SCORE.
export function lacksStrongMatch(found: readonly WebResult[]): boolean {
  const scores = found
    .map((result) => result.score)
    .filter((score): score is number => typeof score === "number");

  return scores.length > 0 && Math.max(...scores) < STRONG_SCORE;
}

export function needsWiderSearch(
  evidence: Evidence | null,
  found: readonly WebResult[] = [],
): boolean {
  if (evidence === null) {
    return true;
  }

  return (
    evidence.weakMatch ||
    evidence.items.length < MIN_USEFUL_RESULTS ||
    lacksStrongMatch(found)
  );
}

// The first search's results, then any result of the second search whose
// address is not already there.
export function mergeResults(
  first: readonly WebResult[],
  second: readonly WebResult[],
): WebResult[] {
  const seen = new Set(first.map((result) => result.url));
  const merged = [...first];

  for (const result of second) {
    if (seen.has(result.url)) {
      continue;
    }

    seen.add(result.url);
    merged.push(result);
  }

  return merged;
}
