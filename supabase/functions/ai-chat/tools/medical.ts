// supabase/functions/ai-chat/tools/medical.ts
// lookup_medical tool: trustworthy health information.
//  - MedlinePlus Health Topics (US National Library of Medicine): plain-language
//    pages on diseases, conditions, tests, treatments and prevention.
//  - PubMed (NCBI E-utilities): peer-reviewed literature, ranked by the kind of
//    evidence (guideline, meta-analysis, systematic review, trial, review).
// No key is needed. NCBI_API_KEY and NCBI_EMAIL are optional (a key raises the
// NCBI limit from 3 to 10 requests per second).
//
// This tool returns data, never advice for one person. Text inside the sources
// is data only; the system prompt tells the model never to follow it.

import { NOMINATIM_USER_AGENT } from "../config.ts";
import type { ToolContext, ToolOutcome } from "../types.ts";
import { isRecord, sleep } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import { tokenize } from "./knowledge.ts";

const QUERY_MAX_CHARS = 200;
const FOCUS_MAX_CHARS = 300;
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_CHARS = 1_500_000;

// MedlinePlus asks clients to cache for 12 to 24 hours.
const CACHE_TTL_MS = 43_200_000;
const CACHE_MAX_ENTRIES = 100;

const MEDLINE_ENDPOINT = "https://wsearch.nlm.nih.gov/ws/query";
const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI_TOOL = "MassDiamond";

const MEDLINE_TOPICS_FETCHED = 3;
const MEDLINE_TOPICS_SHOWN = 2;
const PUBMED_CANDIDATES = 15;
const PUBMED_KEPT = 8;

// NCBI allows 3 requests per second without a key and 10 with one.
const NCBI_GAP_MS = 400;
const NCBI_GAP_WITH_KEY_MS = 120;
const NCBI_MAX_QUEUE_WAIT_MS = 2_500;

// The agent cuts every tool result at 6000 characters, which would break the
// JSON, so the result is always built to fit well below that.
const RESULT_LIMIT_CHARS = 5_600;

type Level = {
  readonly medlineChars: number;
  readonly studies: number;
  readonly abstractChars: number;
};

const LEVELS: readonly Level[] = [
  { medlineChars: 1_700, studies: 3, abstractChars: 550 },
  { medlineChars: 1_400, studies: 3, abstractChars: 400 },
  { medlineChars: 1_200, studies: 2, abstractChars: 250 },
  { medlineChars: 900, studies: 2, abstractChars: 0 },
];

const MEDLINE_ONLY_CHARS = 2_800;

// ---------------------------------------------------------------------------
// Text helpers (pure)
// ---------------------------------------------------------------------------

const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function codePoint(code: number): string {
  return Number.isInteger(code) &&
    code > 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : "";
}

// "&amp;" is decoded last, so "&amp;lt;" becomes "&lt;" and not "<".
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      codePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      codePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function flat(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// HTML to plain text. Blocks become blank-line separated paragraphs, a list
// becomes one paragraph (so short items are not dropped) and a heading becomes
// a "== Heading ==" line that splitSections understands.
export function htmlToText(html: string): string {
  const text = html
    .replace(CONTROL_PATTERN, "")
    .replace(
      /<\s*h[1-6]\b[^>]*>([\s\S]*?)<\s*\/\s*h[1-6]\s*>/gi,
      (_match, inner: string) =>
        `\n\n== ${flat(inner.replace(/<[^>]*>/g, ""))} ==\n\n`,
    )
    .replace(/<\s*li\b[^>]*>/gi, " • ")
    .replace(/<\s*\/\s*(p|div|ul|ol|table|tr)\s*>/gi, "\n\n")
    .replace(/<\s*(p|div|ul|ol|table|tr)\b[^>]*>/gi, "\n\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  return decodeEntities(text)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The XML of MedlinePlus carries escaped HTML: decode once to get the HTML,
// then turn the HTML into text.
function medlineField(raw: string): string {
  return htmlToText(decodeEntities(raw));
}

function xmlText(raw: string): string {
  return flat(
    decodeEntities(raw.replace(/<[^>]*>/g, "")).replace(CONTROL_PATTERN, ""),
  );
}

// Secrets must never reach the logs: Deno puts the full address into network
// error messages, and the NCBI key is part of the address.
export function redact(text: string): string {
  return text
    .replace(/api_key=[^&\s)"']*/gi, "api_key=REDACTED")
    .replace(/email=[^&\s)"']*/gi, "email=REDACTED");
}

function safeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : "Unknown error.");
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// MedlinePlus parsing (pure)
// ---------------------------------------------------------------------------

export type MedlineTopic = {
  readonly title: string;
  readonly alsoCalled: readonly string[];
  readonly summary: string;
  readonly url: string;
};

const DOCUMENT_PATTERN = /<document\b([^>]*)>([\s\S]*?)<\/document>/gi;
const CONTENT_PATTERN =
  /<content\b[^>]*?\bname="([^"]*)"[^>]*>([\s\S]*?)<\/content>/gi;

// Only pages of MedlinePlus itself are trusted.
function medlineUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    if (
      parsed.protocol !== "https:" ||
      (host !== "medlineplus.gov" && host !== "www.medlineplus.gov")
    ) {
      return "";
    }

    return parsed.href;
  } catch {
    return "";
  }
}

