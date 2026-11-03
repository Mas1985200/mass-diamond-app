// supabase/functions/ai-chat/retrieval/evidence.ts
// The retrieval and verification step between a web search and the model.
// Search results are only candidates. Before the model reads them, the app:
//   1. works out how old each one is (dates.ts);
//   2. drops results that have almost nothing to do with the question;
//   3. merges the same story reported by several sites and counts how many
//      independent sites carry it;
//   4. orders news by freshness;
//   5. says plainly when nothing is from today or no date is stated.
// Nothing here depends on a language or a topic: it compares words with words.

import { WEB_NEWS_RESULTS } from "../config.ts";
import { normalizeForMatching } from "../routing/capability.ts";
import type { WebResult } from "../types.ts";
import { ageInDays } from "./dates.ts";

// News older than this is left out when fresher results exist.
export const STALE_AFTER_DAYS = 30;

// Without the search service's own score, a result must share at least this
// part of the question's words (or half of what the best result shares,
// whichever is higher) to be kept.
const MIN_RELEVANCE = 0.34;

// With the search service's own score (it understands meaning and synonyms, so
// a match report is found for "latest football news" although it shares no word
// with the question), only a result far below the best one is dropped.
const MIN_SCORE_SHARE = 0.4;

// When even the best result scores below this, nothing found really answers
// the question: the keep-the-best-share rule above would otherwise let weak
// results through just because all of them are weak (a question about one
// topic answered with stories about another).
const WEAK_SCORE = 0.3;

// Two titles are one story when they share this much of their words and each
// has enough words for the comparison to mean something.
const SAME_STORY = 0.6;
const MIN_TITLE_WORDS = 4;

export type EvidenceItem = {
  readonly title: string;
  readonly snippet: string;
  readonly published: string;
  readonly ageDays: number | null;
  // How many different sites carry this same story (1 = just one).
  readonly independentSources: number;
  readonly relevance: number;
};

// Numbers only, never text: they say what the step did, so a weak answer can be
// traced to the search or to the filter without storing what the user asked.
export type EvidenceStats = {
  readonly considered: number;
  readonly droppedIrrelevant: number;
  readonly droppedStale: number;
  readonly merged: number;
  // For every result the search returned, in order (null = no readable date).
  readonly relevance: readonly number[];
  readonly ageDays: readonly (number | null)[];
};

export type Evidence = {
  readonly items: readonly EvidenceItem[];
  readonly newestAgeDays: number | null;
  readonly datedCount: number;
  // True when the search service's own score says no result is a real match.
  readonly weakMatch: boolean;
  readonly stats: EvidenceStats;
};

export type EvidenceOptions = {
  readonly now: Date;
  readonly zone: string | null;
  // True for news and fresh data: freshness decides the order.
  readonly recencyMatters: boolean;
};

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

// Words of a text, folded so spelling variants meet. Chinese, Japanese and
// Korean text has no spaces, so it is split into pairs of characters.
export function tokensOf(text: string): string[] {
  const folded = normalizeForMatching(text).toLowerCase();
  const found = new Set<string>();

  for (const part of folded.split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!part) {
      continue;
    }

    if (CJK.test(part)) {
      const chars = [...part];

      if (chars.length === 1) {
        found.add(part);
      }

      for (let index = 0; index + 1 < chars.length; index += 1) {
        found.add(`${chars[index]}${chars[index + 1]}`);
      }
    } else if (part.length >= 3) {
      found.add(part);
    }
  }

  return [...found];
}

// "خبر" meets "خبرهای" and "play" meets "players": one word may begin the other
// when it is at least three letters and at least half as long.
function sameWord(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  return (
    short.length >= 3 && short.length * 2 >= long.length && long.startsWith(short)
  );
}

function hasWord(words: readonly string[], word: string): boolean {
  return words.some((candidate) => sameWord(candidate, word));
}

// Share of the question's words that appear in the result.
export function relevanceOf(
  queryWords: readonly string[],
  result: { readonly title: string; readonly snippet: string },
): number {
  if (queryWords.length === 0) {
    return 0;
  }

  const words = tokensOf(`${result.title} ${result.snippet}`);
  const matched = queryWords.filter((word) => hasWord(words, word)).length;

  return matched / queryWords.length;
}

// Shared words divided by all the different words of both titles (1 = same).
// Counting against the union keeps two short, different headlines apart.
function overlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const shared = a.filter((word) => hasWord(b, word)).length;

  return shared / (a.length + b.length - shared);
}

type Candidate = {
  readonly result: WebResult;
  readonly ageDays: number | null;
  readonly relevance: number;
  readonly titleWords: string[];
};

type Cluster = {
  lead: Candidate;
  readonly hosts: Set<string>;
};

