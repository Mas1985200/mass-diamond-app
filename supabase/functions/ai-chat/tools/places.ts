// supabase/functions/ai-chat/tools/places.ts
// find_place tool: specific places and near-me search.
// For a specific place the server writes the short answer itself from the
// map and Wikipedia data, so the model cannot add invented details.
// The model says which place it means (country, local name, approximate
// coordinates from its own knowledge); the server only verifies it on the map.
// When nothing is found the server writes a fixed "not found" sentence, so the
// model never invents an answer.

import type {
  CardPayload,
  PhotoItem,
  PlaceCandidate,
  PlaceItem,
  ToolContext,
  ToolOutcome,
} from "../types.ts";
import { describeError } from "../lib/util.ts";
import { distanceBetween, normalizePlaceName } from "../lib/geo.ts";
import {
  searchNominatim,
  searchPhoton,
  type NominatimOptions,
} from "./places-search.ts";
import { fetchWikipediaPhotos, fetchWikipediaSummary } from "./wiki.ts";
import { resolveViaWikipedia } from "./places-wiki.ts";
import { tavilySearch } from "./web.ts";

const ABOUT_MAX_CHARS = 400;
const AMBIGUOUS_IMPORTANCE = 0.55;
const MAX_SAME_NAME = 3;
const WIKI_FALLBACK_LANG = "en";

// Hints from the model: results within this distance of its approximate
// coordinates are preferred, but they are never the marker position itself.
const APPROX_RADIUS_KM = 60;
const HINT_MIN_IMPORTANCE = 0.3;
const WIKI_TAG_BONUS = 0.15;
const EARTH_RADIUS_KM = 6371;

type PlaceHints = {
  readonly countryCode?: string;
  readonly localName?: string;
  readonly approx?: { readonly lat: number; readonly lon: number };
};

type Attempt = {
  readonly text: string;
  readonly countryCode?: string;
};

function kmApart(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toCoordinate(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return Number.NaN;
}

function readHints(args: Record<string, unknown>): PlaceHints {
  const code =
    typeof args.country_code === "string"
      ? args.country_code.trim().toLowerCase()
      : "";
  const local =
    typeof args.local_name === "string"
      ? args.local_name.trim().slice(0, 120)
      : "";
  const lat = toCoordinate(args.approx_lat);
  const lon = toCoordinate(args.approx_lon);

  const hasApprox =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0);

  return {
    ...(/^[a-z]{2}$/.test(code) ? { countryCode: code } : {}),
    ...(local ? { localName: local } : {}),
    ...(hasApprox ? { approx: { lat, lon } } : {}),
  };
}

function distinctLocations(list: readonly PlaceCandidate[]): PlaceCandidate[] {
  const distinct: PlaceCandidate[] = [];

  for (const candidate of list) {
    const isNew = distinct.every(
      (existing) => distanceBetween(existing.item, candidate.item) > 2,
    );

    if (isNew) {
      distinct.push(candidate);
    }
  }

  return distinct;
}

type SpecificPick = {
  readonly chosen: PlaceCandidate;
  readonly alternatives: readonly PlaceCandidate[];
  readonly ambiguous: boolean;
};

function pickSpecific(
  top: PlaceCandidate,
  all: readonly PlaceCandidate[],
): SpecificPick {
  const topKey = normalizePlaceName(top.item.name);

  const rivals = distinctLocations(
    all.filter(
      (candidate) =>
        candidate !== top &&
        normalizePlaceName(candidate.item.name) === topKey &&
        distanceBetween(candidate.item, top.item) > 2,
    ),
  ).slice(0, MAX_SAME_NAME - 1);

  return {
    chosen: top,
    alternatives: rivals,
    ambiguous: rivals.length > 0 && top.importance < AMBIGUOUS_IMPORTANCE,
  };
}

function rankScore(candidate: PlaceCandidate): number {
  return candidate.importance + (candidate.wikipedia ? WIKI_TAG_BONUS : 0);
}

// Orders candidates best first. When the model gave approximate coordinates,
// a believable candidate near them goes first; otherwise the overall best.
function chooseCandidates(
  all: readonly PlaceCandidate[],
  hints: PlaceHints,
): PlaceCandidate[] {
  const sorted = all.slice().sort((a, b) => rankScore(b) - rankScore(a));
  const approx = hints.approx;

  if (!approx) {
    return sorted;
  }

  const near = sorted.filter(
    (candidate) =>
      kmApart(
        candidate.item.lat,
        candidate.item.lon,
        approx.lat,
        approx.lon,
      ) <= APPROX_RADIUS_KM,
  );
  const best = near[0];

  if (best && (best.wikipedia || best.importance >= HINT_MIN_IMPORTANCE)) {
    return [...near, ...sorted.filter((candidate) => !near.includes(candidate))];
  }

  return sorted;
}