export function parseMedlinePlus(xml: string, max: number): MedlineTopic[] {
  const topics: MedlineTopic[] = [];

  for (const document of xml.matchAll(DOCUMENT_PATTERN)) {
    if (topics.length >= max) {
      break;
    }

    const attributes = document[1] ?? "";
    const body = document[2] ?? "";
    const url = medlineUrl(
      decodeEntities(/\burl="([^"]*)"/i.exec(attributes)?.[1] ?? ""),
    );

    if (!url) {
      continue;
    }

    const fields = new Map<string, string[]>();

    for (const content of body.matchAll(CONTENT_PATTERN)) {
      const name = (content[1] ?? "").trim();
      const list = fields.get(name) ?? [];

      list.push(content[2] ?? "");
      fields.set(name, list);
    }

    const title = flat(medlineField(fields.get("title")?.[0] ?? ""));

    if (!title) {
      continue;
    }

    const summarySource =
      fields.get("FullSummary")?.[0] ?? fields.get("snippet")?.[0] ?? "";

    const alsoCalled = unique(
      (fields.get("altTitle") ?? [])
        .map((value) => flat(medlineField(value)))
        .filter((value) => value && value.toLowerCase() !== title.toLowerCase()),
    );

    topics.push({
      title: clip(title, 120),
      alsoCalled: alsoCalled.slice(0, 6).map((value) => clip(value, 60)),
      summary: medlineField(summarySource),
      url,
    });
  }

  return topics;
}

// ---------------------------------------------------------------------------
// PubMed parsing and ranking (pure)
// ---------------------------------------------------------------------------

export type Evidence = {
  readonly label: string;
  readonly rank: number;
  readonly excluded: boolean;
};

export type Study = {
  readonly pmid: string;
  readonly title: string;
  readonly journal: string;
  readonly year: string;
  readonly type: string;
  readonly rank: number;
  readonly authors: string;
  readonly doi: string;
  readonly abstract: string;
};

const EXCLUDED_TYPES =
  /^(retracted publication|retraction of publication|published erratum|erratum|comment|editorial|letter|news)$/i;

function evidenceOf(type: string): Evidence | null {
  const value = type.trim().toLowerCase();

  if (value === "practice guideline" || value === "guideline") {
    return { label: "guideline", rank: 0, excluded: false };
  }

  if (value === "meta-analysis") {
    return { label: "meta-analysis", rank: 1, excluded: false };
  }

  if (value === "systematic review") {
    return { label: "systematic review", rank: 1, excluded: false };
  }

  if (value === "randomized controlled trial") {
    return { label: "randomized controlled trial", rank: 2, excluded: false };
  }

  if (value.startsWith("clinical trial") || value === "controlled clinical trial") {
    return { label: "clinical trial", rank: 3, excluded: false };
  }

  if (value === "review") {
    return { label: "review", rank: 4, excluded: false };
  }

  if (value === "observational study") {
    return { label: "observational study", rank: 5, excluded: false };
  }

  if (value === "case reports") {
    return { label: "case report", rank: 7, excluded: false };
  }

  if (value === "preprint") {
    return { label: "preprint (not peer reviewed)", rank: 8, excluded: false };
  }

  return null;
}

