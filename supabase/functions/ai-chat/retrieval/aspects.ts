// supabase/functions/ai-chat/retrieval/aspects.ts
// A news question about a broad subject ("today's news of Iranian football",
// "technology news", "what is new in Tokyo") has several sides, and one search
// finds mostly one of them. A small model names up to three other sides of the
// same subject, each is searched on its own, and the results are merged, so the
// answer covers the subject the way a good newsroom summary does. A question
// about one event, one person's statement or one score is not broad and gets
// no extra searches. Any failure returns an empty list and the search goes on
// without it. Nothing here depends on a language or a topic.

import { askSmallModel } from "./small-model.ts";

export const MAX_ASPECTS = 3;

const SYSTEM =
  "The user's web search asks for news. If it is about ONE specific event, statement, score, person or fact, reply with the single word NONE. If it is about a broad subject that has several sides (a sport in a country, a league, a company, a city, a field of science or technology), reply with 2 or 3 other web searches, one per line, each about a different side of that same subject (for example for a country's football: the top league, the national team, the biggest clubs). Write each search in the same language and script as the user's search, keep every name from it, and leave out years, months, days and words such as today, latest, news or recent. No numbering, no bullets, no notes.";

// The extra searches, or an empty list when the question is not broad or the
// model gave nothing usable. At least two are needed: one alone would only
// repeat the main search.
export async function splitAspects(
  query: string,
  master: AbortSignal,
): Promise<string[]> {
  const answer = await askSmallModel(SYSTEM, query, master, 200);

  if (!answer) {
    return [];
  }

  const own = query.trim().toLowerCase();
  const found: string[] = [];

  for (const line of answer.split("\n")) {
    const text = line
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, "")
      .trim()
      .slice(0, 200);

    if (!text) {
      continue;
    }

    if (text.toUpperCase() === "NONE") {
      return [];
    }

    if (
      text.toLowerCase() !== own &&
      !found.some((other) => other.toLowerCase() === text.toLowerCase())
    ) {
      found.push(text);
    }
  }

  return found.length >= 2 ? found.slice(0, MAX_ASPECTS) : [];
}
