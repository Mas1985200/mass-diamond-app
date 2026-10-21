// supabase/functions/ai-chat/images/openverse.ts
// Openverse (openverse.org): a free search over openly licensed pictures from
// many sources. No key is needed. It fills in where Wikimedia Commons has too
// few usable pictures of a topic. Only licenses that allow showing the picture
// in any app are kept (CC0, public domain, CC BY, CC BY-SA), and every picture
// keeps its author and license.

import { NOMINATIM_USER_AGENT } from "../config.ts";
import { createAttempt } from "../lib/http.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import type { PhotoItem } from "../types.ts";

export const OPENVERSE_API = "https://api.openverse.org/v1/images/";
export const OPENVERSE_THUMB_HOST = "https://api.openverse.org/";
export const OPENVERSE_PAGE_PREFIX = "https://openverse.org/image/";
const REQUEST_TIMEOUT_MS = 5_000;
const PAGE_SIZE = 12;
const TITLE_MAX_CHARS = 100;
const AUTHOR_MAX_CHARS = 90;
const ID_PATTERN = /^[0-9a-f-]{8,64}$/i;

type LicenseInfo = { readonly label: string; readonly url: string };

// slug -> how it is shown and where its text is. Everything else (non-commercial,
// no-derivatives, unknown) is dropped.
function licenseOf(slug: string, version: string): LicenseInfo | null {
  const clean = slug.trim().toLowerCase();
  const number = /^\d+(?:\.\d+)?$/.test(version.trim()) ? version.trim() : "";

  if (clean === "cc0") {
    return {
      label: "CC0 1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    };
  }

  if (clean === "pdm") {
    return {
      label: "Public Domain",
      url: "https://creativecommons.org/publicdomain/mark/1.0/",
    };
  }

  if ((clean === "by" || clean === "by-sa") && number) {
    return {
      label: `CC ${clean.toUpperCase()} ${number}`,
      url: `https://creativecommons.org/licenses/${clean}/${number}/`,
    };
  }

  return null;
}

export function buildOpenverseUrl(query: string): string {
  const params = new URLSearchParams({
    q: query.replace(/\s+/g, " ").trim().slice(0, 100),
    page_size: String(PAGE_SIZE),
    license_type: "commercial,modification",
    category: "photograph",
    mature: "false",
  });

  return `${OPENVERSE_API}?${params.toString()}`;
}

// A picture is kept only when its title or tags name every word of the topic
// ("brown bear" needs both words), so a teddy bear or a bear-shaped sign does
// not pass for the animal. Plurals match ("bears" holds "bear").
export function mentionsTopic(raw: Record<string, unknown>, topic: string): boolean {
  const wanted = topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);

  if (wanted.length === 0) {
    return true;
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag) => (isRecord(tag) ? pickString(tag, "name") : "")).join(" ")
    : "";
  const text = `${pickString(raw, "title")} ${tags}`.toLowerCase();

  return wanted.every((word) => text.includes(word));
}

export function parseOpenverse(json: unknown, topic = ""): PhotoItem[] {
  const results =
    isRecord(json) && Array.isArray(json.results) ? json.results : [];
  const items: PhotoItem[] = [];
  const seen = new Set<string>();

  for (const raw of results) {
    if (!isRecord(raw) || raw.mature === true || !mentionsTopic(raw, topic)) {
      continue;
    }

    const id = pickString(raw, "id");
    const src = pickString(raw, "thumbnail");
    const license = licenseOf(
      pickString(raw, "license"),
      pickString(raw, "license_version"),
    );

    if (
      !ID_PATTERN.test(id) ||
      !src.startsWith(OPENVERSE_THUMB_HOST) ||
      !license ||
      seen.has(id)
    ) {
      continue;
    }

    seen.add(id);

    const author = pickString(raw, "creator").trim().slice(0, AUTHOR_MAX_CHARS);

    items.push({
      src,
      title: pickString(raw, "title").trim().slice(0, TITLE_MAX_CHARS),
      ...(author ? { author } : {}),
      license: license.label,
      licenseUrl: license.url,
      page: `${OPENVERSE_PAGE_PREFIX}${id}`,
    });
  }

  return items;
}

export async function searchOpenverse(
  query: string,
  max: number,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  if (!query.trim() || max <= 0) {
    return [];
  }

  const timed = createAttempt(master, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildOpenverseUrl(query), {
      headers: { "User-Agent": NOMINATIM_USER_AGENT, Accept: "application/json" },
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`openverse search failed with status ${response.status}.`);

      return [];
    }

    return parseOpenverse(await response.json(), query).slice(0, max);
  } catch (error) {
    console.error(`openverse search threw: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}