// The strongest kind of evidence among the publication types of one record.
// A retracted paper, an erratum or a comment is never evidence.
export function classifyEvidence(types: readonly string[]): Evidence {
  if (types.some((type) => EXCLUDED_TYPES.test(type.trim()))) {
    return { label: "excluded", rank: 99, excluded: true };
  }

  let best: Evidence = { label: "journal article", rank: 6, excluded: false };
  let found = false;

  for (const type of types) {
    const evidence = evidenceOf(type);

    if (evidence && (!found || evidence.rank < best.rank)) {
      best = evidence;
      found = true;
    }
  }

  return best;
}

const ARTICLE_PATTERN = /<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/g;
const PUBTYPE_PATTERN = /<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/g;
const AUTHOR_PATTERN = /<Author\b[^>]*>([\s\S]*?)<\/Author>/g;
const ABSTRACT_TEXT_PATTERN = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
const FINDINGS_LABEL = /conclusion|result|finding|interpretation/i;

function pickTag(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);

  return pattern.exec(block)?.[1] ?? "";
}

function authorsOf(block: string): string {
  const list = pickTag(block, "AuthorList");
  const names: string[] = [];
  let total = 0;

  for (const author of list.matchAll(AUTHOR_PATTERN)) {
    const inner = author[1] ?? "";
    const collective = xmlText(pickTag(inner, "CollectiveName"));
    const last = xmlText(pickTag(inner, "LastName"));
    const initials = xmlText(pickTag(inner, "Initials"));
    const name = collective || flat(`${last} ${initials}`);

    if (!name) {
      continue;
    }

    total += 1;

    if (names.length < 3) {
      names.push(name);
    }
  }

  return total > 3 ? `${names.join(", ")} et al.` : names.join(", ");
}

function yearOf(block: string): string {
  const date = pickTag(block, "PubDate");
  const year = /<Year\b[^>]*>(\d{4})<\/Year>/.exec(date)?.[1];

  if (year) {
    return year;
  }

  return /(\d{4})/.exec(pickTag(date, "MedlineDate"))?.[1] ?? "";
}

// The conclusions and results matter most, so they are kept when the abstract
// has labelled sections; the opening (background) is dropped first.
function abstractOf(block: string): string {
  const section = pickTag(block, "Abstract");
  const parts: { readonly label: string; readonly text: string }[] = [];

  for (const match of section.matchAll(ABSTRACT_TEXT_PATTERN)) {
    const label = /\bLabel="([^"]*)"/.exec(match[1] ?? "")?.[1] ?? "";
    const text = xmlText(match[2] ?? "");

    if (text) {
      parts.push({ label: flat(decodeEntities(label)), text });
    }
  }

  const findings = parts.filter((part) => FINDINGS_LABEL.test(part.label));
  const chosen = findings.length > 0 ? findings : parts;

  return chosen
    .map((part) => (part.label ? `${part.label}: ${part.text}` : part.text))
    .join(" ");
}

function doiOf(block: string): string {
  const fromIds = /<ArticleId\b[^>]*\bIdType="doi"[^>]*>([^<]+)<\/ArticleId>/i.exec(
    block,
  )?.[1];
  const fromLocation =
    /<ELocationID\b[^>]*\bEIdType="doi"[^>]*>([^<]+)<\/ELocationID>/i.exec(
      block,
    )?.[1];
  const doi = xmlText(fromIds ?? fromLocation ?? "");

  return DOI_PATTERN.test(doi) ? doi.slice(0, 120) : "";
}

