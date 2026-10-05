// supabase/functions/ai-chat/lib/geo.ts
// Distance and place-name helpers.

import type { GeoPoint, PlaceItem } from "../types.ts";

export function haversineKm(a: GeoPoint, lat: number, lon: number): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(lat - a.lat);
  const dLon = toRad(lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceBetween(a: PlaceItem, b: PlaceItem): number {
  return haversineKm({ lat: a.lat, lon: a.lon }, b.lat, b.lon);
}

export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\s\-_.,'"«»()]/g, "");
}
