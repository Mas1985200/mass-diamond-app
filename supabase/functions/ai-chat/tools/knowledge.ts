// supabase/functions/ai-chat/tools/knowledge.ts
// lookup_knowledge tool: verified background knowledge.
//  - Wikipedia in any language: the best article is read in full and only the
//    passages that answer the user's question are returned (not just the
//    introduction), so details such as "how does X form" are really grounded.
//  - The same article in the user's language (when it exists) is added as a
//    terminology source, so technical terms are copied, not guessed.
//  - OpenAlex: scholarly papers from universities and journals worldwide.
// No API key is needed.

import { NOMINATIM_USER_AGENT, WIKI_TIMEOUT_MS } from "../config.ts";
import type { PhotoItem, ToolContext, ToolOutcome } from "../types.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import { fetchLicensedPhotos } from "../images/photos.ts";

const KNOWLEDGE_QUERY_MAX_CHARS = 200;
const KNOWLEDGE_FOCUS_MAX_CHARS = 300;
const WIKI_MAX_ARTICLES = 2;
const WIKI_INTRO_CHARS = 700;
const SECOND_ARTICLE_CHARS = 400;
const PASSAGE_BUDGET_CHARS = 3_000;
const PASSAGE_MIN_CHARS = 60;
const PASSAGE_MAX_CHARS = 800;
const PASSAGE_INTRO_CHARS = 500;
const TERMINOLOGY_BUDGET_CHARS = 1_100;
const PAPERS_MAX = 4;
const PHOTOS_MAX = 3;
const WIKI_LANG_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,8})?$/;

const RESULT_NOTE =
  "Prefer these passages over your own memory when they differ. If they do not cover the question, answer from careful reasoning and say in one short sentence what you could not verify. When a terminology block is present, take the technical terms in the user's language from it exactly as written there instead of translating them yourself.";

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

export type Chunk = {
  readonly heading: string;
  readonly text: string;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function pickWikiLang(value: unknown, fallback: string): string {
  const lang = typeof value === "string" ? value.trim().toLowerCase() : "";

  return WIKI_LANG_PATTERN.test(lang) ? lang : fallback;
}

// ---------------------------------------------------------------------------
// Passage selection (pure functions, no network)
// ---------------------------------------------------------------------------

const CJK_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// Lower case, unify Arabic/Persian letter variants, drop diacritics, and split
// into words. Chinese, Japanese and Korean have no spaces, so they are split
// into pairs of characters.
export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0640]/g, "");

  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];

  for (const word of words) {
    if (CJK_PATTERN.test(word)) {
      const chars = [...word];

      if (chars.length === 1) {
        tokens.push(word);
      }

      for (let index = 0; index + 1 < chars.length; index += 1) {
        tokens.push(`${chars[index]}${chars[index + 1]}`);
      }
    } else if (word.length >= 2) {
      tokens.push(word);
    }
  }

  return tokens;
}

const HEADING_PATTERN = /^\s*={2,}\s*(.+?)\s*={2,}\s*$/;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// Splits a plain-text Wikipedia article (sections marked "== Title ==") into
// paragraphs, each remembering the section it belongs to.
export function splitIntoChunks(fullText: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "";
  let lines: string[] = [];

  const flush = (): void => {
    const text = lines.join(" ").replace(/\s+/g, " ").trim();

    lines = [];

    if (text.length >= PASSAGE_MIN_CHARS) {
      chunks.push({ heading, text: clip(text, PASSAGE_MAX_CHARS) });
    }
  };

  for (const line of fullText.split("\n")) {
    const match = HEADING_PATTERN.exec(line);

    if (match) {
      flush();
      heading = (match[1] ?? "").trim();
    } else if (line.trim().length === 0) {
      flush();
    } else {
      lines.push(line.trim());
    }
  }

  flush();

  return chunks;
}

// Picks the paragraphs that best match the question (term frequency weighted
// by how rare each term is, with a bonus for matching section titles), always
// keeps the opening paragraph for context, stays inside the character budget
// and returns the result in the article's own order.
export function selectPassages(
  fullText: string,
  focus: string,
  budget: number = PASSAGE_BUDGET_CHARS,
): string[] {
  const chunks = splitIntoChunks(fullText);

  if (chunks.length === 0) {
    return [];
  }

  const queryTokens = [...new Set(tokenize(focus))];
  const total = chunks.length;
  const bodies = chunks.map((chunk) => tokenize(chunk.text));
  const headings = chunks.map((chunk) => new Set(tokenize(chunk.heading)));
  const documentFrequency = new Map<string, number>();

  for (const token of queryTokens) {
    let count = 0;

    for (let index = 0; index < total; index += 1) {
      if (
        bodies[index]?.includes(token) ||
        headings[index]?.has(token)
      ) {
        count += 1;
      }
    }

    documentFrequency.set(token, count);
  }

  const scores = chunks.map((_chunk, index) => {
    let score = 0;

    for (const token of queryTokens) {
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const body = bodies[index] ?? [];
      const tf = body.reduce((sum, word) => sum + (word === token ? 1 : 0), 0);

      if (tf > 0) {
        score += idf * (1 + Math.log(tf));
      }

      if (headings[index]?.has(token)) {
        score += idf * 1.5;
      }
    }

    return score;
  });

  const picked = new Set<number>([0]);
  let used = Math.min(chunks[0]?.text.length ?? 0, PASSAGE_INTRO_CHARS);

  const ranked = chunks
    .map((_chunk, index) => index)
    .filter((index) => index !== 0)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);

  const anyMatch = ranked.some((index) => (scores[index] ?? 0) > 0);

  // With no overlap at all the article's opening paragraphs are the best guess.
  const order = anyMatch
    ? ranked.filter((index) => (scores[index] ?? 0) > 0)
    : [...ranked].sort((a, b) => a - b);

  for (const index of order) {
    const length = chunks[index]?.text.length ?? 0;

    if (used + length > budget) {
      continue;
    }

    picked.add(index);
    used += length;
  }

  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => {
      const chunk = chunks[index];

      if (!chunk) {
        return "";
      }

      const text = index === 0 ? clip(chunk.text, PASSAGE_INTRO_CHARS) : chunk.text;

      return chunk.heading ? `${chunk.heading}: ${text}` : text;
    })
    .filter((passage) => passage.length > 0);
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

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
    exchars: String(WIKI_INTRO_CHARS),
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

