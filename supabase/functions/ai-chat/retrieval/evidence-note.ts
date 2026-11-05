// supabase/functions/ai-chat/retrieval/evidence-note.ts
// The sentence the app writes beside news results: whether anything is from
// today, how old the newest result is, and whether any of them matches the
// question at all. (evidence.ts judges the results; this file only words it.)

import { WEB_NEWS_RESULTS } from "../config.ts";
import type { Evidence } from "./evidence.ts";

// Said with every date note: a "today" or a date written inside a page means
// the day that page was written (a schedule published yesterday says "today"
// about yesterday). Only the app's own 'published' and 'when' fields are about
// now. Kept short and positive on purpose: a long list of prohibitions made the
// model distrust results that were from today.
const TEXT_DAYS_NOTE =
  "Take dates only from each result's 'published' and 'when' fields; a 'today' written inside a result's text means the day that page was published.";

// 5. A sentence the model must respect, written by the app. The date notes
// exist only for news and fresh data, where calling an old result "today's" is
// the mistake; the weak-match note applies to every search.
export function evidenceNote(
  evidence: Evidence,
  recencyMatters: boolean,
  readCount: number = WEB_NEWS_RESULTS,
): string | null {
  if (evidence.items.length === 0) {
    return null;
  }

  if (evidence.weakMatch) {
    return "None of these results clearly matches the question. Do not present them as the answer or list them as if they were; say that you could not find a good answer.";
  }

  if (!recencyMatters) {
    return null;
  }

  if (evidence.datedCount === 0) {
    return `No result states a publication date, so none of them can be called today's news; say that the date is not stated. ${TEXT_DAYS_NOTE}`;
  }

  if (evidence.newestAgeDays !== null && evidence.newestAgeDays > 0) {
    const days = evidence.newestAgeDays;

    return `None of these results is from today; the newest is ${days} day${days === 1 ? "" : "s"} old. Do not call them today's news: give each one's date or how long ago it was, and say that nothing newer was found. ${TEXT_DAYS_NOTE}`;
  }

  // The model reads at most `readCount` items, the freshest first. When
  // only some of them are from today it is told how many, because "the first N
  // are from today" is followed far more reliably than a general rule.
  const read = evidence.items.slice(0, readCount);
  const fromToday = read.filter((item) => item.ageDays === 0).length;
  const split =
    fromToday < read.length
      ? ` Only the first ${fromToday} of ${read.length} ${fromToday === 1 ? "is" : "are"} from today: say so in the first sentence; the rest are older.`
      : "";

  return `At least one result is from today (age_days 0). Report it as today's news; never say that nothing from today was found.${split} ${TEXT_DAYS_NOTE}`;
}
