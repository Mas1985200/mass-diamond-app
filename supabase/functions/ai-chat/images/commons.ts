// supabase/functions/ai-chat/images/commons.ts
// Wikimedia Commons: picture address, author and license of named files.
// No key is needed. Only files whose license can be read and is free are kept.

import { NOMINATIM_USER_AGENT } from "../config.ts";
import type { PhotoItem } from "../types.ts";
import { describeError, isRecord, pickString } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import { readCredit } from "./license.ts";

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
// A standard Wikimedia thumbnail width (500): other widths are made on demand,
// arrive slowly or not at all, and left empty boxes in the picture strip.
export const THUMB_WIDTH = 500;
const REQUEST_TIMEOUT_MS = 4_000;
const TITLE_MAX_CHARS = 100;

const IMAGE_MIME = /^image\/(?:jpeg|png|webp|svg\+xml)$/i;
// A picture filed under a disease, a patient or a clinical finding is a medical
// photograph. Those are never shown outside diagram mode, whatever the topic
// or the tool that asked (the file's own Commons categories decide).
const MEDICAL_CATEGORY =
  /(disease|disorder|syndrome|patient|clinical|medical condition|pathology|symptom|lesion|injur|wound|cancer|tumou?r|carcinoma|infection|dermatolog|surg(?:ery|ical)|deformit|abnormalit|rash|histolog|radiograph|x-ray)/i;

const FILE_PAGE_PREFIX = "https://commons.wikimedia.org/wiki/";
const IMAGE_HOST = "https://upload.wikimedia.org/";

export async function getJson(
  url: string,
  master: AbortSignal,
  label: string,
): Promise<unknown> {
  const timed = createAttempt(master, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT, Accept: "application/json" },
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`${label} failed with status ${response.status}.`);

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`${label} threw: ${describeError(error)}`);

    return null;
  } finally {
    timed.clearConnectTimer();
  }
}

// "File:Foo_bar.jpg" and "File:Foo bar.jpg" are the same file.
export function normalizeFileTitle(title: string): string {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function buildCommonsUrl(fileTitles: readonly string[]): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "imageinfo|categories",
    clshow: "!hidden",
    cllimit: "max",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Restrictions|NonFree",
    titles: fileTitles.map(normalizeFileTitle).join("|"),
  });

  return `${COMMONS_API}?${params.toString()}`;
}

function readableTitle(fileTitle: string): string {
  return normalizeFileTitle(fileTitle)
    .replace(/^[^:]+:/, "")
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .trim()
    .slice(0, TITLE_MAX_CHARS);
}

function isMedicalPhoto(page: Record<string, unknown>): boolean {
  const categories = Array.isArray(page.categories) ? page.categories : [];

  return categories.some(
    (category) => isRecord(category) && MEDICAL_CATEGORY.test(pickString(category, "title")),
  );
}

export type ParseOptions = {
  // Diagram mode keeps files that are filed under medical categories.
  readonly allowMedical?: boolean;
};

export function parseCommonsImages(
  json: unknown,
  requested: readonly string[],
  options: ParseOptions = {},
): PhotoItem[] {
  const pages =
    isRecord(json) && isRecord(json.query) && Array.isArray(json.query.pages)
      ? json.query.pages
      : [];
  const order = requested.map((title) => normalizeFileTitle(title));
  const found: { readonly position: number; readonly item: PhotoItem }[] = [];

  for (const page of pages) {
    if (!isRecord(page) || page.missing === true) {
      continue;
    }

    const fileTitle = normalizeFileTitle(pickString(page, "title"));
    const infos = Array.isArray(page.imageinfo) ? page.imageinfo : [];
    const info: unknown = infos[0];

    if (!fileTitle || !isRecord(info)) {
      continue;
    }

    if (!IMAGE_MIME.test(pickString(info, "mime"))) {
      continue;
    }

    if (options.allowMedical !== true && isMedicalPhoto(page)) {
      continue;
    }

    const src = pickString(info, "thumburl") || pickString(info, "url");
    const credit = readCredit(info.extmetadata);

    if (!src.startsWith(IMAGE_HOST) || !credit) {
      continue;
    }

    const descriptionUrl = pickString(info, "descriptionurl");
    const filePage = descriptionUrl.startsWith(FILE_PAGE_PREFIX) ? descriptionUrl : "";
    const index = order.indexOf(fileTitle);
    // Search results carry their own rank in "index".
    const rank = typeof page.index === "number" ? 1_000 + page.index : Number.MAX_SAFE_INTEGER;

    found.push({
      position: index < 0 ? rank : index,
      item: {
        src,
        title: readableTitle(fileTitle),
        ...(credit.author ? { author: credit.author } : {}),
        license: credit.license,
        ...(credit.licenseUrl ? { licenseUrl: credit.licenseUrl } : {}),
        ...(filePage ? { page: filePage.slice(0, 300) } : {}),
      },
    });
  }

  return found.sort((a, b) => a.position - b.position).map((entry) => entry.item);
}

export async function fetchCommonsImages(
  fileTitles: readonly string[],
  master: AbortSignal,
  options: ParseOptions = {},
): Promise<PhotoItem[]> {
  if (fileTitles.length === 0) {
    return [];
  }

  const json = await getJson(buildCommonsUrl(fileTitles), master, "commons imageinfo");

  return parseCommonsImages(json, fileTitles, options);
}

// Last resort for any topic: a direct search over the photos of Commons. The
// topic is searched as an exact phrase, so a word that only appears inside
// another subject ("bear" in "bear market") does not match. A search for
// diagrams is never made: its hits were charts about other subjects.
export function buildCommonsSearchUrl(query: string, diagrams: boolean): string {
  const words = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "15",
    gsrsearch: diagrams ? `"${words}" diagram` : `"${words}" filetype:bitmap`,
    prop: "imageinfo|categories",
    clshow: "!hidden",
    cllimit: "max",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Restrictions|NonFree",
  });

  return `${COMMONS_API}?${params.toString()}`;
}

export async function searchCommonsImages(
  query: string,
  diagrams: boolean,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  if (!query.trim() || diagrams) {
    return [];
  }

  const json = await getJson(
    buildCommonsSearchUrl(query, diagrams),
    master,
    "commons search",
  );

  return parseCommonsImages(json, [], { allowMedical: diagrams });
}
