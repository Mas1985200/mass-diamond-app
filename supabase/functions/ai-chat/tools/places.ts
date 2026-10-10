// supabase/functions/ai-chat/tools/places.ts
// find_place tool: specific places and near-me search.
// For a specific place the server writes the short answer itself from the
// map and Wikipedia data, so the model cannot add invented details.
// The model says which place it means (names in several languages, country,
// approximate coordinates from its own knowledge); the server only verifies it:
// a result is trusted when it lies near the model's coordinates, or when
// Wikipedia confirms it. When the main map service refuses our requests the
// lookup moves to Photon. When the model's own hints turn out to be wrong, the
// place is looked up again by name alone through Wikipedia. Several places can
// be asked in one call (the "places" list); each gets its own card and answer,
// in order.
// Names and summaries come in the user's language; when no article exists in
// that language the summary is left out instead of showing a foreign language,
// and the model's one-line description is used instead. The country on the
// card always comes from the pin itself, never from the model's words.
// When nothing is found the server writes a fixed "not found" sentence, so the
// model never invents an answer.

import { MAX_TOOL_CALLS_PER_ROUND } from "../config.ts";
import { encodeCard } from "../cards/codec.ts";
import type {
  CardPayload,
  PhotoItem,
  PlaceCandidate,
  PlaceItem,
  ToolContext,
  ToolOutcome,
} from "../types.ts";
import { describeError, isRecord, round5 } from "../lib/util.ts";
import { distanceBetween, normalizePlaceName } from "../lib/geo.ts";
import {
  searchNominatim,
  searchPhoton,
  type NominatimOptions,
} from "./places-search.ts";
import {
  fetchWikipediaPhotos,
  fetchWikipediaSummary,
  findLocalizedArticle,
  searchWikipediaPlaces,
  type WikiPlaceHit,
} from "./wiki.ts";
import { isNominatimBlocked } from "./nominatim-gate.ts";

const ABOUT_MAX_CHARS = 400;
const AMBIGUOUS_IMPORTANCE = 0.55;
const MAX_SAME_NAME = 3;
const WIKI_FALLBACK_LANG = "en";

// Hints from the model: results near its approximate coordinates are
// preferred, but those coordinates are never the marker position themselves.
const APPROX_RADIUS_KM = 60;
const NEAR_MODEL_KM = 25;
const SHOW_UNTRUSTED_KM = 30;
const ADDRESS_SEARCH_KM = 30;
const HINT_MIN_IMPORTANCE = 0.3;
const WIKI_TAG_BONUS = 0.15;
const WIKI_RESOLVED_IMPORTANCE = 0.6;
const WIKI_ONLY_ZOOM = 14;
const EARTH_RADIUS_KM = 6371;

// Arabic and Persian share one script. These letters are written differently
// in Arabic, so their presence marks Arabic text.
const ARABIC_ONLY_LETTERS = /[\u064A\u0643\u0629\u0649]/;

type PlaceHints = {
  readonly countryCode?: string;
  readonly localName?: string;
  readonly displayName?: string;
  readonly region?: string;
  readonly description?: string;
  readonly approx?: { readonly lat: number; readonly lon: number };
};

type PlaceRequest = {
  readonly query: string;
  readonly hints: PlaceHints;
};

type Attempt = {
  readonly text: string;
  readonly countryCode?: string;
};

type WikipediaInfo = {
  readonly about: string;
  readonly localName: string;
  readonly photos: PhotoItem[];
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
  const display =
    typeof args.display_name === "string"
      ? args.display_name.trim().slice(0, 80)
      : "";
  const region =
    typeof args.region === "string" ? args.region.trim().slice(0, 120) : "";
  const description =
    typeof args.description === "string"
      ? args.description.trim().slice(0, 300)
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
    ...(display ? { displayName: display } : {}),
    ...(region ? { region } : {}),
    ...(description ? { description } : {}),
    ...(hasApprox ? { approx: { lat, lon } } : {}),
  };
}

