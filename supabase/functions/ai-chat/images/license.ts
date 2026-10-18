// supabase/functions/ai-chat/images/license.ts
// Decides whether a Wikimedia Commons file may be shown, and who to credit.
// Only clearly free files pass: CC0, CC BY, CC BY-SA and public domain. A file
// with any restriction flag, a non-free flag or an unknown license is dropped,
// so the app never shows a picture it cannot credit correctly.

import { isRecord } from "../lib/util.ts";

export type Credit = {
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string;
};

const AUTHOR_MAX_CHARS = 80;
const LICENSE_MAX_CHARS = 40;
const LICENSE_URL_MAX_CHARS = 200;

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);

      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);

      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

// Commons metadata is HTML ("<a href=...>Name</a>"). Only the text is kept.
export function plainText(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// One value of the "extmetadata" object ({ "Artist": { "value": "..." } }).
export function metaValue(meta: unknown, key: string): string {
  if (!isRecord(meta)) {
    return "";
  }

  const entry = meta[key];

  if (!isRecord(entry)) {
    return "";
  }

  const value = entry.value;

  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

const NOT_FREE = /(?:^|[^a-z])(?:nc|nd)(?:[^a-z]|$)|non-?commercial|no-?deriv/i;
const CC_ATTRIBUTION = /^cc[ -]by(?![a-z])/i;
const NO_ATTRIBUTION = [/^cc0(?![a-z0-9])/i, /^public domain(?![a-z])/i, /^pd(?![a-z])/i];

export function isFreeLicense(name: string): boolean {
  const value = name.trim();

  if (!value || NOT_FREE.test(value)) {
    return false;
  }

  return CC_ATTRIBUTION.test(value) || NO_ATTRIBUTION.some((pattern) => pattern.test(value));
}

function needsAuthor(name: string): boolean {
  return CC_ATTRIBUTION.test(name.trim());
}

// Only the license texts of Creative Commons are linked.
function licenseLink(value: string): string {
  try {
    const parsed = new URL(value.trim());

    if (parsed.protocol !== "https:" || parsed.hostname !== "creativecommons.org") {
      return "";
    }

    return parsed.href.slice(0, LICENSE_URL_MAX_CHARS);
  } catch {
    return "";
  }
}

// null = the file must not be shown.
export function readCredit(meta: unknown): Credit | null {
  if (metaValue(meta, "NonFree").trim().toLowerCase() === "true") {
    return null;
  }

  if (plainText(metaValue(meta, "Restrictions"))) {
    return null;
  }

  const license = clip(plainText(metaValue(meta, "LicenseShortName")), LICENSE_MAX_CHARS);

  if (!isFreeLicense(license)) {
    return null;
  }

  const author = clip(
    plainText(metaValue(meta, "Artist")).replace(/^(?:©|\(c\)|copyright)\s*/i, ""),
    AUTHOR_MAX_CHARS,
  );

  if (needsAuthor(license) && !author) {
    return null;
  }

  return {
    author,
    license,
    licenseUrl: licenseLink(metaValue(meta, "LicenseUrl")),
  };
}
