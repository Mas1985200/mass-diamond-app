// supabase/functions/ai-chat/tools/web.ts
// web_search tool backed by Tavily, with a small in-memory cache.

import {
  TOOL_TIMEOUT_MS,
  WEB_CACHE_MAX_ENTRIES,
  WEB_CACHE_TTL_MS,
  WEB_FETCH_NEWS,
  WEB_FETCH_RESULTS,
  WEB_MAX_RESULTS,
  WEB_NEWS_RESULTS,
  WEB_SNIPPET_CHARS,
} from "../config.ts";
import type {
  CardPayload,
  SourceItem,
  ToolContext,
  ToolOutcome,
  WebResult,
} from "../types.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import {
  dateLabel,
  dayKey,
  publishedDay,
  whenLabel,
} from "../retrieval/dates.ts";
import {
  evidenceNote,
  selectEvidence,
  type Evidence,
  type EvidenceItem,
} from "../retrieval/evidence.ts";
import { mergeResults, needsWiderSearch } from "../retrieval/widen.ts";
import { withoutSiteNames } from "../retrieval/clean.ts";
import {
  languageTag,
  sameLanguage,
  translateQuery,
} from "../retrieval/translate.ts";
import {
  classifyKinds,
  dropNotNews,
  kindCounts,
  type ResultKind,
} from "../retrieval/kind.ts";

// Said with every news or fresh-data search, next to the results, because the
// model follows what sits beside the results more closely than the long rules
// in the system prompt. It keeps the answer to results about the question and
// stops a schedule or a table from being read as news. The note is written in
// English, so its last sentence says that the answer itself must never be:
// without it the model copies the English wording into answers in other
// languages.
const RELEVANCE_NOTE =
  "Use only results about what was asked; leave out and never mention the others. A schedule, table or live ticker shows what is planned, not what happened: never present its entries as played or as news. A rumour or an expectation is not news: say that it is only reported. Never name a news agency, newspaper or website, even when the result's text does, and never add a remark about where the text came from. Write only what a result says: names, roles, scores and dates exactly as written, and a report as a report, said in an ordinary sentence in the user's language and never as a bracketed label or tag, never as a fact the text does not state. Write day and month names only in the language of the user's message, never a Persian month for another reader. If nothing is from today, begin with one sentence in the user's language saying that nothing from today was found (never that nothing was published), then give at most three relevant recent results with dates. This note is in English only for you: never copy any of its words into the answer; write everything in the language of the user's message, and never write English unless the user wrote English.";

const webCache = new Map<
  string,
  { readonly at: number; readonly results: WebResult[] }
>();

function rememberWebResults(key: string, results: WebResult[]): void {
  if (webCache.size >= WEB_CACHE_MAX_ENTRIES) {
    const oldest = webCache.keys().next().value;

    if (oldest !== undefined) {
      webCache.delete(oldest);
    }
  }

  webCache.set(key, { at: Date.now(), results });
}