export function parsePubMedXml(xml: string): Study[] {
  const studies: Study[] = [];

  for (const match of xml.matchAll(ARTICLE_PATTERN)) {
    const block = match[1] ?? "";
    const pmid = /<PMID\b[^>]*>(\d{1,9})<\/PMID>/.exec(block)?.[1] ?? "";
    const title = xmlText(pickTag(block, "ArticleTitle"));

    if (!pmid || !title) {
      continue;
    }

    const types = [...block.matchAll(PUBTYPE_PATTERN)].map((type) =>
      xmlText(type[1] ?? ""),
    );
    const evidence = classifyEvidence(types);

    if (evidence.excluded) {
      continue;
    }

    const journalBlock = pickTag(block, "Journal");
    const journal =
      xmlText(pickTag(journalBlock, "Title")) ||
      xmlText(pickTag(journalBlock, "ISOAbbreviation"));

    studies.push({
      pmid,
      title: clip(title, 220),
      journal: clip(journal, 80),
      year: yearOf(block),
      type: evidence.label,
      rank: evidence.rank,
      authors: clip(authorsOf(block), 80),
      doi: doiOf(block),
      abstract: abstractOf(block),
    });
  }

  return studies;
}

// Strongest evidence first; inside one kind, PubMed's own relevance order.
export function rankStudies(
  studies: readonly Study[],
  relevanceOrder: readonly string[],
): Study[] {
  const position = (pmid: string): number => {
    const index = relevanceOrder.indexOf(pmid);

    return index < 0 ? relevanceOrder.length : index;
  };

  return [...studies].sort(
    (a, b) => a.rank - b.rank || position(a.pmid) - position(b.pmid),
  );
}

export function parseEsearchIds(text: string): string[] | null {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const result =
    isRecord(json) && isRecord(json.esearchresult) ? json.esearchresult : null;

  if (!result || !Array.isArray(result.idlist)) {
    return null;
  }

  return result.idlist.filter(
    (id): id is string => typeof id === "string" && /^\d{1,9}$/.test(id),
  );
}

// ---------------------------------------------------------------------------
// Rate limit, cache, configuration
// ---------------------------------------------------------------------------

export type SlotState = { next: number };

// Spaces NCBI requests. Returns how long to wait, or null when the queue is
// already too long (the caller then reports the source as unavailable instead
// of making the user wait). The state is per function instance.
export function reserveSlot(
  state: SlotState,
  now: number,
  gapMs: number,
  maxWaitMs: number,
): number | null {
  const start = Math.max(now, state.next);
  const wait = start - now;

  if (wait > maxWaitMs) {
    return null;
  }

  state.next = start + gapMs;

  return wait;
}

const ncbiSlots: SlotState = { next: 0 };

const cache = new Map<string, { readonly at: number; readonly value: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);

  if (!entry || Date.now() - entry.at >= CACHE_TTL_MS) {
    return undefined;
  }

  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  cache.set(key, { at: Date.now(), value });
}

export function clearMedicalCache(): void {
  cache.clear();
  ncbiSlots.next = 0;
}

function readEnv(name: string): string | undefined {
  try {
    const host = globalThis as {
      Deno?: { env?: { get?: (key: string) => string | undefined } };
    };
    const value = host.Deno?.env?.get?.(name)?.trim();

    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

export type NcbiConfig = {
  readonly apiKey?: string;
  readonly email?: string;
};

function ncbiConfig(): NcbiConfig {
  const apiKey = readEnv("NCBI_API_KEY");
  const email = readEnv("NCBI_EMAIL");

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(email ? { email } : {}),
  };
}

export function buildNcbiUrl(
  path: string,
  params: Readonly<Record<string, string>>,
  config: NcbiConfig,
): string {
  const search = new URLSearchParams(params);

  search.set("tool", NCBI_TOOL);

  if (config.email) {
    search.set("email", config.email);
  }

  if (config.apiKey) {
    search.set("api_key", config.apiKey);
  }

  return `${NCBI_BASE}/${path}?${search.toString()}`;
}

export function buildMedlineUrl(query: string, email: string | undefined): string {
  const search = new URLSearchParams({
    db: "healthTopics",
    term: query,
    retmax: String(MEDLINE_TOPICS_FETCHED),
    rettype: "all",
    tool: NCBI_TOOL,
  });

  if (email) {
    search.set("email", email);
  }

  return `${MEDLINE_ENDPOINT}?${search.toString()}`;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

type TextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly status: number };

async function fetchText(
  url: string,
  accept: string,
  master: AbortSignal,
): Promise<TextResult> {
  const timed = createAttempt(master, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": NOMINATIM_USER_AGENT },
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`medical fetch failed with status ${response.status}.`);

      return { ok: false, status: response.status };
    }

    const declared = Number(response.headers.get("content-length") ?? "0");

    if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) {
      await response.body?.cancel().catch(() => undefined);

      return { ok: false, status: 413 };
    }

    const text = await response.text();

    if (text.length > MAX_RESPONSE_CHARS) {
      return { ok: false, status: 413 };
    }

    return { ok: true, text };
  } catch (error) {
    console.error(`medical fetch threw: ${safeError(error)}`);

    return { ok: false, status: 0 };
  } finally {
    timed.clearConnectTimer();
  }
}

