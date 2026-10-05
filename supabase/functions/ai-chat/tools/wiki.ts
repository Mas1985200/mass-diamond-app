// supabase/functions/ai-chat/tools/wiki.ts
// Wikipedia summary and photo lookups used by the place tool.

import { NOMINATIM_USER_AGENT, WIKI_TIMEOUT_MS } from "../config.ts";
import type { PhotoItem } from "../types.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";

const PHOTO_SKIP_PATTERN =
  /(flag|logo|icon|locator|map|coat[_ ]of[_ ]arms|symbol|seal|emblem|edit-clear|question[_ ]book|wiktionary|disambig)/i;

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

export async function fetchWikipediaPhotos(
  tag: string,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  const parsed = parseWikiTag(tag);

  if (!parsed) {
    return [];
  }

  const timed = createAttempt(master, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(parsed.title)}`,
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
    const items = isRecord(json) && Array.isArray(json.items) ? json.items : [];
    const photos: PhotoItem[] = [];

    for (const raw of items) {
      if (!isRecord(raw) || raw.type !== "image") {
        continue;
      }

      const title = pickString(raw, "title");

      if (!title || /\.svg$/i.test(title) || PHOTO_SKIP_PATTERN.test(title)) {
        continue;
      }

      const srcset = Array.isArray(raw.srcset) ? raw.srcset : [];
      const last: unknown = srcset[srcset.length - 1];

      if (!isRecord(last)) {
        continue;
      }

      let src = pickString(last, "src");

      if (src.startsWith("//")) {
        src = `https:${src}`;
      }

      if (!src.startsWith("https://upload.wikimedia.org/")) {
        continue;
      }

      if (photos.some((photo) => photo.src === src)) {
        continue;
      }

      photos.push({
        src,
        title: title.replace(/^[^:]+:/, "").replace(/_/g, " ").slice(0, 100),
      });

      if (photos.length >= 5) {
        break;
      }
    }

    return photos;
  } catch (error) {
    console.error(`wikipedia photos failed: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}