// A candidate is trusted as the place when it has a Wikipedia tag, is very
// important, or is reasonably important and lies near the model's coordinates.
function isTrusted(candidate: PlaceCandidate, hints: PlaceHints): boolean {
  if (candidate.wikipedia) {
    return true;
  }

  if (candidate.importance >= AMBIGUOUS_IMPORTANCE) {
    return true;
  }

  const approx = hints.approx;

  return (
    approx !== undefined &&
    candidate.importance >= HINT_MIN_IMPORTANCE &&
    kmApart(candidate.item.lat, candidate.item.lon, approx.lat, approx.lon) <=
      APPROX_RADIUS_KM
  );
}

function selectNearby(candidates: readonly PlaceCandidate[]): PlaceItem[] {
  const sorted = candidates
    .slice()
    .sort((a, b) => (a.item.km ?? 1e9) - (b.item.km ?? 1e9));
  const picked: PlaceItem[] = [];

  for (const candidate of sorted) {
    const key = normalizePlaceName(candidate.item.name);
    const duplicate = picked.some(
      (existing) =>
        normalizePlaceName(existing.name) === key &&
        distanceBetween(existing, candidate.item) < 0.2,
    );

    if (!duplicate) {
      picked.push(candidate.item);
    }

    if (picked.length >= 3) {
      break;
    }
  }

  return picked;
}

function nearbyOutcome(
  items: readonly PlaceItem[],
  ctx: ToolContext,
): ToolOutcome {
  return {
    data: {
      results: items.map((item) => ({
        name: item.name,
        address: item.address,
        lat: item.lat,
        lon: item.lon,
        distance_km: item.km,
      })),
    },
    finalText: "",
    cardFirst: true,
    cards: [{ t: "places", lang: ctx.lang, items }],
  };
}

function trimAbout(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();

  if (clean.length <= ABOUT_MAX_CHARS) {
    return clean;
  }

  const cut = clean.slice(0, ABOUT_MAX_CHARS);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("؟ "),
    cut.lastIndexOf("! "),
  );

  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

function formatAddress(ctx: ToolContext, address: string): string {
  return ctx.lang === "fa"
    ? address.replace(/,\s*/g, "، ").trim()
    : address.trim();
}

function formatKm(ctx: ToolContext, km: number): string {
  const locale = ctx.lang === "fa" ? "fa-IR" : "en-US";

  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      km,
    );
  } catch {
    return String(Math.round(km));
  }
}

// Short answer written by the server from map and Wikipedia data only.
function buildPlaceAnswer(
  ctx: ToolContext,
  item: PlaceItem,
  about: string,
): string {
  const isFa = ctx.lang === "fa";
  const address = formatAddress(ctx, item.address);

  const hasAddress =
    address.length > 0 &&
    normalizePlaceName(address) !== normalizePlaceName(item.name);

  const parts: string[] = [];

  if (hasAddress) {
    parts.push(
      isFa
        ? `${item.name} در ${address} قرار دارد.`
        : `${item.name} is in ${address}.`,
    );
  }

  const summary = trimAbout(about);

  if (summary) {
    parts.push(summary);
  }

  if (parts.length === 0) {
    parts.push(item.name);
  }

  return parts.join(" ");
}

// Answer used when several places share the same name. The best-known place
// is always listed first.
function buildAmbiguousAnswer(
  ctx: ToolContext,
  group: readonly PlaceCandidate[],
): string {
  const isFa = ctx.lang === "fa";
  const name = group[0]?.item.name ?? "";

  const entries = group.map((candidate) => {
    const address = formatAddress(ctx, candidate.item.address);
    const km =
      candidate.item.km !== undefined
        ? isFa
          ? ` (${formatKm(ctx, candidate.item.km)} کیلومتر)`
          : ` (${formatKm(ctx, candidate.item.km)} km)`
        : "";

    return `${address || name}${km}`;
  });

  const joined = entries.join(isFa ? "؛ " : "; ");

  if (isFa) {
    return `چند مکان با نام «${name}» پیدا شد: ${joined}. شناخته‌شده‌ترین اول نمایش داده شد.`;
  }

  return `Several places are named "${name}": ${joined}. The best-known is shown first.`;
}