export type SourceStatus = "ok" | "empty" | "unavailable" | "skipped";

type Lookup<T> = { readonly status: SourceStatus; readonly items: readonly T[] };

function cacheKey(prefix: string, query: string): string {
  return `${prefix}:${flat(query).toLowerCase()}`;
}

async function searchMedlinePlus(
  query: string,
  master: AbortSignal,
): Promise<Lookup<MedlineTopic>> {
  const key = cacheKey("medline", query);
  const cached = cacheGet<MedlineTopic[]>(key);

  if (cached) {
    return { status: "ok", items: cached };
  }

  const result = await fetchText(
    buildMedlineUrl(query, ncbiConfig().email),
    "application/xml",
    master,
  );

  if (!result.ok) {
    return { status: "unavailable", items: [] };
  }

  const topics = parseMedlinePlus(result.text, MEDLINE_TOPICS_FETCHED);

  if (topics.length === 0) {
    return { status: "empty", items: [] };
  }

  cacheSet(key, topics);

  return { status: "ok", items: topics };
}

async function waitForNcbi(
  config: NcbiConfig,
  master: AbortSignal,
): Promise<boolean> {
  const wait = reserveSlot(
    ncbiSlots,
    Date.now(),
    config.apiKey ? NCBI_GAP_WITH_KEY_MS : NCBI_GAP_MS,
    NCBI_MAX_QUEUE_WAIT_MS,
  );

  if (wait === null) {
    console.error("medical: the NCBI queue is full; PubMed is skipped.");

    return false;
  }

  if (wait > 0) {
    await sleep(wait);
  }

  return !master.aborted;
}

async function searchPubMed(
  query: string,
  master: AbortSignal,
): Promise<Lookup<Study>> {
  const key = cacheKey("pubmed", query);
  const cached = cacheGet<Study[]>(key);

  if (cached) {
    return { status: "ok", items: cached };
  }

  const config = ncbiConfig();

  if (!(await waitForNcbi(config, master))) {
    return { status: "unavailable", items: [] };
  }

  const search = await fetchText(
    buildNcbiUrl(
      "esearch.fcgi",
      {
        db: "pubmed",
        retmode: "json",
        retmax: String(PUBMED_CANDIDATES),
        sort: "relevance",
        term: query,
      },
      config,
    ),
    "application/json",
    master,
  );

  if (!search.ok) {
    return { status: "unavailable", items: [] };
  }

  const ids = parseEsearchIds(search.text);

  if (ids === null) {
    return { status: "unavailable", items: [] };
  }

  if (ids.length === 0) {
    return { status: "empty", items: [] };
  }

  if (!(await waitForNcbi(config, master))) {
    return { status: "unavailable", items: [] };
  }

  const records = await fetchText(
    buildNcbiUrl(
      "efetch.fcgi",
      { db: "pubmed", retmode: "xml", rettype: "abstract", id: ids.join(",") },
      config,
    ),
    "application/xml",
    master,
  );

  if (!records.ok) {
    return { status: "unavailable", items: [] };
  }

  const ranked = rankStudies(parsePubMedXml(records.text), ids).slice(
    0,
    PUBMED_KEPT,
  );

  if (ranked.length === 0) {
    return { status: "empty", items: [] };
  }

  cacheSet(key, ranked);

  return { status: "ok", items: ranked };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? flat(value).slice(0, max) : "";
}

