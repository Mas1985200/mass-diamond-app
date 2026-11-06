// supabase/functions/ai-chat/tools/web-support.ts
// Helpers of the web_search tool: the note placed beside the results, the shape
// the model reads for one story, the writing-system check used in the logs, the
// true/false reader and the sources card. (web.ts holds the search flow.)

import type {
  CardPayload,
  SourceItem,
  ToolContext,
  WebResult,
} from "../types.ts";
import {
  dateLabel,
  publishedDay,
  whenLabel,
} from "../retrieval/dates.ts";
import type { EvidenceItem } from "../retrieval/evidence.ts";
import { withoutSiteNames } from "../retrieval/clean.ts";

// Said with every news or fresh-data search, next to the results, because the
// model follows what sits beside the results more closely than the long rules
// in the system prompt. It keeps the answer to results about the question and
// stops a schedule or a table from being read as news. The note is written in
// English, so its last sentence says that the answer itself must never be:
// without it the model copies the English wording into answers in other
// languages.
export const RELEVANCE_NOTE =
  "Use only results about what was asked; leave out and never mention the others. A schedule, table or live ticker shows what is planned, not what happened: never present its entries as played or as news. A rumour or an expectation is not news: say that it is only reported. Never name a news agency, newspaper or website, even when the result's text does, and never add a remark about where the text came from. Write only what a result says: names, roles, scores and dates exactly as written, and a report as a report, said in an ordinary sentence in the user's language and never as a bracketed label or tag, never as a fact the text does not state. Write day and month names only in the language of the user's message, never a Persian month for another reader. If nothing is from today, begin with one sentence in the user's language saying that nothing from today was found (never that nothing was published), then give at most three relevant recent results with dates. This note is in English only for you: never copy any of its words into the answer; write everything in the language of the user's message, and never write English unless the user wrote English.";

// Added to the notes when a news question was broad: the results then cover
// several sides of one subject, and the answer is laid out by side. It replaces
// the usual limit of three or five items and the ban on a closing question.
export const BROAD_NOTE =
  "These results cover several sides of one subject. Group the items under short plain headings in the user's language, one heading per side (for example a league, a national team, a club), each followed by dated one-line items, newest first, up to eight items in all and never one story twice. Then end with one short question offering to go deeper into one of the sides. This layout replaces the usual limit of three or five items and the ban on a closing question.";

// What the model reads about one story: the text, its date, what the app
// worked out (how old it is, how many sites carry it). No address and no site
// name: the model has nothing to quote as a source. The date in 'published' is
// written by the app in the user's own calendar whenever the app could read the
// page's date, so the model never converts one calendar to another (it gets
// that wrong); a date the app cannot read is passed on as the page wrote it.
export function forModel(
  item: EvidenceItem,
  ctx: ToolContext,
  locale: string | null = null,
  snippetChars: number | null = null,
  schedule = false,
): Record<string, string | number> {
  const day = item.published
    ? publishedDay(item.published, ctx.now, ctx.timeZone)
    : null;
  const published =
    (day ? dateLabel(day, ctx.lang, locale) : null) ?? item.published;

  return {
    title: withoutSiteNames(item.title),
    snippet:
      snippetChars === null
        ? withoutSiteNames(item.snippet)
        : withoutSiteNames(item.snippet).slice(0, snippetChars).trimEnd(),
    ...(published ? { published } : {}),
    when: whenLabel(item.ageDays),
    ...(item.ageDays !== null ? { age_days: item.ageDays } : {}),
    ...(schedule ? { kind: "schedule" } : {}),
    ...(item.independentSources > 1
      ? { reported_by: item.independentSources }
      : {}),
  };
}

// Which writing system most of a search is in ("latin", "arabic", "cyrillic",
// "han", ...). Logged instead of the search itself, so that the logs show which
// language the model searched in without ever keeping what the user asked.
const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ["latin", /\p{Script=Latin}/gu],
  ["arabic", /\p{Script=Arabic}/gu],
  ["cyrillic", /\p{Script=Cyrillic}/gu],
  ["devanagari", /\p{Script=Devanagari}/gu],
  ["han", /\p{Script=Han}/gu],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["hangul", /\p{Script=Hangul}/gu],
];

export function scriptOf(text: string): string {
  let best = "other";
  let bestCount = 0;

  for (const [name, pattern] of SCRIPTS) {
    const count = text.match(pattern)?.length ?? 0;

    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }

  return best;
}

// The model sometimes writes a true/false field as text ("True", "false").
export function flag(value: unknown): boolean {
  if (typeof value === "string") {
    return ["true", "yes", "1"].includes(value.trim().toLowerCase());
  }

  return value === true;
}

// The real pages a web answer rests on, as a card. The addresses come only from
// the search results (never from the model), at most one per site. Shown under
// news answers (see runWebSearch).
export function sourcesCard(
  results: readonly WebResult[],
  lang: ToolContext["lang"],
): CardPayload | null {
  const items: SourceItem[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (seen.has(result.source)) {
      continue;
    }

    seen.add(result.source);
    items.push({
      url: result.url,
      host: result.source,
      title: result.title,
    });
  }

  return items.length > 0 ? { t: "sources", lang, items } : null;
}

// The search results behind the items the model was given, in the same order.
export function pagesOf(
  items: readonly Pick<EvidenceItem, "title" | "snippet">[],
  results: readonly WebResult[],
): WebResult[] {
  return items.flatMap((item) => {
    const page = results.find(
      (result) =>
        result.title === item.title && result.snippet === item.snippet,
    );

    return page ? [page] : [];
  });
}
