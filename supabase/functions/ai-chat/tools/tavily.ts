// supabase/functions/ai-chat/tools/tavily.ts
// The Tavily search call with its small in-memory cache. (web.ts decides what
// to search and how to judge the results; this file only fetches them.)

import {
  TOOL_TIMEOUT_MS,
  WEB_CACHE_MAX_ENTRIES,
  WEB_CACHE_TTL_MS,
  WEB_SNIPPET_CHARS,
} from "../config.ts";
import type { WebResult } from "../types.ts";
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
  domains: readonly string[] | null = null,
): Promise<WebResult[] | null> {
  const sites = domains && domains.length > 0 ? domains : null;
  const cacheKey = `${fresh ? "fresh" : "any"}:${news ? "news" : "web"}:${maxResults}:${sites ? sites.join(",") : "all"}:${query.trim().toLowerCase()}`;
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
          ...(sites ? { include_domains: sites } : {}),
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