// A MedlinePlus page is a few sections, each under a question heading
// ("What are the symptoms?"). The sections that match the user's question best
// are returned, plus the opening one, inside a character budget and in page
// order. Short lists stay whole because a section is the unit, not a paragraph.
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "what", "are", "how", "does", "can", "you",
  "your", "from", "that", "this", "about", "when", "should", "have", "has",
  "not", "any", "all", "was", "were", "who", "why", "which", "into", "than",
]);

const INTRO_CHARS = 450;
const SECTION_MAX_CHARS = 700;
const SECTION_MIN_ROOM = 200;
const HEADING_PATTERN = /^\s*={2,}\s*(.+?)\s*={2,}\s*$/;

export type Section = { readonly heading: string; readonly text: string };

export function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let heading = "";
  let lines: string[] = [];

  const flush = (): void => {
    const body = flat(lines.join(" "));

    lines = [];

    if (body) {
      sections.push({ heading, text: body });
    }
  };

  for (const line of text.split("\n")) {
    const match = HEADING_PATTERN.exec(line);

    if (match) {
      flush();
      heading = (match[1] ?? "").trim();
    } else if (line.trim()) {
      lines.push(line.trim());
    }
  }

  flush();

  return sections;
}

function questionTokens(question: string): string[] {
  return [
    ...new Set(
      tokenize(question).filter(
        (token) => token.length >= 3 && !STOP_WORDS.has(token),
      ),
    ),
  ];
}

function renderSection(section: Section, max: number): string {
  const text = clip(section.text, max);

  if (!section.heading) {
    return text;
  }

  return /[?:.!؟]$/.test(section.heading)
    ? `${section.heading} ${text}`
    : `${section.heading}: ${text}`;
}

export function selectSections(
  text: string,
  question: string,
  budget: number,
): string[] {
  const sections = splitSections(text);
  const first = sections[0];

  if (!first) {
    return [];
  }

  const tokens = questionTokens(question);
  const headings = sections.map((section) => new Set(tokenize(section.heading)));
  const bodies = sections.map((section) => new Set(tokenize(section.text)));
  const weights = new Map<string, number>();

  for (const token of tokens) {
    let count = 0;

    for (let index = 0; index < sections.length; index += 1) {
      if (headings[index]?.has(token) || bodies[index]?.has(token)) {
        count += 1;
      }
    }

    // A word found in every section says nothing about which one to pick.
    weights.set(token, Math.log(1 + sections.length / (count + 0.5)));
  }

  const scores = sections.map((_section, index) =>
    tokens.reduce((sum, token) => {
      const hit = headings[index]?.has(token)
        ? 2
        : bodies[index]?.has(token)
          ? 1
          : 0;

      return sum + hit * (weights.get(token) ?? 0);
    }, 0),
  );

  const picked = new Map<number, string>();
  const opening = renderSection(first, INTRO_CHARS);

  picked.set(0, opening);

  let used = opening.length;

  const others = sections
    .map((_section, index) => index)
    .filter((index) => index !== 0);

  const anyMatch = others.some((index) => (scores[index] ?? 0) > 0);
  const order = anyMatch
    ? others
        .filter((index) => (scores[index] ?? 0) > 0)
        .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b)
    : others;

  for (const index of order) {
    const section = sections[index];
    const room = budget - used;

    if (!section || room < SECTION_MIN_ROOM) {
      break;
    }

    const piece = renderSection(
      section,
      Math.min(SECTION_MAX_CHARS, room - section.heading.length - 2),
    );

    picked.set(index, piece);
    used += piece.length;
  }

  return [...picked.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
}

function passagesFor(
  summary: string,
  question: string,
  budget: number,
): string[] {
  if (!summary) {
    return [];
  }

  const passages = selectSections(summary, question, budget);

  return passages.length > 0 ? passages : [clip(flat(summary), budget)];
}