// The whole article as plain text, sections marked "== Title ==".
export async function fetchWikipediaFullText(
  title: string,
  lang: string,
  master: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    titles: title,
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
  const first: unknown = pages[0];

  return isRecord(first) ? pickString(first, "extract") : "";
}

// Title of the same article in another language, from a langlinks response.
export function parseLanglinkTitle(json: unknown): string {
  const pages =
    isRecord(json) && isRecord(json.query) && Array.isArray(json.query.pages)
      ? json.query.pages
      : [];
  const first: unknown = pages[0];

  if (!isRecord(first) || !Array.isArray(first.langlinks)) {
    return "";
  }

  const link: unknown = first.langlinks[0];

  return isRecord(link) ? pickString(link, "title").trim() : "";
}

// The same article in the user's language, when Wikipedia has one. It is the
// source of the standard technical terms of that language.
export async function fetchLanglinkTitle(
  title: string,
  fromLang: string,
  toLang: string,
  master: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "langlinks",
    lllang: toLang,
    lllimit: "1",
    titles: title,
    redirects: "1",
  });

  return parseLanglinkTitle(
    await fetchJson(
      `https://${fromLang}.wikipedia.org/w/api.php?${params.toString()}`,
      master,
    ),
  );
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
  const query = cleanText(args.query, KNOWLEDGE_QUERY_MAX_CHARS);

  if (!query) {
    return { data: { error: "query is required." } };
  }

  const focus = cleanText(args.focus, KNOWLEDGE_FOCUS_MAX_CHARS);
  const wantsPapers = args.scholarly === true;
  const lang = pickWikiLang(args.wiki_lang, ctx.lang);

  const papersPromise = wantsPapers
    ? fetchScholarlyPapers(query, signal)
    : Promise.resolve<KnowledgePaper[]>([]);

  // Articles in the asked language first; English is the world's widest
  // encyclopedia, so it is the fallback when nothing is found.
  let articles = await fetchWikipediaArticles(query, lang, signal);

  if (articles.length === 0 && lang !== "en") {
    articles = await fetchWikipediaArticles(query, "en", signal);
  }

  const top = articles[0];
  let passages: string[] = [];

  // Credited pictures of the article load while its text is read.
  const photosPromise: Promise<PhotoItem[]> = top
    ? fetchLicensedPhotos(top.lang, top.title, signal, { max: PHOTOS_MAX })
    : Promise.resolve([]);

  if (top) {
    const fullText = await fetchWikipediaFullText(top.title, top.lang, signal);

    passages = selectPassages(fullText, `${focus} ${query}`);

    if (passages.length === 0) {
      passages = [top.summary];
    }
  }

  // The article's terms in the user's own language (when it exists there).
  let terminology: { title: string; language: string; passages: string[] } | null =
    null;

  if (top && top.lang !== ctx.lang) {
    const localTitle = await fetchLanglinkTitle(
      top.title,
      top.lang,
      ctx.lang,
      signal,
    );

    if (localTitle) {
      const localText = await fetchWikipediaFullText(
        localTitle,
        ctx.lang,
        signal,
      );

      // The original term is usually written in brackets in the local
      // article, so the question's own words still find the right passages.
      const localPassages = selectPassages(
        localText,
        `${focus} ${query}`,
        TERMINOLOGY_BUDGET_CHARS,
      );

      if (localPassages.length > 0) {
        terminology = {
          title: localTitle,
          language: ctx.lang,
          passages: localPassages,
        };
      }
    }
  }

  const papers = await papersPromise;

  if (!top && papers.length === 0) {
    return {
      data: {
        results: [],
        note: "Nothing was found for this query. Answer from general knowledge, say you could not verify it, and never invent details.",
      },
    };
  }

  const results = articles.map((article, index) =>
    index === 0
      ? { title: article.title, language: article.lang, passages }
      : {
          title: article.title,
          language: article.lang,
          summary: clip(article.summary, SECOND_ARTICLE_CHARS),
        },
  );

  const photos = await photosPromise;

  return {
    data: {
      results,
      ...(terminology ? { terminology } : {}),
      ...(wantsPapers ? { papers } : {}),
      note: RESULT_NOTE,
    },
    ...(photos.length > 0
      ? { cards: [{ t: "photos" as const, lang: ctx.lang, items: photos }] }
      : {}),
  };
}
