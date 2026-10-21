// supabase/functions/ai-chat/images/webimages.ts
// Pictures found on the open web (through the Tavily search the app already
// uses). Their rights stay with the sites they come from, so every picture is
// marked "Web" and links to the page it was found on. They are only a last
// source: used when the free libraries gave too few pictures. A picture counts
// only when its description names the topic, so the ranking of a web search
// can never put an unrelated picture under an answer.

import { createAttempt } from "../lib/http.ts";
import {
  describeError,
  getTavilyKey,
  isRecord,
  pickString,
} from "../lib/util.ts";
import type { PhotoItem } from "../types.ts";
import { describesTopic } from "./topic-match.ts";

export const WEB_LICENSE = "Web";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 6_000;
const RESULTS = 6;
const URL_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 100;

// Stock sites put a watermark on their previews; logos and icons say nothing.
const SKIP_HOST =
  /(shutterstock|gettyimages|alamy|istockphoto|depositphotos|dreamstime|123rf|adobestock|pinterest|facebook|fbcdn|instagram|tiktok|gstatic|ytimg)/i;
const SKIP_FILE = /(\.svg|\.gif|\.ico)(?:$|\?)|logo|icon|sprite|avatar|banner/i;

export function tavilyImageKey(): string | undefined {
  try {
    return getTavilyKey();
  } catch {
    return undefined;
  }
}

function httpsUrl(value: string): URL | null {
  if (!value || value.length > URL_MAX_CHARS || /[\s"'<>]/.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hostName(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

export function parseWebImages(json: unknown, topic: string): PhotoItem[] {
  if (!isRecord(json)) {
    return [];
  }

  // Each image is paired with the page of the result it came from, so a
  // picture always links back to where it was found.
  const candidates: { image: unknown; page: string }[] = [];
  const results = Array.isArray(json.results) ? json.results : [];

  for (const result of results) {
    if (!isRecord(result) || !Array.isArray(result.images)) {
      continue;
    }

    for (const image of result.images) {
      candidates.push({ image, page: pickString(result, "url") });
    }
  }

  for (const image of Array.isArray(json.images) ? json.images : []) {
    candidates.push({ image, page: "" });
  }

  const items: PhotoItem[] = [];
  const seen = new Set<string>();

  for (const { image, page } of candidates) {
    if (!isRecord(image)) {
      continue;
    }

    const src = httpsUrl(pickString(image, "url"));
    const description = pickString(image, "description");

    if (
      !src ||
      SKIP_HOST.test(src.hostname) ||
      SKIP_FILE.test(src.pathname) ||
      seen.has(src.href) ||
      !description.trim() ||
      !describesTopic(description, topic, true)
    ) {
      continue;
    }

    seen.add(src.href);

    const source = httpsUrl(page) ?? null;

    items.push({
      src: src.href,
      title: description.trim().slice(0, TITLE_MAX_CHARS),
      author: hostName(source ?? src),
      license: WEB_LICENSE,
      ...(source ? { page: source.href } : {}),
    });
  }

  return items;
}

export async function searchWebImages(
  query: string,
  max: number,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  const key = tavilyImageKey();

  if (!key || !query.trim() || max <= 0) {
    return [];
  }

  const timed = createAttempt(master, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: query.replace(/\s+/g, " ").trim().slice(0, 100),
        max_results: RESULTS,
        search_depth: "basic",
        include_answer: false,
        include_images: true,
        include_image_descriptions: true,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`web images failed with status ${response.status}.`);

      return [];
    }

    return parseWebImages(await response.json(), query).slice(0, max);
  } catch (error) {
    console.error(`web images threw: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}
