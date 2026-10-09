// supabase/functions/ai-chat/tools/places-search.ts
// Raw place lookups: Nominatim (OpenStreetMap) and Photon.

import { NOMINATIM_USER_AGENT, TOOL_TIMEOUT_MS } from "../config.ts";
import type { PlaceCandidate, PlaceItem, ToolContext } from "../types.ts";
import { isRecord, isValidGeo, pickString, round5 } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";
import { haversineKm } from "../lib/geo.ts";
import {
  reportNominatimStatus,
  waitForNominatimSlot,
} from "./nominatim-gate.ts";

export type NominatimOptions = {
  readonly limit: number;
  readonly viewbox: {
    readonly delta: number;
    readonly bounded: boolean;
  } | null;
  // Two-letter ISO country code; when given, only that country is searched.
  readonly countryCode?: string;
};

export type PhotonOptions = {
  // Results are pulled towards this point (the place the model had in mind).
  readonly bias?: { readonly lat: number; readonly lon: number };
  // Two-letter ISO country code, used as a soft filter.
  readonly countryCode?: string;
};

const FACT_KEYS: readonly string[] = [
  "website",
  "phone",
  "opening_hours",
  "population",
  "description",
  "height",
  "start_date",
  "operator",
];

function zoomFromRank(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 15;
  if (rank <= 4) return 5;
  if (rank <= 8) return 7;
  if (rank <= 12) return 9;
  if (rank <= 16) return 11;
  if (rank <= 18) return 12;
  if (rank <= 20) return 13;
  if (rank <= 22) return 14;
  if (rank <= 25) return 15;

  return 16;
}

function zoomFromPhotonType(type: string): number {
  if (type === "country") return 5;
  if (type === "state") return 7;
  if (type === "county") return 9;
  if (type === "city") return 11;
  if (type === "district" || type === "locality") return 13;

  return 16;
}

function withDistance(
  ctx: ToolContext,
  name: string,
  address: string,
  lat: number,
  lon: number,
  zoom?: number,
): PlaceItem {
  const km = ctx.location
    ? Math.round(haversineKm(ctx.location, lat, lon) * 10) / 10
    : undefined;

  return {
    name: name.slice(0, 80),
    address: address.slice(0, 160),
    lat: round5(lat),
    lon: round5(lon),
    ...(km !== undefined ? { km } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

export async function searchNominatim(
  query: string,
  ctx: ToolContext,
  options: NominatimOptions,
  master: AbortSignal,
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(options.limit),
    addressdetails: "1",
    extratags: "1",
    "accept-language": ctx.lang === "fa" ? "fa,en" : "en",
  });

  const countryCode = options.countryCode?.trim().toLowerCase() ?? "";

  if (/^[a-z]{2}$/.test(countryCode)) {
    params.set("countrycodes", countryCode);
  }

  if (options.viewbox && ctx.location) {
    const { lat, lon } = ctx.location;
    const d = options.viewbox.delta;

    params.set(
      "viewbox",
      [lon - d, lat + d, lon + d, lat - d].map((n) => n.toFixed(5)).join(","),
    );

    if (options.viewbox.bounded) {
      params.set("bounded", "1");
    }
  }

  // Wait for our turn first, so the request timer below only counts the
  // request itself and not the time spent in the queue. This throws at once
  // while the service is being skipped because it refused our requests.
  await waitForNominatimSlot(master);

  const timed = createAttempt(master, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    reportNominatimStatus(response.status);

    if (!response.ok) {
      throw new Error(`Nominatim failed with status ${response.status}.`);
    }

    const json: unknown = await response.json();

    if (!Array.isArray(json)) {
      return [];
    }

    const candidates: PlaceCandidate[] = [];

    for (const raw of json) {
      if (!isRecord(raw)) {
        continue;
      }

      const lat = Number(raw.lat);
      const lon = Number(raw.lon);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const address = isRecord(raw.address) ? raw.address : {};
      const extratags = isRecord(raw.extratags) ? raw.extratags : {};
      const displayName = pickString(raw, "display_name");
      const rank = Number(raw.place_rank);
      const importance = Number(raw.importance);

      const name =
        pickString(raw, "name") ||
        displayName.split(",")[0]?.trim() ||
        query;

      const region = [
        pickString(address, "city") ||
          pickString(address, "town") ||
          pickString(address, "village") ||
          pickString(address, "municipality") ||
          pickString(address, "county"),
        pickString(address, "state"),
        pickString(address, "country"),
      ]
        .filter(Boolean)
        .join(", ");

      const facts: Record<string, string> = {};

      for (const key of FACT_KEYS) {
        const value = pickString(extratags, key);

        if (value) {
          facts[key] = value.slice(0, 160);
        }
      }

      candidates.push({
        item: withDistance(
          ctx,
          name,
          region || displayName,
          lat,
          lon,
          zoomFromRank(rank),
        ),
        category: [pickString(raw, "category"), pickString(raw, "type")]
          .filter(Boolean)
          .join("/"),
        facts,
        wikipedia: pickString(extratags, "wikipedia"),
        importance: Number.isFinite(importance) ? importance : 0,
      });
    }

    return candidates;
  } finally {
    timed.clearConnectTimer();
  }
}

export async function searchPhoton(
  query: string,
  ctx: ToolContext,
  master: AbortSignal,
  useBias: boolean,
  options: PhotonOptions = {},
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({ q: query, limit: "8" });

  if (options.bias) {
    params.set("lat", String(options.bias.lat));
    params.set("lon", String(options.bias.lon));
  } else if (useBias && ctx.location) {
    params.set("lat", String(ctx.location.lat));
    params.set("lon", String(ctx.location.lon));
  }

  const timed = createAttempt(master, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://photon.komoot.io/api/?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Photon failed with status ${response.status}.`);
    }

    const json: unknown = await response.json();
    const features =
      isRecord(json) && Array.isArray(json.features) ? json.features : [];

    const candidates: PlaceCandidate[] = [];
    const countries: string[] = [];

    for (const feature of features) {
      if (
        !isRecord(feature) ||
        !isRecord(feature.geometry) ||
        !isRecord(feature.properties)
      ) {
        continue;
      }

      const coordinates = feature.geometry.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        continue;
      }

      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const props = feature.properties;
      const name =
        pickString(props, "name") || pickString(props, "street") || query;
      const street = [
        pickString(props, "street"),
        pickString(props, "housenumber"),
      ]
        .filter(Boolean)
        .join(" ");
      const address = [
        street,
        pickString(props, "district"),
        pickString(props, "city"),
        pickString(props, "state"),
        pickString(props, "country"),
      ]
        .filter(Boolean)
        .join(", ");

      candidates.push({
        item: withDistance(
          ctx,
          name,
          address,
          lat,
          lon,
          zoomFromPhotonType(pickString(props, "type")),
        ),
        category: [pickString(props, "osm_key"), pickString(props, "osm_value")]
          .filter(Boolean)
          .join("/"),
        facts: {},
        wikipedia: "",
        importance: 0,
      });

      countries.push(pickString(props, "countrycode").toLowerCase());
    }

    // Soft country filter: only applied when at least one result is from the
    // wanted country, so a wrong country code never removes everything.
    const wanted = options.countryCode?.trim().toLowerCase() ?? "";

    if (/^[a-z]{2}$/.test(wanted) && countries.includes(wanted)) {
      return candidates.filter((_, index) => countries[index] === wanted);
    }

    return candidates;
  } finally {
    timed.clearConnectTimer();
  }
}