function buildNote(
  medline: SourceStatus,
  pubmed: SourceStatus,
  withStudies: boolean,
): string {
  const parts: string[] = [
    "topics are general patient information from MedlinePlus (US National Library of Medicine); studies are from PubMed and type is the kind of evidence.",
    "Use only this for medical claims, in your own words. Name MedlinePlus (and PubMed when you use studies) once at the end. One study is not proof: keep its type and year when you mention it. Advice may differ between countries. Never turn this into a diagnosis, a dose or a treatment decision for the user.",
  ];

  if (medline === "unavailable") {
    parts.push("MedlinePlus could not be reached; claim nothing from it.");
  }

  if (pubmed === "unavailable") {
    parts.push("PubMed could not be reached; do not cite any study.");
  }

  if (pubmed === "empty" && !withStudies) {
    parts.push("No suitable studies were found.");
  }

  return parts.join(" ");
}

function buildData(
  medline: Lookup<MedlineTopic>,
  pubmed: Lookup<Study>,
  question: string,
  level: Level,
): Record<string, unknown> {
  const hasStudies = pubmed.items.length > 0;
  const budget = hasStudies ? level.medlineChars : MEDLINE_ONLY_CHARS;

  const topics = medline.items.slice(0, MEDLINE_TOPICS_SHOWN).map((topic, index) => ({
    title: topic.title,
    ...(topic.alsoCalled.length > 0
      ? { also_called: topic.alsoCalled.slice(0, 4) }
      : {}),
    ...(index === 0
      ? { passages: passagesFor(topic.summary, question, budget) }
      : { summary: clip(flat(topic.summary), 300) }),
  }));

  const studies = pubmed.items.slice(0, level.studies).map((study) => ({
    pmid: study.pmid,
    title: study.title,
    journal: study.journal,
    year: study.year,
    type: study.type,
    ...(study.authors ? { authors: study.authors } : {}),
    ...(study.doi ? { doi: study.doi } : {}),
    ...(study.abstract && level.abstractChars > 0
      ? { abstract: clip(study.abstract, level.abstractChars) }
      : {}),
  }));

  return {
    ...(topics.length > 0 ? { topics } : {}),
    ...(studies.length > 0 ? { studies } : {}),
    status: { medlineplus: medline.status, pubmed: pubmed.status },
    note: buildNote(medline.status, pubmed.status, hasStudies),
  };
}

export async function runMedicalLookup(
  args: Record<string, unknown>,
  _ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query = cleanText(args.query, QUERY_MAX_CHARS);

  if (!query) {
    return { data: { error: "query is required." } };
  }

  const focus = cleanText(args.focus, FOCUS_MAX_CHARS);
  const research = args.research === true;
  const skipped: Lookup<Study> = { status: "skipped", items: [] };

  const [medline, firstPubmed] = await Promise.all([
    searchMedlinePlus(query, signal),
    research ? searchPubMed(query, signal) : Promise.resolve(skipped),
  ]);

  // Nothing in MedlinePlus: the literature is the only source left.
  const pubmed =
    !research && medline.items.length === 0
      ? await searchPubMed(query, signal)
      : firstPubmed;

  console.log(
    JSON.stringify({
      event: "medical",
      medline: medline.status,
      pubmed: pubmed.status,
    }),
  );

  if (medline.items.length === 0 && pubmed.items.length === 0) {
    if (medline.status === "unavailable" || pubmed.status === "unavailable") {
      return { data: { error: "Medical sources could not be reached right now." } };
    }

    return {
      data: {
        results: [],
        note: "Nothing was found for this query. Say you could not verify it and give only general, safe information; never invent details.",
      },
    };
  }

  const question = `${focus} ${query}`;

  for (const level of LEVELS) {
    const data = buildData(medline, pubmed, question, level);

    if (JSON.stringify(data).length <= RESULT_LIMIT_CHARS) {
      return { data };
    }
  }

  const last = LEVELS[LEVELS.length - 1] as Level;

  return { data: buildData(medline, pubmed, question, last) };
}
