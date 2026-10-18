// supabase/functions/ai-chat/images/article.ts
// Which picture files a Wikipedia article uses, and which article fits a topic.

import { isRecord, pickString } from "../lib/util.ts";
import { getJson } from "./commons.ts";

const WIKI_LANG_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,8})?$/;
const MAX_CANDIDATES = 12;

// Flags, logos, icons and maps say nothing about the topic.
const SKIP_PATTERN =
  /(flag|logo|icon|locator|map|coat[_ ]of[_ ]arms|symbol|seal|emblem|edit-clear|question[_ ]book|wiktionary|disambig|commons-logo|ambox|padlock|stub)/i;

// For health topics only drawings and diagrams are used, never clinical photos.
export const DIAGRAM_PATTERN =
  /(diagram|anatomy|anatomical|illustration|infographic|schematic|scheme|mechanism|pathway|cycle|drawing|chart|structure|figure)/i;

export type FileFilter = {
  readonly diagramsOnly: boolean;
};

export function isUsableFile(title: string, filter: FileFilter): boolean {
  if (SKIP_PATTERN.test(title)) {
    return false;
  }

  if (filter.diagramsOnly) {
    return DIAGRAM_PATTERN.test(title) || /\.svg$/i.test(title);
  }

  // Outside diagrams, vector files are almost always symbols and logos.
  return !/\.svg$/i.test(title);
}

export function parseMediaList(json: unknown, filter: FileFilter): string[] {
  const items = isRecord(json) && Array.isArray(json.items) ? json.items : [];
  const titles: string[] = [];

  for (const raw of items) {
    if (!isRecord(raw) || raw.type !== "image") {
      continue;
    }

    const title = pickString(raw, "title");

    if (!/^[^:]+:.+/.test(title) || !isUsableFile(title, filter)) {
      continue;
    }

    if (!titles.includes(title)) {
      titles.push(title);
    }

    if (titles.length >= MAX_CANDIDATES) {
      break;
    }
  }

  return titles;
}

export async function fetchArticleFileTitles(
  lang: string,
  title: string,
  filter: FileFilter,
  master: AbortSignal,
): Promise<string[]> {
  const language = lang.toLowerCase();

  if (!WIKI_LANG_PATTERN.test(language) || !title.trim()) {
    return [];
  }

  const json = await getJson(
    `https://${language}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.trim().replace(/ /g, "_"))}`,
    master,
    "wikipedia media list",
  );

  return parseMediaList(json, filter);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
}

// The first search hit is used only when it really is about the same topic.
export function isRelatedTitle(query: string, title: string): boolean {
  const queryWords = new Set(words(query));

  return words(title).some((word) => queryWords.has(word));
}

export async function findArticleTitle(
  query: string,
  lang: string,
  master: AbortSignal,
): Promise<string> {
  const language = lang.toLowerCase();

  if (!WIKI_LANG_PATTERN.test(language) || !query.trim()) {
    return "";
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    list: "search",
    srsearch: query.trim().slice(0, 200),
    srlimit: "1",
  });

  const json = await getJson(
    `https://${language}.wikipedia.org/w/api.php?${params.toString()}`,
    master,
    "wikipedia title search",
  );

  const rows =
    isRecord(json) && isRecord(json.query) && Array.isArray(json.query.search)
      ? json.query.search
      : [];
  const first: unknown = rows[0];
  const title = isRecord(first) ? pickString(first, "title").trim() : "";

  return title && isRelatedTitle(query, title) ? title : "";
}

// Title of the same article on English Wikipedia (the widest picture library),
// from a langlinks response.
export function parseEnglishTitle(json: unknown): string {
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

export async function fetchEnglishTitle(
  lang: string,
  title: string,
  master: AbortSignal,
): Promise<string> {
  const language = lang.toLowerCase();

  if (!WIKI_LANG_PATTERN.test(language) || language === "en" || !title.trim()) {
    return "";
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "langlinks",
    lllang: "en",
    lllimit: "1",
    titles: title.trim(),
    redirects: "1",
  });

  return parseEnglishTitle(
    await getJson(
      `https://${language}.wikipedia.org/w/api.php?${params.toString()}`,
      master,
      "wikipedia english title",
    ),
  );
}

// The picture Wikipedia itself chose to represent the article (its lead image),
// from a pageimages response. Empty when the article has none.
export function parseLeadFile(json: unknown): string {
  const pages =
    isRecord(json) && isRecord(json.query) && Array.isArray(json.query.pages)
      ? json.query.pages
      : [];
  const first: unknown = pages[0];
  const name = isRecord(first) ? pickString(first, "pageimage").trim() : "";

  return name ? `File:${name.replace(/_/g, " ")}` : "";
}

export async function fetchLeadFile(
  lang: string,
  title: string,
  master: AbortSignal,
): Promise<string> {
  const language = lang.toLowerCase();

  if (!WIKI_LANG_PATTERN.test(language) || !title.trim()) {
    return "";
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "pageimages",
    piprop: "name",
    titles: title.trim(),
    redirects: "1",
  });

  const lead = parseLeadFile(
    await getJson(
      `https://${language}.wikipedia.org/w/api.php?${params.toString()}`,
      master,
      "wikipedia lead image",
    ),
  );

  return isUsableFile(lead, { diagramsOnly: false }) ? lead : "";
}
