// supabase/functions/ai-chat/tools/places-wiki.ts
// Wikipedia-assisted place resolution. When the map search returns only weak
// matches for a name, ask Wikipedia which place that name most likely means,
// then find that exact place on the map. Works for any name in any country;
// nothing here is specific to one place.

import type { PlaceCandidate, ToolContext } from "../types.ts";
import { describeError, round5 } from "../lib/util.ts";
import { searchNominatim } from "./places-search.ts";
import { searchWikipediaPlaces } from "./wiki.ts";

// A map result counts as the same place as the Wikipedia page when it lies
// within this distance of the page's coordinates.
const MAX_MATCH_KM = 30;
const EARTH_RADIUS_KM = 6371;

// Importance given to a place confirmed by Wikipedia. It must stay above the
// ambiguity threshold used in places.ts so the result is treated as certain.
const WIKI_RESOLVED_IMPORTANCE = 0.6;

const WIKI_ONLY_ZOOM = 14;

function kmBetween(
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

export async function resolveViaWikipedia(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<PlaceCandidate | null> {
  const hits = await searchWikipediaPlaces(query, ctx.lang, signal);
  const best = hits[0];

  if (!best) {
    return null;
  }

  let found: PlaceCandidate[] = [];

  try {
    found = await searchNominatim(
      best.title,
      ctx,
      { limit: 6, viewbox: null },
      signal,
    );
  } catch (error) {
    console.error(`wikipedia-assisted lookup failed: ${describeError(error)}`);
  }

  let match: PlaceCandidate | null = null;
  let matchKm = Number.POSITIVE_INFINITY;

  for (const candidate of found) {
    const km = kmBetween(
      best.lat,
      best.lon,
      candidate.item.lat,
      candidate.item.lon,
    );

    if (km <= MAX_MATCH_KM && km < matchKm) {
      match = candidate;
      matchKm = km;
    }
  }

  if (match) {
    return {
      ...match,
      wikipedia: match.wikipedia || best.tag,
      importance: Math.max(match.importance, WIKI_RESOLVED_IMPORTANCE),
    };
  }

  // The map has no entry under that title; trust Wikipedia's coordinates.
  return {
    item: {
      name: best.title.slice(0, 80),
      address: "",
      lat: round5(best.lat),
      lon: round5(best.lon),
      zoom: WIKI_ONLY_ZOOM,
    },
    category: "wikipedia",
    facts: {},
    wikipedia: best.tag,
    importance: WIKI_RESOLVED_IMPORTANCE,
  };
}