// Newer is better; a result without a date is the oldest.
function isNewer(a: Candidate, b: Candidate): boolean {
  if (a.ageDays === null) {
    return false;
  }

  return b.ageDays === null || a.ageDays < b.ageDays;
}

export function selectEvidence(
  results: readonly WebResult[],
  query: string,
  options: EvidenceOptions,
): Evidence {
  const queryWords = tokensOf(query);

  // The service's own judgement is used when every result carries it; otherwise
  // the words of the question are compared with the words of each result.
  const scored =
    results.length > 0 && results.every((result) => typeof result.score === "number");

  let candidates: Candidate[] = results.map((result) => ({
    result,
    ageDays: ageInDays(result.published, options.now, options.zone),
    relevance: scored ? (result.score ?? 0) : relevanceOf(queryWords, result),
    titleWords: tokensOf(result.title),
  }));

  const stats = {
    considered: candidates.length,
    relevance: candidates.map((item) => Math.round(item.relevance * 100) / 100),
    ageDays: candidates.map((item) => item.ageDays),
  };

  // 2. Results that have almost nothing to do with the question are dropped.
  // When no result shares any word with the question (for example the question
  // is in another language than the pages) nothing can be judged, so all are
  // kept.
  const best = Math.max(0, ...candidates.map((item) => item.relevance));

  if (scored) {
    if (best > 0) {
      candidates = candidates.filter(
        (item) => item.relevance >= best * MIN_SCORE_SHARE,
      );
    }
  } else if (queryWords.length >= 2 && best > 0) {
    const floor = Math.max(Math.min(MIN_RELEVANCE, best), best * 0.5);

    candidates = candidates.filter((item) => item.relevance >= floor);
  }

  const afterRelevance = candidates.length;

  // Old news is dropped when fresher results exist.
  if (options.recencyMatters) {
    const fresher = candidates.filter(
      (item) => item.ageDays === null || item.ageDays <= STALE_AFTER_DAYS,
    );

    if (fresher.length > 0) {
      candidates = fresher;
    }
  }

  const afterStale = candidates.length;

  // 3. The same story from several sites becomes one item.
  const clusters: Cluster[] = [];

  for (const candidate of candidates) {
    const same = clusters.find(
      (cluster) =>
        candidate.titleWords.length >= MIN_TITLE_WORDS &&
        cluster.lead.titleWords.length >= MIN_TITLE_WORDS &&
        overlap(candidate.titleWords, cluster.lead.titleWords) >= SAME_STORY,
    );

    if (!same) {
      clusters.push({
        lead: candidate,
        hosts: new Set([candidate.result.source]),
      });
      continue;
    }

    same.hosts.add(candidate.result.source);

    if (isNewer(candidate, same.lead)) {
      same.lead = candidate;
    }
  }

  // 4. News is ordered by freshness, other searches keep the search order.
  const ordered = options.recencyMatters
    ? [...clusters].sort((a, b) => {
        if (a.lead.ageDays === b.lead.ageDays) {
          return b.lead.relevance - a.lead.relevance;
        }

        if (a.lead.ageDays === null) {
          return 1;
        }

        if (b.lead.ageDays === null) {
          return -1;
        }

        return a.lead.ageDays - b.lead.ageDays;
      })
    : clusters;

  const items: EvidenceItem[] = ordered.map((cluster) => ({
    title: cluster.lead.result.title,
    snippet: cluster.lead.result.snippet,
    published: cluster.lead.result.published,
    ageDays: cluster.lead.ageDays,
    independentSources: cluster.hosts.size,
    relevance: cluster.lead.relevance,
  }));

  const ages = items
    .map((item) => item.ageDays)
    .filter((age): age is number => age !== null);

  return {
    items,
    newestAgeDays: ages.length > 0 ? Math.min(...ages) : null,
    datedCount: ages.length,
    weakMatch: scored && best < WEAK_SCORE,
    stats: {
      ...stats,
      droppedIrrelevant: stats.considered - afterRelevance,
      droppedStale: afterRelevance - afterStale,
      merged: afterStale - clusters.length,
    },
  };
}

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

  // The model reads at most WEB_NEWS_RESULTS items, the freshest first. When
  // only some of them are from today it is told how many, because "the first N
  // are from today" is followed far more reliably than a general rule.
  const read = evidence.items.slice(0, WEB_NEWS_RESULTS);
  const fromToday = read.filter((item) => item.ageDays === 0).length;
  const split =
    fromToday < read.length
      ? ` Only the first ${fromToday} of ${read.length} ${fromToday === 1 ? "is" : "are"} from today: say so in the first sentence; the rest are older.`
      : "";

  return `At least one result is from today (age_days 0). Report it as today's news; never say that nothing from today was found.${split} ${TEXT_DAYS_NOTE}`;
}
