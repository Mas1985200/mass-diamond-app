// supabase/functions/ai-chat/retrieval/dates.ts
// How old is a search result? The app works it out from the published date and
// today's date in the user's time zone, so the model never has to guess whether
// a piece of news is "today's".

import { dateKey, persianDateText } from "../lib/time.ts";

const DAY_MS = 86_400_000;

// Persian and Arabic-Indic digits written in a date are read as ordinary digits.
function asciiDigits(text: string): string {
  return text
    .replace(/[\u06F0-\u06F9]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0),
    )
    .replace(/[\u0660-\u0669]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x0660),
    );
}

// "YYYY-MM-DD" of a moment as seen in the given zone; an unknown zone means UTC.
export function dayKey(date: Date, zone: string | null): string {
  try {
    return dateKey(zone ?? "UTC", date);
  } catch {
    return dateKey("UTC", date);
  }
}

function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);

  if (!match) {
    return null;
  }

  return Math.floor(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS,
  );
}

// The calendar day a result was published on, as "YYYY-MM-DD", or null when the
// text is missing, not a date this code understands, or makes no sense (a year
// far from today, for example a Persian-calendar year read as a Gregorian one).
export function publishedDay(
  raw: string,
  now: Date,
  zone: string | null,
): string | null {
  const text = asciiDigits(raw).trim();

  if (!text) {
    return null;
  }

  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  let key: string | null = null;

  if (plain) {
    key = text;
  } else {
    const time = Date.parse(text);

    key = Number.isNaN(time) ? null : dayKey(new Date(time), zone);
  }

  if (key === null || dayNumber(key) === null) {
    return null;
  }

  const year = Number(key.slice(0, 4));
  const thisYear = now.getUTCFullYear();

  return year >= thisYear - 30 && year <= thisYear + 1 ? key : null;
}

// Whole calendar days between the published day and today in the user's zone.
// 0 = today, 1 = yesterday. A date more than a day in the future is not
// believable, so it is treated as unknown (null).
export function ageInDays(
  raw: string,
  now: Date,
  zone: string | null,
): number | null {
  const published = publishedDay(raw, now, zone);

  if (published === null) {
    return null;
  }

  const then = dayNumber(published);
  const today = dayNumber(dayKey(now, zone));

  if (then === null || today === null) {
    return null;
  }

  const age = today - then;

  if (age < -1) {
    return null;
  }

  return Math.max(0, age);
}

// A plain English label the model can translate: it never has to calculate.
export function whenLabel(age: number | null): string {
  if (age === null) {
    return "date not stated";
  }

  if (age === 0) {
    return "today";
  }

  if (age === 1) {
    return "yesterday";
  }

  return `${age} days ago`;
}

// The day written the way the user reads dates, with its weekday, so the model
// copies it and never converts between calendars itself (it gets that wrong):
// Persian (Solar Hijri) for Persian, and for every other language the ordinary
// calendar written in that language. The language is the one the model says it
// is answering in (a BCP-47 tag such as "es", "ru", "zh"); when it is missing or
// not one the runtime knows, English is used.
export function dateLabel(
  day: string,
  lang: "fa" | "en",
  locale: string | null = null,
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (!match) {
    return null;
  }

  // Noon UTC read in UTC is the same calendar day everywhere.
  const noon = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
  const tag = knownLocale(locale);

  if (lang === "fa" || tag === "fa") {
    return persianDateText(noon, "UTC") || null;
  }

  try {
    return new Intl.DateTimeFormat(tag ?? "en-US", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(noon);
  } catch {
    return null;
  }
}

// A language tag the runtime can format dates in, or null.
export function knownLocale(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const tag = value.trim();

  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(tag)) {
    return null;
  }

  try {
    const [supported] = Intl.DateTimeFormat.supportedLocalesOf([tag]);

    return supported ?? null;
  } catch {
    return null;
  }
}
