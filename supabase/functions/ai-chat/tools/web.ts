// supabase/functions/ai-chat/tools/web.ts
// web_search tool: decides what to search (trusted sites first, the language of
// the place, a second wording when the first finds too little), judges the
// results and hands the model only what it should read. The Tavily call is in
// tavily.ts and the helpers are in web-support.ts.

import {
  WEB_BROAD_RESULTS,
  WEB_BROAD_SNIPPET_CHARS,
  WEB_FETCH_NEWS,
  WEB_FETCH_RESULTS,
  WEB_MAX_RESULTS,
  WEB_NEWS_RESULTS,
} from "../config.ts";
import type { ToolContext, ToolOutcome, WebResult } from "../types.ts";
import { dayKey } from "../retrieval/dates.ts";
import { evidenceNote, selectEvidence, type Evidence } from "../retrieval/evidence.ts";
import {
  MIN_USEFUL_RESULTS,
  mergeResults,
  needsWiderSearch,
} from "../retrieval/widen.ts";
import { scriptsOfLanguage } from "../retrieval/script.ts";
import { preferredDomains } from "../retrieval/sources.ts";
import {
  languageTag,
  sameLanguage,
  translateQuery,
} from "../retrieval/translate.ts";
import { simplifyQuery } from "../retrieval/simplify.ts";
import { splitAspects } from "../retrieval/aspects.ts";
import {
  classifyKinds,
  dropNotNews,
  kindCounts,
  type ResultKind,
} from "../retrieval/kind.ts";
import { tavilySearch } from "./tavily.ts";
import { searchSides } from "./web-sides.ts";
import {
  BROAD_NOTE,
  RELEVANCE_NOTE,
  flag,
  forModel,
  scriptOf,
  sourcesCard,
} from "./web-support.ts";