// Keeps only the names. Used when the model's other hints (country,
// coordinates, region, description) turned out to be unreliable.
function withoutLocationHints(hints: PlaceHints): PlaceHints {
  return {
    ...(hints.localName ? { localName: hints.localName } : {}),
    ...(hints.displayName ? { displayName: hints.displayName } : {}),
  };
}

// Reads the "places" list: several places asked in one call.
function readPlaceRequests(args: Record<string, unknown>): PlaceRequest[] {
  const raw = args.places;

  if (!Array.isArray(raw)) {
    return [];
  }

  const requests: PlaceRequest[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }

    const query =
      typeof entry.query === "string" ? entry.query.trim().slice(0, 200) : "";
    const key = query.toLowerCase();

    if (!query || seen.has(key)) {
      continue;
    }

    seen.add(key);
    requests.push({ query, hints: readHints(entry) });
  }

  return requests;
}

// Photon gives no importance. This turns the kind of map object (OpenStreetMap
// key and value, the same in every country) into a rough importance, so a
// landmark is preferred over a hotel or a shop that merely contains its name.
function categoryImportance(category: string): number {
  const slash = category.indexOf("/");
  const key = slash >= 0 ? category.slice(0, slash) : category;
  const value = slash >= 0 ? category.slice(slash + 1) : "";

  switch (key) {
    case "tourism":
      return [
        "hotel",
        "guest_house",
        "hostel",
        "motel",
        "apartment",
        "chalet",
        "camp_site",
        "caravan_site",
      ].includes(value)
        ? 0.1
        : 0.6;
    case "historic":
    case "natural":
    case "place":
    case "waterway":
    case "aeroway":
      return 0.6;
    case "leisure":
      return ["park", "nature_reserve", "stadium", "garden"].includes(value)
        ? 0.5
        : 0.2;
    case "amenity":
      if (
        [
          "place_of_worship",
          "marketplace",
          "theatre",
          "townhall",
          "library",
          "university",
          "arts_centre",
        ].includes(value)
      ) {
        return 0.5;
      }

      return [
        "restaurant",
        "cafe",
        "fast_food",
        "bar",
        "pub",
        "bank",
        "atm",
        "pharmacy",
        "parking",
        "fuel",
        "clinic",
        "dentist",
        "kindergarten",
      ].includes(value)
        ? 0.1
        : 0.25;
    case "man_made":
      return ["tower", "lighthouse", "bridge", "pier", "obelisk"].includes(value)
        ? 0.5
        : 0.2;
    case "building":
      return [
        "cathedral",
        "mosque",
        "temple",
        "church",
        "castle",
        "palace",
        "stadium",
        "train_station",
        "synagogue",
        "shrine",
      ].includes(value)
        ? 0.5
        : 0.2;
    case "shop":
      return ["mall", "department_store"].includes(value) ? 0.4 : 0.15;
    default:
      return 0.3;
  }
}

