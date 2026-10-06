// supabase/functions/ai-chat/tools/places.ts
// find_place tool: specific places and near-me search.
// For a specific place the server writes the short answer itself from the
// map and Wikipedia data, so the model cannot add invented details.
// When several places share a lesser-known name, up to 3 are shown together.

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
import { tavilySearch } from "./web.ts";

const ABOUT_MAX_CHARS = 400;
const AMBIGUOUS_IMPORTANCE = 0.55;
const MAX_SAME_NAME = 3;

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

// Answer used when several places share the same name.
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
  const nearestFirst = ctx.location !== null;

  if (isFa) {
    return `چند مکان با نام «${name}» پیدا شد: ${joined}. ${
      nearestFirst ? "نزدیک‌ترین به شما اول نمایش داده شد." : "شناخته‌شده‌ترین اول نمایش داده شد."
    }`;
  }

  return `Several places are named "${name}": ${joined}. ${
    nearestFirst ? "The nearest to you is shown first." : "The best-known is shown first."
  }`;
}

async function runNearbySearch(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!ctx.location) {
    return {
      data: {
        error: "user_location_not_available",
        hint: "The user's location is not available. Tell them, in one short sentence, to allow location access for this site in the browser settings.",
      },
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
    return {
      data: { error: "map_lookup_failed", detail: lastError.slice(0, 200) },
    };
  }

  return { data: { results: [], note: "No places were found." } };
}

async function runSpecificPlace(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  let candidates: PlaceCandidate[] = [];
  let lastError = "";

  try {
    candidates = await searchNominatim(
      query,
      ctx,
      { limit: 8, viewbox: null },
      signal,
    );
  } catch (error) {
    lastError = describeError(error);
    console.error(`find_place nominatim failed: ${lastError}`);
  }

  if (candidates.length === 0) {
    try {
      candidates = await searchPhoton(query, ctx, signal, false);
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place photon failed: ${lastError}`);
    }
  }

  const ranked = candidates
    .slice()
    .sort((a, b) => b.importance - a.importance);
  const top = ranked[0];

  if (!top) {
    return lastError
      ? {
          data: {
            error: "map_lookup_failed",
            detail: lastError.slice(0, 200),
          },
        }
      : { data: { results: [], note: "No places were found." } };
  }

  const pick = pickSpecific(top, ranked);

  let group: PlaceCandidate[] = [pick.chosen];

  if (pick.ambiguous) {
    group = [pick.chosen, ...pick.alternatives];

    if (ctx.location) {
      group.sort((a, b) => (a.item.km ?? 1e9) - (b.item.km ?? 1e9));
    }
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
    : await runSpecificPlace(query, ctx, signal);
}
