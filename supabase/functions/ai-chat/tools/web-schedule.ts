// supabase/functions/ai-chat/tools/web-schedule.ts
// A broad news answer may also say which matches or events are planned, as long
// as the model is told that these are plans and not news. The timetables found
// are normally left out of a news answer (see retrieval/kind.ts); here at most
// two of them are kept apart, marked as schedules, after the real news.

import type { EvidenceItem, Evidence } from "../retrieval/evidence.ts";
import type { ResultKind } from "../retrieval/kind.ts";

export const MAX_SCHEDULES = 2;

// Said beside the results only when schedules are among them. It is the one
// exception to the rule that a bullet reports what already happened.
export const SCHEDULE_NOTE =
  "Results marked kind schedule are timetables of what is planned, not news: put them together under one separate heading for upcoming events, write each as planned or scheduled with its date and the names, and never give a result, a score or past tense for them. This is the only exception to writing about what already happened.";

// The timetables to keep: only when something was really left out as not news
// (when nothing or everything was, the answer stays as it is) and only the
// first few, never one the news list already holds.
export function pickSchedules(
  found: Evidence,
  judged: Evidence,
  kinds: readonly (ResultKind | null)[] | null,
  allowed: boolean,
): EvidenceItem[] {
  if (!allowed || !kinds || judged.items.length === found.items.length) {
    return [];
  }

  return found.items
    .filter((item, index) => kinds[index] === "schedule" && !judged.items.includes(item))
    .slice(0, MAX_SCHEDULES);
}