export async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number,
  master: AbortSignal,
  fresh = false,
  news = false,
): Promise<WebResult[] | null> {
  const cacheKey = `${fresh ? "fresh" : "any"}:${news ? "news" : "web"}:${maxResults}:${query.trim().toLowerCase()}`;
  const cached = webCache.get(cacheKey);

  if (cached && Date.now() - cached.at < WEB_CACHE_TTL_MS) {
    return cached.results;
  }

  const timed = createAttempt(master, TOOL_TIMEOUT_MS);

  try {
    const send = (withNews: boolean): Promise<Response> =>
      fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: false,
          ...(fresh ? { time_range: "week" } : {}),
          ...(withNews ? { topic: "news" } : {}),
        }),
        signal: timed.signal,
      });

    let response = await send(news);

    // If the news filter is refused, the ordinary search still works.
    if (!response.ok && news) {
      console.error(
        `web_search news filter failed with status ${response.status}; retrying without it.`,
      );

      response = await send(false);
    }

    if (!response.ok) {
      console.error(`web_search failed with status ${response.status}.`);

      return null;
    }

    const json: unknown = await response.json();
    const rawResults =
      isRecord(json) && Array.isArray(json.results) ? json.results : [];
    const results: WebResult[] = [];

    for (const raw of rawResults) {
      if (!isRecord(raw)) {
        continue;
      }

      const title = pickString(raw, "title").trim();
      const rawUrl = pickString(raw, "url");
      const content = pickString(raw, "content");
      const published = pickString(raw, "published_date").trim();
      const score =
        typeof raw.score === "number" && Number.isFinite(raw.score)
          ? Math.min(1, Math.max(0, raw.score))
          : null;

      let host = "";
      let address = "";

      try {
        const parsed = new URL(rawUrl);

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          continue;
        }

        host = parsed.hostname.replace(/^www\./, "");
        address = parsed.href;
      } catch {
        continue;
      }

      if (!title) {
        continue;
      }

      results.push({
        title: title.slice(0, 80),
        source: host.slice(0, 40),
        url: address,
        published: published.slice(0, 40),
        snippet: content.slice(0, WEB_SNIPPET_CHARS),
        ...(score !== null ? { score } : {}),
      });
    }

    if (results.length > 0) {
      rememberWebResults(cacheKey, results);
    }

    return results;
  } catch (error) {
    console.error(`web_search threw: ${describeError(error)}`);

    return null;
  } finally {
    timed.clearConnectTimer();
  }
}

