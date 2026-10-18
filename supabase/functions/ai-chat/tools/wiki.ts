// supabase/functions/ai-chat/tools/wiki.ts
// Wikipedia summary, photo and place lookups used by the place tool.

import { NOMINATIM_USER_AGENT, WIKI_TIMEOUT_MS } from "../config.ts";
import type { PhotoItem } from "../types.ts";
import {
  describeError,
  isRecord,
  isValidGeo,
  pickString,
} from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import { fetchLicensedPhotos } from "../images/photos.ts";

const WIKI_PLACE_MAX_RESULTS = 3;
const WIKI_SEARCH_MAX_CHARS = 200;
const WIKI_LANG_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,8})?$/;

export type WikiPlaceHit = {
  readonly title: string;
  readonly lat: number;
  readonly lon: number;
  readonly tag: string;
};

export type LocalizedArticle = {
  readonly tag: string;
  readonly title: string;
};

function parseWikiTag(
  tag: string,
): { readonly lang: string; readonly title: string } | null {
  const match = /^([a-z]{2,3}(?:-[a-z]{2,8})?):(.+)$/i.exec(tag.trim());

  if (!match) {
    return null;
  }

  const lang = (match[1] ?? "").toLowerCase();
  const title = (match[2] ?? "").trim().replace(/ /g, "_");

  return lang && title ? { lang, title } : null;
}

export async function fetchWikipediaSummary(
  tag: string,
  master: AbortSignal,
): Promise<string> {
  const parsed = parseWikiTag(tag);

  if (!parsed) {
    return "";
  }

  const timed = createAttempt(master, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(parsed.title)}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      return "";
    }

    const json: unknown = await response.json();

    return isRecord(json) && typeof json.extract === "string"
      ? json.extract.slice(0, 450)
      : "";
  } catch (error) {
    console.error(`wikipedia summary failed: ${describeError(error)}`);

    return "";
  } finally {
    timed.clearConnectTimer();
  }
}

// Pictures of a Wikipedia article, each with its author and free license from
// Wikimedia Commons. A picture whose license cannot be read is left out.
export async function fetchWikipediaPhotos(
  tag: string,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  const parsed = parseWikiTag(tag);

  if (!parsed) {
    return [];
  }

  return await fetchLicensedPhotos(parsed.lang, parsed.title, master, {
    max: 5,
  });
}

// Searches Wikipedia (in the given language) and returns only pages that have
// geographic coordinates, i.e. real places, in the order Wikipedia ranks them.
// Works for any name in any country; nothing here is specific to one place.
export async function searchWikipediaPlaces(
  searchText: string,
  lang: string,
  master: AbortSignal,
): Promise<WikiPlaceHit[]> {
  const text = searchText.trim().slice(0, WIKI_SEARCH_MAX_CHARS);

  if (!text || !WIKI_LANG_PATTERN.test(lang)) {
    return [];
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: text,
    gsrlimit: "6",
    prop: "coordinates",
    coprimary: "primary",
    colimit: "6",
  });

  const timed = createAttempt(master, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${lang.toLowerCase()}.wikipedia.org/w/api.php?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      return [];
    }

    const json: unknown = await response.json();
    const queryBlock =
      isRecord(json) && isRecord(json.query) ? json.query : null;
    const pages =
      queryBlock && Array.isArray(queryBlock.pages) ? queryBlock.pages : [];

    const found: Array<WikiPlaceHit & { readonly index: number }> = [];

    for (const raw of pages) {
      if (!isRecord(raw)) {
        continue;
      }

      const title = pickString(raw, "title");
      const coordinates = Array.isArray(raw.coordinates) ? raw.coordinates : [];
      const first: unknown = coordinates[0];

      if (!title || !isRecord(first)) {
        continue;
      }

      const lat = Number(first.lat);
      const lon = Number(first.lon);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const index = Number(raw.index);

      found.push({
        title,
        lat,
        lon,
        tag: `${lang.toLowerCase()}:${title}`,
        index: Number.isFinite(index) ? index : 1e9,
      });
    }

    found.sort((a, b) => a.index - b.index);

    return found
      .slice(0, WIKI_PLACE_MAX_RESULTS)
      .map(({ title, lat, lon, tag }) => ({ title, lat, lon, tag }));
  } catch (error) {
    console.error(`wikipedia place search failed: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}

// Finds the same Wikipedia article in the given language, for example the
// Persian article of a place whose map tag points to the English one. Returns
// null when no article exists in that language.
export async function findLocalizedArticle(
  tag: string,
  lang: string,
  master: AbortSignal,
): Promise<LocalizedArticle | null> {
  const parsed = parseWikiTag(tag);
  const target = lang.toLowerCase();

  if (!parsed || !WIKI_LANG_PATTERN.test(target)) {
    return null;
  }

  const sourceTitle = parsed.title.replace(/_/g, " ");

  if (parsed.lang === target) {
    return { tag: `${target}:${sourceTitle}`, title: sourceTitle };
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "langlinks",
    titles: sourceTitle,
    lllang: target,
    lllimit: "1",
    redirects: "1",
  });

  const timed = createAttempt(master, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${parsed.lang}.wikipedia.org/w/api.php?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    const json: unknown = await response.json();
    const queryBlock =
      isRecord(json) && isRecord(json.query) ? json.query : null;
    const pages =
      queryBlock && Array.isArray(queryBlock.pages) ? queryBlock.pages : [];
    const page: unknown = pages[0];

    if (!isRecord(page)) {
      return null;
    }

    const links = Array.isArray(page.langlinks) ? page.langlinks : [];
    const link: unknown = links[0];

    if (!isRecord(link)) {
      return null;
    }

    const title = pickString(link, "title");

    return title ? { tag: `${target}:${title}`, title } : null;
  } catch (error) {
    console.error(`wikipedia language link failed: ${describeError(error)}`);

    return null;
  } finally {
    timed.clearConnectTimer();
  }
}
