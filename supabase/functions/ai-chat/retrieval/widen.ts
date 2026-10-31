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

export function needsWiderSearch(evidence: Evidence | null): boolean {
  if (evidence === null) {
    return true;
  }

  return evidence.weakMatch || evidence.items.length < MIN_USEFUL_RESULTS;
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