// What the model reads about one story: the text, its date, what the app
// worked out (how old it is, how many sites carry it). No address and no site
// name: the model has nothing to quote as a source. The date in 'published' is
// written by the app in the user's own calendar whenever the app could read the
// page's date, so the model never converts one calendar to another (it gets
// that wrong); a date the app cannot read is passed on as the page wrote it.
function forModel(
  item: EvidenceItem,
  ctx: ToolContext,
  locale: string | null = null,
): Record<string, string | number> {
  const day = item.published
    ? publishedDay(item.published, ctx.now, ctx.timeZone)
    : null;
  const published =
    (day ? dateLabel(day, ctx.lang, locale) : null) ?? item.published;

  return {
    title: withoutSiteNames(item.title),
    snippet: withoutSiteNames(item.snippet),
    ...(published ? { published } : {}),
    when: whenLabel(item.ageDays),
    ...(item.ageDays !== null ? { age_days: item.ageDays } : {}),
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

function scriptOf(text: string): string {
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
function flag(value: unknown): boolean {
  if (typeof value === "string") {
    return ["true", "yes", "1"].includes(value.trim().toLowerCase());
  }

  return value === true;
}

// The real pages a web answer rests on, as a card. The addresses come only from
// the search results (never from the model), at most one per site. Not shown at
// the moment (see runWebSearch).
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

export async function runWebSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
  const fresh = flag(args.fresh);
  const news = flag(args.news);
  const locale = typeof args.language === "string" ? args.language : null;
  const localQuery =
    typeof args.local_query === "string"
      ? args.local_query.trim().slice(0, 300)
      : "";
  const placeLanguage = languageTag(args.place_language);

  if (!query) {
    return { data: { error: "query is required." } };
  }

  if (!ctx.tavilyKey) {
    return { data: { error: "Web search is not available." } };
  }

  // News and fresh data cast the widest net; the app then keeps the best few.
  const recencyMatters = fresh || news;
  const fetchCount = recencyMatters ? WEB_FETCH_NEWS : WEB_FETCH_RESULTS;
  const judge = (found: readonly WebResult[], asked: string): Evidence =>
    selectEvidence(found, asked, {
      now: ctx.now,
      zone: ctx.timeZone,
      recencyMatters,
    });

  let results = await tavilySearch(
    query,
    ctx.tavilyKey,
    fetchCount,
    signal,
    fresh,
    news,
  );
  let evidence =
    results !== null && results.length > 0 ? judge(results, query) : null;
  let widened = false;

  // A thin first search is repeated once in the language of the place the
  // question is about; whatever the second search finds is added, never
  // replacing what the first found. The model writes that second wording
  // itself (local_query) or only names the place's language (place_language),
  // and then a small model translates the search.
  let secondQuery =
    localQuery && localQuery.toLowerCase() !== query.toLowerCase()
      ? localQuery
      : "";
  let translated = false;

  if (needsWiderSearch(evidence, results ?? [], recencyMatters)) {
    if (
      !secondQuery &&
      placeLanguage !== null &&
      !sameLanguage(placeLanguage, locale)
    ) {
      secondQuery = (await translateQuery(query, placeLanguage, signal)) ?? "";
      translated = secondQuery.length > 0;
    }

    if (secondQuery && secondQuery.toLowerCase() !== query.toLowerCase()) {
      const more = await tavilySearch(
        secondQuery,
        ctx.tavilyKey,
        fetchCount,
        signal,
        fresh,
        news,
      );

      if (more !== null && more.length > 0) {
        results = mergeResults(results ?? [], more);
        evidence = judge(results, `${query} ${secondQuery}`);
        widened = true;
      }
    }
  }

  if (results === null) {
    return { data: { error: "Web search failed." } };
  }

  if (results.length === 0) {
    return {
      data: {
        results: [],
        note: fresh
          ? "No recent web results were found."
          : "No web results were found.",
      },
    };
  }

  // The sources card (see sourcesCard) is not shown: the product decision is
  // that web answers carry no sources under them. To show it again, return
  // `cards: [sourcesCard(results, ctx.lang)]` here when it is not null.
  // News and fresh data are ordered by freshness, and the app says itself when
  // nothing is from today (see retrieval/evidence.ts).
  const zone = ctx.timeZone;
  const found = evidence ?? judge(results, query);

  // A news answer must be built from reports of what happened. A small model
  // labels what each result is, and timetables, previews and roundups are left
  // out before the model reads anything (see retrieval/kind.ts). If the labels
  // cannot be had, every result is kept, exactly as before.
  let kinds: (ResultKind | null)[] | null = null;

  if (recencyMatters && !found.weakMatch && found.items.length > 0) {
    kinds = await classifyKinds(found.items, signal);
  }

  const judged = kinds ? dropNotNews(found, kinds) : found;
  const evidenceText = evidenceNote(judged, recencyMatters);
  const note = recencyMatters
    ? [evidenceText, RELEVANCE_NOTE].filter(Boolean).join(" ")
    : evidenceText;
  const shown = judged.items.slice(
    0,
    recencyMatters ? WEB_NEWS_RESULTS : WEB_MAX_RESULTS,
  );

  // Numbers only (see EvidenceStats): never the question or any page text.
  console.log(
    JSON.stringify({
      event: "web_evidence",
      fresh,
      news,
      kept: judged.items.length,
      shown: shown.length,
      widened,
      // Whether the model gave a second wording in the place's own language.
      hasLocal:
        localQuery.length > 0 && localQuery.toLowerCase() !== query.toLowerCase(),
      // Whether the app had to translate the search itself.
      translated,
      // How many results got each label, and how many were left out because
      // they were not reports (numbers only; null = no labels were had).
      kinds: kinds ? kindCounts(kinds) : null,
      droppedNotNews: found.items.length - judged.items.length,
      // The language tags the model gave and the writing system of each search
      // (never the words), to see in the logs which language was searched.
      placeLanguage,
      answerLanguage: languageTag(locale),
      queryScript: scriptOf(query),
      secondScript: secondQuery ? scriptOf(secondQuery) : null,
      // How long each shown snippet is: a handful of characters means a page
      // menu or a bare headline, not an article.
      snippetChars: shown.map((item) => item.snippet.length),
      // The search service's score of each page the model reads, in the order
      // the model reads them (a word-overlap share when the service gave none).
      shownRelevance: shown.map((item) => Math.round(item.relevance * 100) / 100),
      ...judged.stats,
    }),
  );

  return {
    data: {
      as_of: dayKey(ctx.now, zone),
      results: shown.map((item) => forModel(item, ctx, locale)),
      ...(note ? { note } : {}),
    },
  };
}