// Other files and tests import these from here.
export { tavilySearch } from "./tavily.ts";
export { sourcesCard } from "./web-support.ts";

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

  // The search goes out in the language of the place the question is about,
  // whatever language the model wrote it in, so the same question asked in any
  // language finds the same pages: when the search's writing system is not the
  // place language's, a small model translates it first, and the model's own
  // wording stays as a second search for when the first is thin.
  const placeScripts = scriptsOfLanguage(placeLanguage);
  let searchQuery = query;
  let pretranslated = false;

  if (
    recencyMatters &&
    placeScripts !== null &&
    !sameLanguage(placeLanguage, locale) &&
    !placeScripts.includes(scriptOf(query))
  ) {
    const inPlaceLanguage = await translateQuery(
      query,
      placeLanguage ?? "",
      signal,
    );

    if (inPlaceLanguage) {
      searchQuery = inPlaceLanguage;
      pretranslated = true;
    }
  }

  // News and fresh data are first looked for on the trusted sites of the
  // country and field the model named (see retrieval/sources.ts). Only when
  // those give too little does the search open up to the whole web.
  const preferred = recencyMatters
    ? preferredDomains(args.country, args.topic)
    : null;
  const isThin = (found: Evidence | null): boolean =>
    found === null ||
    found.weakMatch ||
    found.items.length < MIN_USEFUL_RESULTS;

  let results = await tavilySearch(
    searchQuery,
    ctx.tavilyKey,
    fetchCount,
    signal,
    fresh,
    news,
    preferred,
  );
  let evidence =
    results !== null && results.length > 0 ? judge(results, searchQuery) : null;
  let openedUp = false;

  if (preferred && isThin(evidence)) {
    const open = await tavilySearch(
      searchQuery,
      ctx.tavilyKey,
      fetchCount,
      signal,
      fresh,
      news,
    );

    if (open !== null && open.length > 0) {
      results = mergeResults(results ?? [], open);
      evidence = judge(results, searchQuery);
      openedUp = true;
    }
  }

  // A broad news question has several sides, and one search finds mostly one of
  // them: each other side is searched on its own and merged in. A question
  // about one event gets no extra search (see retrieval/aspects.ts).
  let aspectCount = 0;
  const sides = news ? await splitAspects(searchQuery, signal) : [];

  if (sides.length > 0) {
    const merged = await searchSides(
      sides,
      ctx.tavilyKey,
      fetchCount,
      signal,
      fresh,
      news,
      preferred,
      results ?? [],
    );

    if (merged.length > (results?.length ?? 0)) {
      results = merged;
      evidence = judge(results, searchQuery);
      aspectCount = sides.length;
    }
  }

  let widened = false;

  // A thin first search is repeated once in the language of the place (the
  // model's own wording, a local_query, or a translation by a small model);
  // what the second search finds is added, never replacing the first. A search
  // with nothing from today is not repeated when it was already in the place's
  // language: pages of another language would only crowd out its own news.
  let secondQuery =
    localQuery && localQuery.toLowerCase() !== searchQuery.toLowerCase()
      ? localQuery
      : "";
  let translated = pretranslated;
  let simplified = false;

  const wider = pretranslated
    ? isThin(evidence)
    : needsWiderSearch(evidence, results ?? [], recencyMatters);

  if (wider) {
    if (pretranslated && !secondQuery) {
      secondQuery = query;
    }

    if (
      !pretranslated &&
      !secondQuery &&
      placeLanguage !== null &&
      !sameLanguage(placeLanguage, locale)
    ) {
      secondQuery =
        (await translateQuery(searchQuery, placeLanguage, signal)) ?? "";
      translated = secondQuery.length > 0;
    }

    // No other language to try and the first search found only loosely related
    // pages: search again with the plain keywords of the subject.
    if (
      !secondQuery &&
      recencyMatters &&
      (evidence === null || evidence.weakMatch)
    ) {
      secondQuery = (await simplifyQuery(searchQuery, signal)) ?? "";
      simplified = secondQuery.length > 0;
    }

    if (
      secondQuery &&
      secondQuery.toLowerCase() !== searchQuery.toLowerCase()
    ) {
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
        evidence = judge(results, `${searchQuery} ${secondQuery}`);
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

  // News and fresh data are ordered by freshness, and the app says itself when
  // nothing is from today (see retrieval/evidence.ts).
  const zone = ctx.timeZone;
  const found = evidence ?? judge(results, searchQuery);

  // A news answer must be built from reports of what happened. A small model
  // labels what each result is, and timetables, previews and roundups are left
  // out before the model reads anything (see retrieval/kind.ts). If the labels
  // cannot be had, every result is kept, exactly as before.
  let kinds: (ResultKind | null)[] | null = null;

  if (recencyMatters && !found.weakMatch && found.items.length > 0) {
    kinds = await classifyKinds(found.items, signal);
  }

  const judged = kinds ? dropNotNews(found, kinds) : found;

  // Broad layout (by side, up to eight items) only when there is enough to
  // group: a few items are answered as usual.
  const broad = aspectCount > 0 && judged.items.length >= 4;
  const readCount = broad
    ? WEB_BROAD_RESULTS
    : recencyMatters
      ? WEB_NEWS_RESULTS
      : WEB_MAX_RESULTS;
  const evidenceText = evidenceNote(judged, recencyMatters, readCount);
  const note = recencyMatters
    ? [evidenceText, RELEVANCE_NOTE, broad ? BROAD_NOTE : ""]
        .filter(Boolean)
        .join(" ")
    : evidenceText;
  const shown = judged.items.slice(0, readCount);

  // News answers carry a sources card under them: the real pages the model was
  // given (addresses come from the search, never from the model, and the model
  // never sees them). Other searches carry none.
  const pages = shown.flatMap((item) => {
    const page = results.find(
      (result) =>
        result.title === item.title && result.snippet === item.snippet,
    );

    return page ? [page] : [];
  });
  const sources = recencyMatters ? sourcesCard(pages, ctx.lang) : null;

  // Numbers only (see EvidenceStats): never the question or any page text.
  console.log(
    JSON.stringify({
      event: "web_evidence",
      fresh,
      news,
      kept: judged.items.length,
      shown: shown.length,
      widened,
      hasLocal:
        localQuery.length > 0 &&
        localQuery.toLowerCase() !== searchQuery.toLowerCase(),
      // Translated by the app (before the first search, or for the second).
      translated,
      pretranslated,
      // Trusted sites searched first (0 = whole web); opened up to the web.
      preferred: preferred ? preferred.length : 0,
      openedUp,
      simplified,
      // Other sides searched for a broad subject; answered by side.
      aspects: aspectCount,
      broad,
      // Label counts and results dropped as not reports (null = no labels).
      kinds: kinds ? kindCounts(kinds) : null,
      droppedNotNews: found.items.length - judged.items.length,
      // Language tags and writing systems only, never the words.
      placeLanguage,
      answerLanguage: languageTag(locale),
      queryScript: scriptOf(query),
      searchScript: scriptOf(searchQuery),
      secondScript: secondQuery ? scriptOf(secondQuery) : null,
      // A handful of characters means a page menu, not an article.
      snippetChars: shown.map((item) => item.snippet.length),
      // Score of each page the model reads, in the order it reads them.
      shownRelevance: shown.map((item) => Math.round(item.relevance * 100) / 100),
      ...judged.stats,
    }),
  );

  return {
    data: {
      as_of: dayKey(ctx.now, zone),
      results: shown.map((item) =>
        forModel(item, ctx, locale, broad ? WEB_BROAD_SNIPPET_CHARS : null),
      ),
      ...(note ? { note } : {}),
    },
    ...(sources ? { cards: [sources] } : {}),
  };
}
