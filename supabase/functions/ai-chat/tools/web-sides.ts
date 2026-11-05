// supabase/functions/ai-chat/tools/web-sides.ts
// The searches for the other sides of a broad news subject (see
// retrieval/aspects.ts), run side by side and merged into what the main search
// already found. (web.ts decides when this happens.)

import type { WebResult } from "../types.ts";
import { mergeResults } from "../retrieval/widen.ts";
import { tavilySearch } from "./tavily.ts";

export async function searchSides(
  sides: readonly string[],
  apiKey: string,
  maxResults: number,
  master: AbortSignal,
  fresh: boolean,
  news: boolean,
  domains: readonly string[] | null,
  found: readonly WebResult[],
): Promise<WebResult[]> {
  const more = await Promise.all(
    sides.map((side) =>
      tavilySearch(side, apiKey, maxResults, master, fresh, news, domains),
    ),
  );
  let merged = [...found];

  for (const results of more) {
    if (results !== null && results.length > 0) {
      merged = mergeResults(merged, results);
    }
  }

  return merged;
}