// The part of the query before the first comma is the place name itself; the
// rest is context such as the city or country.
function placeNameOf(query: string): string {
  const first = query.split(/[,،]/)[0]?.trim() ?? "";

  return first || query;
}

function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function wikiTitleOf(tag: string): string {
  const colon = tag.indexOf(":");

  return (colon >= 0 ? tag.slice(colon + 1) : tag).replace(/_/g, " ");
}

// Guards against accepting an unrelated Wikipedia page: more than half of the
// words of the asked name must appear in the page title.
function relatesToName(title: string, name: string): boolean {
  const wanted = nameTokens(name);

  if (wanted.length === 0) {
    return false;
  }

  const available = nameTokens(title);
  const matched = wanted.filter((word) =>
    available.some(
      (candidate) =>
        candidate === word || (word.length >= 3 && candidate.includes(word)),
    ),
  );

  return matched.length * 2 > wanted.length;
}

// Asks Wikipedia which place a weakly matched name most likely means, first in
// the user's language and then in English. Returns null when nothing relevant
// is found, so the normal map result is used instead.
async function resolveWeakMatch(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<PlaceCandidate | null> {
  const name = placeNameOf(query);
  const contexts: ToolContext[] =
    ctx.lang === WIKI_FALLBACK_LANG
      ? [ctx]
      : [ctx, { ...ctx, lang: WIKI_FALLBACK_LANG }];

  for (const context of contexts) {
    try {
      const resolved = await resolveViaWikipedia(name, context, signal);

      if (resolved && relatesToName(wikiTitleOf(resolved.wikipedia), name)) {
        return resolved;
      }
    } catch (error) {
      console.error(
        `find_place wikipedia resolve failed: ${describeError(error)}`,
      );
    }
  }

  return null;
}

function uniqueTexts(values: readonly string[]): string[] {
  const unique: string[] = [];

  for (const value of values) {
    const text = value.trim();

    if (text && !unique.includes(text)) {
      unique.push(text);
    }
  }

  return unique;
}

// Searches to try, most specific first. When a country code is known every
// search is limited to that country, plus one unrestricted safety-net search in
// case the code was wrong.
function buildAttempts(query: string, hints: PlaceHints): Attempt[] {
  const texts = uniqueTexts([
    hints.localName ?? "",
    query,
    placeNameOf(query),
  ]);

  const attempts: Attempt[] = texts.map((text) =>
    hints.countryCode ? { text, countryCode: hints.countryCode } : { text },
  );

  if (hints.countryCode) {
    attempts.push({ text: query });
  }

  return attempts;
}

function notFoundOutcome(ctx: ToolContext, query: string): ToolOutcome {
  const name = placeNameOf(query);

  return {
    data: { results: [], note: "No places were found." },
    finalText:
      ctx.lang === "fa"
        ? `«${name}» را روی نقشه پیدا نکردم. اگر شهر یا کشورش را هم بنویسی دوباره امتحان می‌کنم.`
        : `I could not find "${name}" on the map. If you add its city or country I will try again.`,
  };
}

function mapDownOutcome(ctx: ToolContext, detail: string): ToolOutcome {
  return {
    data: { error: "map_lookup_failed", detail: detail.slice(0, 200) },
    finalText:
      ctx.lang === "fa"
        ? "الان به نقشه دسترسی ندارم. کمی بعد دوباره امتحان کن."
        : "I cannot reach the map right now. Please try again in a moment.",
  };
}

async function runNearbySearch(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!ctx.location) {
    return {
      data: { error: "user_location_not_available" },
      finalText:
        ctx.lang === "fa"
          ? "برای پیدا کردن جاهای اطراف، دسترسی به موقعیت مکانی را برای این سایت در تنظیمات مرورگر فعال کن."
          : "To find places near you, allow location access for this site in your browser settings.",
    };
  }

  const attempts: NominatimOptions[] = [
    { limit: 10, viewbox: { delta: 0.06, bounded: true } },
    { limit: 10, viewbox: { delta: 0.3, bounded: true } },
    { limit: 10, viewbox: { delta: 0.3, bounded: false } },
  ];

  let lastError = "";

  for (const options of attempts) {
    try {
      const found = await searchNominatim(query, ctx, options, signal);
      const items = selectNearby(found);

      if (items.length > 0) {
        return nearbyOutcome(items, ctx);
      }
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place nominatim failed: ${lastError}`);
    }
  }

  try {
    const found = await searchPhoton(query, ctx, signal, true);
    const items = selectNearby(found);

    if (items.length > 0) {
      return nearbyOutcome(items, ctx);
    }
  } catch (error) {
    lastError = describeError(error);
    console.error(`find_place photon failed: ${lastError}`);
  }

  if (lastError) {
    return mapDownOutcome(ctx, lastError);
  }

  return {
    data: { results: [], note: "No places were found." },
    finalText:
      ctx.lang === "fa"
        ? "جای مناسبی نزدیک شما پیدا نشد."
        : "I could not find a suitable place near you.",
  };
}

async function runSpecificPlace(
  query: string,
  hints: PlaceHints,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  let collected: PlaceCandidate[] = [];
  let lastError = "";

  for (const attempt of buildAttempts(query, hints)) {
    try {
      const found = await searchNominatim(
        attempt.text,
        ctx,
        {
          limit: 8,
          viewbox: null,
          ...(attempt.countryCode ? { countryCode: attempt.countryCode } : {}),
        },
        signal,
      );

      collected = collected.concat(found);
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place nominatim failed: ${lastError}`);
    }

    const best = chooseCandidates(collected, hints)[0];

    if (best && isTrusted(best, hints)) {
      break;
    }
  }

  if (collected.length === 0) {
    try {
      collected = await searchPhoton(query, ctx, signal, false);
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place photon failed: ${lastError}`);
    }
  }

  let ranked = chooseCandidates(collected, hints);
  let top = ranked[0];

  // No trustworthy map match: let Wikipedia decide which place is meant.
  if (!top || !isTrusted(top, hints)) {
    const resolved = await resolveWeakMatch(query, ctx, signal);

    if (resolved) {
      ranked = [resolved, ...ranked];
      top = resolved;
    }
  }

  if (!top) {
    return lastError
      ? mapDownOutcome(ctx, lastError)
      : notFoundOutcome(ctx, query);
  }

  console.log(
    `find_place "${query}" -> ${top.item.name} (${top.item.lat}, ${top.item.lon}) importance ${top.importance.toFixed(2)} hints ${JSON.stringify(hints)}`,
  );

  // When the model has said exactly which place it means, show that single
  // place; several same-name places are shown only when nothing was specified.
  const hinted =
    hints.approx !== undefined || hints.countryCode !== undefined;

  const pick: SpecificPick = hinted
    ? { chosen: top, alternatives: [], ambiguous: false }
    : pickSpecific(top, ranked);

  let group: PlaceCandidate[] = [pick.chosen];

  if (pick.ambiguous) {
    group = [pick.chosen, ...pick.alternatives];
  }

  const chosen = group[0] ?? pick.chosen;

  let about = "";
  let photos: PhotoItem[] = [];

  if (chosen.wikipedia) {
    const [summary, gallery] = await Promise.all([
      fetchWikipediaSummary(chosen.wikipedia, signal),
      fetchWikipediaPhotos(chosen.wikipedia, signal),
    ]);

    about = summary;
    photos = gallery;
  }

  let webContext: Array<{ readonly source: string; readonly snippet: string }> =
    [];

  if (!about && ctx.tavilyKey && !pick.ambiguous) {
    const found = await tavilySearch(
      `${chosen.item.name} ${chosen.item.address}`.trim(),
      ctx.tavilyKey,
      3,
      signal,
    );

    webContext = (found ?? []).map((result) => ({
      source: result.source,
      snippet: result.snippet.slice(0, 200),
    }));
  }

  const cards: CardPayload[] = [
    { t: "places", lang: ctx.lang, items: group.map((entry) => entry.item) },
  ];

  if (photos.length > 0 && !pick.ambiguous) {
    cards.push({ t: "photos", lang: ctx.lang, items: photos });
  }

  const finalText = pick.ambiguous
    ? buildAmbiguousAnswer(ctx, group)
    : buildPlaceAnswer(ctx, chosen.item, about);

  return {
    data: {
      place: {
        name: chosen.item.name,
        region: chosen.item.address,
        category: chosen.category,
        lat: chosen.item.lat,
        lon: chosen.item.lon,
        distance_km: chosen.item.km,
        facts: chosen.facts,
        about,
        about_source: about ? "wikipedia" : "",
      },
      web_context: webContext,
      ambiguous: pick.ambiguous,
      shown: group.map((entry) => entry.item.address),
    },
    finalText,
    cardFirst: true,
    cards,
  };
}

export async function runFindPlace(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";

  if (!query) {
    return { data: { error: "query is required." } };
  }

  return args.intent === "nearby_search"
    ? await runNearbySearch(query, ctx, signal)
    : await runSpecificPlace(query, readHints(args), ctx, signal);
}
