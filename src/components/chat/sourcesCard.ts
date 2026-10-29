// src/components/chat/sourcesCard.ts
// Pure helpers for the "sources" card: the pages a web answer rests on.
// No React, no DOM. The card comes from the server as data and nothing in it is
// trusted: only plain http(s) addresses are kept, and the name shown to the
// user is taken from the address itself, not from the text the server sent.

export type Lang = "fa" | "en";

export interface SourceItem {
  readonly url: string;
  readonly host: string;
  readonly title: string;
}

export interface SourcesCardData {
  readonly t: "sources";
  readonly lang: Lang;
  readonly items: readonly SourceItem[];
}

export const MAX_SOURCES = 4;

// A web address without spaces, quote marks or angle brackets.
const WEB_ADDRESS_PATTERN = /^https?:\/\/[^\s"'<>]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./i, "");

    return host ? host : null;
  } catch {
    return null;
  }
}

export function parseSourcesCard(
  value: Record<string, unknown>,
): SourcesCardData | null {
  if (!Array.isArray(value.items)) {
    return null;
  }

  const items: SourceItem[] = [];
  const seen = new Set<string>();

  for (const raw of value.items) {
    if (items.length >= MAX_SOURCES) {
      break;
    }

    if (!isRecord(raw)) {
      continue;
    }

    const url = asText(raw.url, 600);

    if (!url || !WEB_ADDRESS_PATTERN.test(url)) {
      continue;
    }

    const host = hostOf(url);

    if (!host || seen.has(host)) {
      continue;
    }

    seen.add(host);
    items.push({ url, host, title: asText(raw.title, 100) ?? "" });
  }

  return items.length > 0
    ? { t: "sources", lang: value.lang === "en" ? "en" : "fa", items }
    : null;
}
