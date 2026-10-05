// supabase/functions/ai-chat/tools/places.ts
// find_place tool: specific places (most prominent match) and near-me search.

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
  ).slice(0, 2);

  return {
    chosen: top,
    alternatives: rivals,
    ambiguous: rivals.length > 0 && top.importance < 0.45,
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
  const chosen = pick.chosen;

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

  if (!about && ctx.tavilyKey) {
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
    { t: "places", lang: ctx.lang, items: [chosen.item] },
  ];

  if (photos.length > 0) {
    cards.push({ t: "photos", lang: ctx.lang, items: photos });
  }

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
      picked_reason: "most_prominent",
      other_matches: pick.alternatives.map((candidate) => ({
        name: candidate.item.name,
        region: candidate.item.address,
        distance_km: candidate.item.km,
      })),
    },
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
