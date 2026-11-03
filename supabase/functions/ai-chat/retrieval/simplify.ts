// supabase/functions/ai-chat/retrieval/simplify.ts
// A news search worded with a year, a month or a long phrase sometimes finds
// only loosely related pages. When that happens and there is no other language
// to try, the search is repeated once as the plain keywords of its subject, in
// the same language. Any failure returns null and the search goes on without
// it. Nothing here depends on a language or a topic.

import { askSmallModel } from "./small-model.ts";

const SYSTEM =
  "Rewrite the user's web search as the 3 to 6 main keywords of its subject, in the same language and script as the search. Keep the names of people, teams and places. Leave out years, months, days, and words such as today, latest, news or recent. Reply with the keywords only, on one line: no quotes, no notes.";

// The keywords, or null when the model gave none, or gave the same search back.
export async function simplifyQuery(
  query: string,
  master: AbortSignal,
): Promise<string | null> {
  const answer = await askSmallModel(SYSTEM, query, master, 200);

  if (!answer) {
    return null;
  }

  const text = (answer.split("\n")[0] ?? "")
    .trim()
    .replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, "")
    .trim()
    .slice(0, 200);

  if (!text || text.toLowerCase() === query.trim().toLowerCase()) {
    return null;
  }

  return text;
}
