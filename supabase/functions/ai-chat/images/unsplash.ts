// supabase/functions/ai-chat/images/unsplash.ts
// Unsplash (unsplash.com): a large free library of good photographs, searched
// by relevance. It needs a free access key (secret UNSPLASH_ACCESS_KEY);
// without the key this source is simply skipped. Every picture keeps its
// photographer and the Unsplash license and links back to its Unsplash page,
// as the Unsplash guidelines require.

import { NOMINATIM_USER_AGENT } from "../config.ts";
import { createAttempt } from "../lib/http.ts";
import { describeError, getOptionalEnv, isRecord, pickString } from "../lib/util.ts";
import type { PhotoItem } from "../types.ts";
import { describesTopic } from "./topic-match.ts";

export const UNSPLASH_API = "https://api.unsplash.com/search/photos";
export const UNSPLASH_LICENSE = "Unsplash License";
export const UNSPLASH_LICENSE_URL = "https://unsplash.com/license";
const UNSPLASH_IMAGE_HOST = "https://images.unsplash.com/";
const UNSPLASH_PAGE_PREFIX = "https://unsplash.com/photos/";
const REFERRAL = "utm_source=mass_diamond&utm_medium=referral";
const REQUEST_TIMEOUT_MS = 5_000;
const PAGE_SIZE = 15;
const TITLE_MAX_CHARS = 100;
const AUTHOR_MAX_CHARS = 90;

// Never throws: no key (or no environment) simply means "this source is off".
export function unsplashKey(): string | undefined {
  try {
    return getOptionalEnv("UNSPLASH_ACCESS_KEY");
  } catch {
    return undefined;
  }
}

export function buildUnsplashUrl(query: string): string {
  const params = new URLSearchParams({
    query: query.replace(/\s+/g, " ").trim().slice(0, 100),
    per_page: String(PAGE_SIZE),
    orientation: "landscape",
    content_filter: "high",
  });

  return `${UNSPLASH_API}?${params.toString()}`;
}

export function parseUnsplash(json: unknown, topic = ""): PhotoItem[] {
  const results = isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const items: PhotoItem[] = [];
  const seen = new Set<string>();

  for (const raw of results) {
    if (!isRecord(raw) || !isRecord(raw.urls)) {
      continue;
    }

    const src = pickString(raw.urls, "small") || pickString(raw.urls, "regular");
    const page = isRecord(raw.links) ? pickString(raw.links, "html") : "";
    const description =
      pickString(raw, "alt_description") || pickString(raw, "description");

    if (
      !src.startsWith(UNSPLASH_IMAGE_HOST) ||
      !page.startsWith(UNSPLASH_PAGE_PREFIX) ||
      seen.has(src) ||
      !describesTopic(description, topic, false)
    ) {
      continue;
    }

    seen.add(src);

    const name = isRecord(raw.user) ? pickString(raw.user, "name").trim() : "";
    const author = name.slice(0, AUTHOR_MAX_CHARS);

    items.push({
      src,
      title: description.trim().slice(0, TITLE_MAX_CHARS),
      ...(author ? { author } : {}),
      license: UNSPLASH_LICENSE,
      licenseUrl: UNSPLASH_LICENSE_URL,
      page: `${page.split("?")[0]}?${REFERRAL}`.slice(0, 300),
    });
  }

  return items;
}

export async function searchUnsplash(
  query: string,
  max: number,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  const key = unsplashKey();

  if (!key || !query.trim() || max <= 0) {
    return [];
  }

  const timed = createAttempt(master, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUnsplashUrl(query), {
      headers: {
        Authorization: `Client-ID ${key}`,
        "Accept-Version": "v1",
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`unsplash search failed with status ${response.status}.`);

      return [];
    }

    return parseUnsplash(await response.json(), query).slice(0, max);
  } catch (error) {
    console.error(`unsplash search threw: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}