function withCategoryImportance(candidate: PlaceCandidate): PlaceCandidate {
  return candidate.importance > 0 || !candidate.category
    ? candidate
    : { ...candidate, importance: categoryImportance(candidate.category) };
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

// A candidate is trusted as the place only when it fits where the model said
// the place is. Near those coordinates a Wikipedia tag or modest importance is
// enough; farther away more is needed; very far away only a notable object
// with a Wikipedia tag is accepted, so a same-named object in another country
// is never taken for the place. Without coordinates a Wikipedia tag or high
// importance is enough.
function isTrusted(candidate: PlaceCandidate, hints: PlaceHints): boolean {
  const tagged = candidate.wikipedia.length > 0;
  const approx = hints.approx;

  if (!approx) {
    return tagged || candidate.importance >= AMBIGUOUS_IMPORTANCE;
  }

  const km = kmApart(
    candidate.item.lat,
    candidate.item.lon,
    approx.lat,
    approx.lon,
  );

  if (km <= NEAR_MODEL_KM) {
    return tagged || candidate.importance >= HINT_MIN_IMPORTANCE;
  }

  if (km <= APPROX_RADIUS_KM) {
    return tagged || candidate.importance >= AMBIGUOUS_IMPORTANCE;
  }

  return tagged && candidate.importance >= AMBIGUOUS_IMPORTANCE;
}

// True when the model gave coordinates and this result is both unconvincing
// and far from them: showing it would put a wrong pin on the map.
function isRejected(candidate: PlaceCandidate, hints: PlaceHints): boolean {
  const approx = hints.approx;

  return (
    approx !== undefined &&
    !isTrusted(candidate, hints) &&
    kmApart(
      candidate.item.lat,
      candidate.item.lon,
      approx.lat,
      approx.lon,
    ) > SHOW_UNTRUSTED_KM
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

// Short answer written by the server from map and Wikipedia data. When there
// is no Wikipedia summary in the user's language, the model's one-line
// description (if any) takes its place.
function buildPlaceAnswer(
  ctx: ToolContext,
  item: PlaceItem,
  about: string,
  description: string,
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

  const summary = trimAbout(about) || trimAbout(description);

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

// Used when no coordinates are available to judge a Wikipedia page: enough
// words of the searched name must appear in the page title. Names of one or
// two words need all their words; longer names need half of them.
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

  const needed =
    wanted.length <= 2 ? wanted.length : Math.ceil(wanted.length / 2);

  return matched.length >= needed;
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

// Turns a Wikipedia page into a map candidate using the page's own
// coordinates, which are exact for notable places.
function wikiCandidate(hit: WikiPlaceHit, ctx: ToolContext): PlaceCandidate {
  const km = ctx.location
    ? Math.round(
        kmApart(ctx.location.lat, ctx.location.lon, hit.lat, hit.lon) * 10,
      ) / 10
    : undefined;

  return {
    item: {
      name: hit.title.slice(0, 80),
      address: "",
      lat: round5(hit.lat),
      lon: round5(hit.lon),
      ...(km !== undefined ? { km } : {}),
      zoom: WIKI_ONLY_ZOOM,
    },
    category: "wikipedia",
    facts: {},
    wikipedia: hit.tag,
    importance: WIKI_RESOLVED_IMPORTANCE,
  };
}

// With coordinates from the model, the first Wikipedia page near them is the
// place; without them the page title must relate to the searched text.
function pickWikiHit(
  hits: readonly WikiPlaceHit[],
  searched: string,
  hints: PlaceHints,
): WikiPlaceHit | null {
  const approx = hints.approx;

  if (approx) {
    return (
      hits.find(
        (hit) =>
          kmApart(hit.lat, hit.lon, approx.lat, approx.lon) <=
          APPROX_RADIUS_KM,
      ) ?? null
    );
  }

  return hits.find((hit) => relatesToName(hit.title, searched)) ?? null;
}

// Asks Wikipedia which place a name most likely means. The name is searched
// first in the user's language (the name written for the user, then the
// English name, then the local name) and then in English.
async function resolveWeakMatch(
  query: string,
  hints: PlaceHints,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<PlaceCandidate | null> {
  const name = placeNameOf(query);

  const rounds: Array<{ readonly lang: string; readonly texts: string[] }> = [
    {
      lang: ctx.lang,
      texts: uniqueTexts([
        hints.displayName ?? "",
        name,
        hints.localName ?? "",
      ]),
    },
  ];

  if (ctx.lang !== WIKI_FALLBACK_LANG) {
    rounds.push({ lang: WIKI_FALLBACK_LANG, texts: uniqueTexts([name]) });
  }

  for (const round of rounds) {
    for (const text of round.texts) {
      try {
        const hits = await searchWikipediaPlaces(text, round.lang, signal);
        const hit = pickWikiHit(hits, text, hints);

        if (hit) {
          return wikiCandidate(hit, ctx);
        }
      } catch (error) {
        console.error(
          `find_place wikipedia resolve failed: ${describeError(error)}`,
        );
      }
    }
  }

  return null;
}

// Loads the Wikipedia summary and the place's name in the user's language.
// When the article does not exist in that language the summary stays empty,
// so text in a foreign language is never shown.
async function loadWikipediaInfo(
  tag: string,
  ctx: ToolContext,
  signal: AbortSignal,
  withPhotos: boolean,
): Promise<WikipediaInfo> {
  const localized = await findLocalizedArticle(tag, ctx.lang, signal);

  const [about, photos] = await Promise.all([
    localized
      ? fetchWikipediaSummary(localized.tag, signal)
      : Promise.resolve(""),
    withPhotos
      ? fetchWikipediaPhotos(tag, signal)
      : Promise.resolve<PhotoItem[]>([]),
  ]);

  return { about, localName: localized?.title ?? "", photos };
}

// True when the text is in the user's language. Persian text must be Arabic
// script without the letters that only Arabic uses, so an Arabic address is
// not mistaken for a Persian one.
function isInUserLanguage(text: string, lang: string): boolean {
  if (lang === "fa") {
    return /[\u0600-\u06FF]/.test(text) && !ARABIC_ONLY_LETTERS.test(text);
  }

  return /[A-Za-z]/.test(text);
}

// The country's name in the user's language, from its two-letter code. Empty
// when the code is unknown or the runtime has no name data for the language.
function countryNameFor(code: string, lang: string): string {
  if (!/^[a-z]{2}$/.test(code)) {
    return "";
  }

  try {
    const names = new Intl.DisplayNames([lang], { type: "region" });
    const name = names.of(code.toUpperCase());

    return name && name.toUpperCase() !== code.toUpperCase() ? name : "";
  } catch {
    return "";
  }
}

// The address line of the card, always in the user's language. The country
// always comes from the pin itself (verified), never from the model's words:
// the model's region keeps only its city and province parts and its last part,
// the country, is replaced. Order of preference: the map's own address when it
// is in the user's language, the model's region with the verified country, the
// verified country alone, the map's address in any language, and finally the
// address of a nearby map object (its country in the user's language when its
// address is in another language).
async function addressFor(
  candidate: PlaceCandidate,
  hints: PlaceHints,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<string> {
  const code = candidate.facts["country_code"] ?? "";
  const country = countryNameFor(code, ctx.lang);
  const existing = candidate.item.address.trim();

  if (existing && isInUserLanguage(existing, ctx.lang)) {
    return existing;
  }

  if (hints.region) {
    if (!country) {
      return hints.region;
    }

    const locality = hints.region
      .split(/[,،]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .slice(0, -1);

    return [...locality, country].join(ctx.lang === "fa" ? "، " : ", ");
  }

  if (country) {
    return country;
  }

  if (existing) {
    return existing;
  }

  try {
    const found = await searchPhoton(
      candidate.item.name,
      ctx,
      signal,
      false,
      { bias: { lat: candidate.item.lat, lon: candidate.item.lon } },
    );

    const near = found.find(
      (entry) =>
        entry.item.address.length > 0 &&
        kmApart(
          entry.item.lat,
          entry.item.lon,
          candidate.item.lat,
          candidate.item.lon,
        ) <= ADDRESS_SEARCH_KM,
    );

    if (!near) {
      return "";
    }

    if (isInUserLanguage(near.item.address, ctx.lang)) {
      return near.item.address;
    }

    return (
      countryNameFor(near.facts["country_code"] ?? "", ctx.lang) ||
      near.item.address
    );
  } catch (error) {
    console.error(`find_place address lookup failed: ${describeError(error)}`);

    return "";
  }
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

// One search: the main map service while it accepts our requests, otherwise
// Photon (pulled towards the model's coordinates).
async function lookupText(
  text: string,
  countryCode: string | undefined,
  hints: PlaceHints,
  ctx: ToolContext,
  signal: AbortSignal,
  errors: string[],
): Promise<PlaceCandidate[]> {
  if (!isNominatimBlocked()) {
    try {
      return await searchNominatim(
        text,
        ctx,
        {
          limit: 8,
          viewbox: null,
          ...(countryCode ? { countryCode } : {}),
        },
        signal,
      );
    } catch (error) {
      errors.push(describeError(error));
      console.error(`find_place nominatim failed: ${describeError(error)}`);
    }
  }

  try {
    const found = await searchPhoton(text, ctx, signal, false, {
      ...(hints.approx ? { bias: hints.approx } : {}),
      ...(countryCode ? { countryCode } : {}),
    });

    return found.map(withCategoryImportance);
  } catch (error) {
    errors.push(describeError(error));
    console.error(`find_place photon failed: ${describeError(error)}`);

    return [];
  }
}

// The "not found" sentence names the place the way the model wrote it for the
// user (in the user's language) and falls back to the search name.
function notFoundOutcome(
  ctx: ToolContext,
  query: string,
  hints: PlaceHints,
): ToolOutcome {
  const name = hints.displayName || placeNameOf(query);

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
  withPhotos: boolean,
): Promise<ToolOutcome> {
  const errors: string[] = [];
  let collected: PlaceCandidate[] = [];

  for (const attempt of buildAttempts(query, hints)) {
    const found = await lookupText(
      attempt.text,
      attempt.countryCode,
      hints,
      ctx,
      signal,
      errors,
    );

    collected = collected.concat(found);

    const best = chooseCandidates(collected, hints)[0];

    if (best && isTrusted(best, hints)) {
      break;
    }
  }

  if (collected.length === 0) {
    try {
      const found = await searchPhoton(query, ctx, signal, false, {
        ...(hints.approx ? { bias: hints.approx } : {}),
      });

      collected = found.map(withCategoryImportance);
    } catch (error) {
      errors.push(describeError(error));
      console.error(`find_place photon failed: ${describeError(error)}`);
    }
  }

  let ranked = chooseCandidates(collected, hints);
  let top = ranked[0];
  let activeHints: PlaceHints = hints;
  let rescued = false;

  // No trustworthy map match: let Wikipedia decide which place is meant.
  if (!top || !isTrusted(top, hints)) {
    const resolved = await resolveWeakMatch(query, hints, ctx, signal);

    if (resolved) {
      ranked = [resolved, ...ranked];
      top = resolved;
    }
  }

  // Still nothing believable. The model's own hints (country, coordinates)
  // may be the wrong part, for example when it confuses two places with the
  // same name. Ask Wikipedia again by name alone and ignore those hints,
  // together with the region and description the model wrote.
  const hasLocationHints =
    hints.approx !== undefined || hints.countryCode !== undefined;

  if (hasLocationHints && (!top || isRejected(top, hints))) {
    const stripped = withoutLocationHints(hints);
    const rescue = await resolveWeakMatch(query, stripped, ctx, signal);

    if (rescue) {
      console.log(
        `find_place rescued "${query}" by name -> ${rescue.item.name} (${rescue.item.lat}, ${rescue.item.lon}); the model's hints were ${JSON.stringify(hints)}`,
      );

      ranked = [rescue, ...ranked];
      top = rescue;
      activeHints = stripped;
      rescued = true;
    }
  }

  if (!top) {
    console.log(
      `find_place not found "${query}": ${collected.length} map results, ${errors.length} errors, nominatimBlocked ${isNominatimBlocked()}, hints ${JSON.stringify(hints)}`,
    );

    return errors.length > 0
      ? mapDownOutcome(ctx, errors[errors.length - 1] ?? "")
      : notFoundOutcome(ctx, query, hints);
  }

  // The best result is neither trusted nor near the model's coordinates: a
  // wrong pin is worse than saying it was not found.
  if (isRejected(top, activeHints)) {
    console.log(
      `find_place rejected "${query}": best result "${top.item.name}" (${top.item.lat}, ${top.item.lon}) is far from the model's coordinates, importance ${top.importance.toFixed(2)}`,
    );

    return notFoundOutcome(ctx, query, hints);
  }

  console.log(
    `find_place "${query}" -> ${top.item.name} (${top.item.lat}, ${top.item.lon}) importance ${top.importance.toFixed(2)} trusted ${isTrusted(top, activeHints)} rescued ${rescued} nominatimBlocked ${isNominatimBlocked()} hints ${JSON.stringify(hints)}`,
  );

  // When the model has said exactly which place it means, show that single
  // place; several same-name places are shown only when nothing was specified.
  const hinted =
    rescued ||
    activeHints.approx !== undefined ||
    activeHints.countryCode !== undefined;

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
  let displayItem: PlaceItem = chosen.item;

  if (!pick.ambiguous) {
    let shownName = chosen.item.name;

    if (chosen.wikipedia) {
      const info = await loadWikipediaInfo(
        chosen.wikipedia,
        ctx,
        signal,
        withPhotos,
      );

      about = info.about;
      photos = info.photos;

      if (info.localName) {
        shownName = info.localName;
      }
    }

    if (shownName === chosen.item.name && activeHints.displayName) {
      shownName = activeHints.displayName;
    }

    const address = await addressFor(chosen, activeHints, ctx, signal);

    displayItem = {
      ...chosen.item,
      name: shownName.slice(0, 80),
      address: address.slice(0, 160),
    };
  }

  const cards: CardPayload[] = [
    {
      t: "places",
      lang: ctx.lang,
      items: group.map((entry) =>
        entry === chosen ? displayItem : entry.item,
      ),
    },
  ];

  if (photos.length > 0 && !pick.ambiguous) {
    cards.push({ t: "photos", lang: ctx.lang, items: photos });
  }

  const finalText = pick.ambiguous
    ? buildAmbiguousAnswer(ctx, group)
    : buildPlaceAnswer(ctx, displayItem, about, activeHints.description ?? "");

  return {
    data: {
      place: {
        name: displayItem.name,
        region: displayItem.address,
        category: chosen.category,
        lat: chosen.item.lat,
        lon: chosen.item.lon,
        distance_km: chosen.item.km,
        facts: chosen.facts,
        about,
        about_source: about ? "wikipedia" : "",
      },
      ambiguous: pick.ambiguous,
      shown: group.map((entry) => entry.item.address),
    },
    finalText,
    cardFirst: true,
    cards,
  };
}

// Several places in one call: each place gets its card followed by its own
// answer, in the order asked. The cards are written into the text so the
// order is kept. Places are looked up one after another so the map services
// are not hit all at once. Photo galleries are left out to keep the screen
// tidy.
async function runManyPlaces(
  requests: readonly PlaceRequest[],
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const limited = requests.slice(0, MAX_TOOL_CALLS_PER_ROUND);
  const dropped = requests.length - limited.length;

  const parts: string[] = [];
  const summary: Array<{ readonly query: string; readonly found: boolean }> =
    [];

  for (const request of limited) {
    const outcome = await runSpecificPlace(
      request.query,
      request.hints,
      ctx,
      signal,
      false,
    );

    const cards = outcome.cards ?? [];
    const markers = cards.map((card) => encodeCard(card));
    const text = (outcome.finalText ?? "").trim();
    const block = [...markers, text].filter(Boolean).join("\n\n");

    if (block) {
      parts.push(block);
    }

    summary.push({ query: request.query, found: cards.length > 0 });
  }

  if (dropped > 0) {
    parts.push(
      ctx.lang === "fa"
        ? `فقط ${MAX_TOOL_CALLS_PER_ROUND.toLocaleString("fa-IR")} مکان اول را جواب دادم؛ بقیه را در پیام بعدی بپرس.`
        : `I answered the first ${MAX_TOOL_CALLS_PER_ROUND} places; ask about the rest in your next message.`,
    );
  }

  return {
    data: { places: summary },
    finalText: parts.join("\n\n"),
  };
}

export async function runFindPlace(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (args.intent !== "nearby_search") {
    const requests = readPlaceRequests(args);
    const only = requests[0];

    if (requests.length > 1) {
      return await runManyPlaces(requests, ctx, signal);
    }

    if (requests.length === 1 && only) {
      return await runSpecificPlace(only.query, only.hints, ctx, signal, true);
    }
  }

  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";

  if (!query) {
    return { data: { error: "query is required." } };
  }

  return args.intent === "nearby_search"
    ? await runNearbySearch(query, ctx, signal)
    : await runSpecificPlace(query, readHints(args), ctx, signal, true);
}
