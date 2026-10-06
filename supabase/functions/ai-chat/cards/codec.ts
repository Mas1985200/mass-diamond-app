// supabase/functions/ai-chat/cards/codec.ts
// Encode/decode the ":::md-card~...:::" markers the client renders.

import type { CardPayload } from "../types.ts";

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

// Cards are removed from the history completely. Leaving bracketed notes
// there made the model imitate them in its own answers.
export function stripMarkers(content: string): string {
  return content
    .replace(CLOCK_MARKER_PATTERN, "")
    .replace(CARD_MARKER_PATTERN, "")
    .trim();
}
