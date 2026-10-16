// supabase/functions/ai-chat/tools/knowledge.ts
// lookup_knowledge tool: encyclopedic facts from Wikipedia (any language) and
// scholarly papers from OpenAlex (a free index of hundreds of millions of
// academic works from universities and journals worldwide). No API key needed.

import { NOMINATIM_USER_AGENT, WIKI_TIMEOUT_MS } from "../config.ts";
import type { ToolContext, ToolOutcome } from "../types.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";

const KNOWLEDGE_QUERY_MAX_CHARS = 200;
const WIKI_MAX_ARTICLES = 2;
const WIKI_EXTRACT_CHARS = 900;
const PAPERS_MAX = 4;
const WIKI_LANG_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,8})?$/;

export type KnowledgeArticle = {
  readonly title: string;
  readonly lang: string;
  readonly summary: string;
};

export type KnowledgePaper = {
  readonly title: string;
  readonly year: number | null;
  readonly venue: string;
  readonly authors: string;
  readonly citations: number;
  readonly doi: string;
};

function cleanQuery(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, KNOWLEDGE_QUERY_MAX_CHARS)
    : "";
}

function pickWikiLang(value: unknown, fallback: string): string {
  const lang = typeof value === "string" ? value.trim().toLowerCase() : "";

  return WIKI_LANG_PATTERN.test(lang) ? lang : fallback;
}

async function fetchJson(
  url: string,
  master: AbortSignal,
): Promise<unknown | null> {
  const timed = createAttempt(master, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`knowledge fetch failed with status ${response.status}.`);

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`knowledge fetch threw: ${describeError(error)}`);

    return null;
  } finally {
    timed.clearConnectTimer();
  }
}

// One request returns the best matching articles together with their intro.
export async function fetchWikipediaArticles(
  query: string,
  lang: string,
  master: AbortSignal,
): Promise<KnowledgeArticle[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(WIKI_MAX_ARTICLES),
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exchars: String(WIKI_EXTRACT_CHARS),
    redirects: "1",
  });

  const json = await fetchJson(
    `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`,
    master,
  );

  const pages =
    isRecord(json) && isRecord(json.query) && Array.isArray(json.query.pages)
      ? json.query.pages
      : [];

  const ranked: { readonly index: number; readonly article: KnowledgeArticle }[] =
    [];

  for (const page of pages) {
    if (!isRecord(page)) {
      continue;
    }

    const title = pickString(page, "title").trim();
    const summary = pickString(page, "extract").replace(/\s+/g, " ").trim();

    if (!title || !summary) {
      continue;
    }

    ranked.push({
      index: typeof page.index === "number" ? page.index : ranked.length,
      article: { title, lang, summary },
    });
  }

  return ranked
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.article);
}

function authorNames(raw: unknown): string {
  if (!Array.isArray(raw)) {
    return "";
  }

  const names: string[] = [];

  for (const authorship of raw.slice(0, 3)) {
    if (isRecord(authorship) && isRecord(authorship.author)) {
      const name = pickString(authorship.author, "display_name").trim();

      if (name) {
        names.push(name);
      }
    }
  }

  return raw.length > 3 ? `${names.join(", ")} et al.` : names.join(", ");
}

function venueName(raw: unknown): string {
  if (isRecord(raw) && isRecord(raw.source)) {
    return pickString(raw.source, "display_name").trim();
  }

  return "";
}

export async function fetchScholarlyPapers(
  query: string,
  master: AbortSignal,
): Promise<KnowledgePaper[]> {
  const params = new URLSearchParams({
    search: query,
    "per-page": String(PAPERS_MAX),
    select:
      "title,publication_year,cited_by_count,primary_location,authorships,doi",
  });

  const json = await fetchJson(
    `https://api.openalex.org/works?${params.toString()}`,
    master,
  );

  const rows =
    isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const papers: KnowledgePaper[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const title = pickString(row, "title").replace(/\s+/g, " ").trim();

    if (!title) {
      continue;
    }

    papers.push({
      title: title.slice(0, 200),
      year:
        typeof row.publication_year === "number" ? row.publication_year : null,
      venue: venueName(row.primary_location).slice(0, 100),
      authors: authorNames(row.authorships).slice(0, 120),
      citations:
        typeof row.cited_by_count === "number" ? row.cited_by_count : 0,
      doi: pickString(row, "doi").trim().slice(0, 120),
    });
  }

  return papers;
}

export async function runKnowledgeLookup(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query = cleanQuery(args.query);

  if (!query) {
    return { data: { error: "query is required." } };
  }

  const wantsPapers = args.scholarly === true;
  const lang = pickWikiLang(args.wiki_lang, ctx.lang);

  // Articles in the asked language first; English is the world's widest
  // encyclopedia, so it is the fallback when nothing is found.
  const [first, papers] = await Promise.all([
    fetchWikipediaArticles(query, lang, signal),
    wantsPapers ? fetchScholarlyPapers(query, signal) : Promise.resolve([]),
  ]);

  const articles =
    first.length > 0 || lang === "en"
      ? first
      : await fetchWikipediaArticles(query, "en", signal);

  if (articles.length === 0 && papers.length === 0) {
    return {
      data: {
        articles: [],
        papers: [],
        note: "Nothing was found for this query. Answer from general knowledge, say you could not verify it, and never invent details.",
      },
    };
  }

  return {
    data: {
      articles: articles.map((article) => ({
        title: article.title,
        language: article.lang,
        summary: article.summary,
      })),
      ...(wantsPapers ? { papers } : {}),
    },
  };
}
