// supabase/functions/ai-chat/tools/web.ts
// web_search tool backed by Tavily, with a small in-memory cache.

import {
  TOOL_TIMEOUT_MS,
  WEB_CACHE_MAX_ENTRIES,
  WEB_CACHE_TTL_MS,
  WEB_MAX_RESULTS,
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

// What the model reads: text and date, without the address.
function forModel(result: WebResult): Record<string, string> {
  return {
    title: result.title,
    source: result.source,
    snippet: result.snippet,
    ...(result.published ? { published: result.published } : {}),
  };
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
  const fresh = args.fresh === true;
  const news = args.news === true;

  if (!query) {
    return { data: { error: "query is required." } };
  }

  if (!ctx.tavilyKey) {
    return { data: { error: "Web search is not available." } };
  }

  const results = await tavilySearch(
    query,
    ctx.tavilyKey,
    WEB_MAX_RESULTS,
    signal,
    fresh,
    news,
  );

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
  return { data: { results: results.map(forModel) } };
}
