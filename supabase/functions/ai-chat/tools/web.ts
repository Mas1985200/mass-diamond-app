// supabase/functions/ai-chat/tools/web.ts
// web_search tool backed by Tavily, with a small in-memory cache.

import {
  TOOL_TIMEOUT_MS,
  WEB_CACHE_MAX_ENTRIES,
  WEB_CACHE_TTL_MS,
  WEB_MAX_RESULTS,
  WEB_SNIPPET_CHARS,
} from "../config.ts";
import type { ToolContext, ToolOutcome, WebResult } from "../types.ts";
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
): Promise<WebResult[] | null> {
  const cacheKey = `${maxResults}:${query.trim().toLowerCase()}`;
  const cached = webCache.get(cacheKey);

  if (cached && Date.now() - cached.at < WEB_CACHE_TTL_MS) {
    return cached.results;
  }

  const timed = createAttempt(master, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/search", {
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
      }),
      signal: timed.signal,
    });

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

      let host = "";

      try {
        const parsed = new URL(rawUrl);

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          continue;
        }

        host = parsed.hostname.replace(/^www\./, "");
      } catch {
        continue;
      }

      if (!title) {
        continue;
      }

      results.push({
        title: title.slice(0, 80),
        source: host.slice(0, 40),
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

export async function runWebSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";

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
  );

  if (results === null) {
    return { data: { error: "Web search failed." } };
  }

  if (results.length === 0) {
    return { data: { results: [], note: "No web results were found." } };
  }

  return { data: { results } };
}
