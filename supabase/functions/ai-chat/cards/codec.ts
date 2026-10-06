// supabase/functions/ai-chat/cards/codec.ts
// Encode/decode the ":::md-card~...:::" markers the client renders.

import type { CardPayload } from "../types.ts";
import { isRecord } from "../lib/util.ts";

export const CLOCK_MARKER_PATTERN =
  /:::md-clock~[^~\s]+~[A-Za-z0-9_\/+-]+~(?:fa|en):::/g;

export const CARD_MARKER_PATTERN = /:::md-card~([A-Za-z0-9_-]+):::/g;

export function encodeCard(card: CardPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(card));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const body = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `:::md-card~${body}:::`;
}

export function decodeCardBody(body: string): unknown {
  try {
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// Short bracketed description of a card, stored in the model's history
// instead of the raw marker.
export function describeCardForHistory(body: string): string {
  const decoded = decodeCardBody(body);

  if (!isRecord(decoded)) {
    return "";
  }

  if (decoded.t === "places" && Array.isArray(decoded.items)) {
    const entries = decoded.items
      .filter(isRecord)
      .slice(0, 3)
      .map((item) => {
        const name = typeof item.name === "string" ? item.name : "";
        const address = typeof item.address === "string" ? item.address : "";
        const km =
          typeof item.km === "number" ? `, ${item.km} km from the user` : "";

        return `${name}${address ? ` (${address})` : ""}${km}`;
      })
      .filter(Boolean);

    return entries.length > 0 ? `[map card shown: ${entries.join("; ")}]` : "";
  }

  if (decoded.t === "clock") {
    const zone = typeof decoded.zone === "string" ? decoded.zone : "";

    return zone ? `[clock card shown for ${zone}]` : "";
  }

  if (decoded.t === "photos") {
    return "[photo strip shown]";
  }

  return "";
}

export function stripMarkers(content: string): string {
  return content
    .replace(CLOCK_MARKER_PATTERN, "")
    .replace(CARD_MARKER_PATTERN, (_match: string, body: string) =>
      describeCardForHistory(body),
    )
    .trim();
}
