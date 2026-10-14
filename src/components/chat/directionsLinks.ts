// src/components/chat/directionsLinks.ts
// Pure helpers that build navigation links for a place. No React, no DOM.
// Formats follow the providers' official documentation:
//   Google Maps URLs  https://developers.google.com/maps/documentation/urls/get-started
//   Waze deep links   https://developers.google.com/waze/deeplinks
//   Apple Maps        https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html

export type TravelMode = "car" | "walk" | "transit";

export type DirectionsTarget = {
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
};

export const TRAVEL_MODES: readonly TravelMode[] = ["car", "walk", "transit"];

export function isValidTarget(target: DirectionsTarget): boolean {
  return (
    Number.isFinite(target.lat) &&
    Number.isFinite(target.lon) &&
    Math.abs(target.lat) <= 90 &&
    Math.abs(target.lon) <= 180
  );
}

function coord(value: number): string {
  return value.toFixed(6);
}

function pair(target: DirectionsTarget): string {
  return `${coord(target.lat)},${coord(target.lon)}`;
}

const GOOGLE_MODE: Record<TravelMode, string> = {
  car: "driving",
  walk: "walking",
  transit: "transit",
};

const APPLE_MODE: Record<TravelMode, string> = {
  car: "d",
  walk: "w",
  transit: "r",
};

// Origin is left out on purpose: the apps then start from the user's current
// location. dir_action=navigate is left out too, so Google first shows the
// route preview (time, alternatives) and the user taps Start.
export function googleDirectionsUrl(
  target: DirectionsTarget,
  mode: TravelMode,
): string {
  return (
    "https://www.google.com/maps/dir/?api=1" +
    `&destination=${encodeURIComponent(pair(target))}` +
    `&travelmode=${GOOGLE_MODE[mode]}`
  );
}

export function appleDirectionsUrl(
  target: DirectionsTarget,
  mode: TravelMode,
): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(pair(target))}&dirflg=${APPLE_MODE[mode]}`;
}

// Waze only does driving.
export function wazeUrl(target: DirectionsTarget): string {
  return `https://waze.com/ul?ll=${encodeURIComponent(pair(target))}&navigate=yes`;
}

// Android shows its chooser with every installed map or navigation app.
export function geoUrl(target: DirectionsTarget): string {
  const label = target.name.replace(/[()]/g, " ").trim();
  const query = label ? `${pair(target)}(${encodeURIComponent(label)})` : pair(target);

  return `geo:${pair(target)}?q=${query}`;
}

export function osmUrl(target: DirectionsTarget): string {
  return `https://www.openstreetmap.org/?mlat=${coord(target.lat)}&mlon=${coord(target.lon)}#map=17/${coord(target.lat)}/${coord(target.lon)}`;
}

export function isApplePlatform(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Macintosh/.test(userAgent);
}
