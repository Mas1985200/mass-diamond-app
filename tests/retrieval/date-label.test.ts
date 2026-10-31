// tests/retrieval/date-label.test.ts
// The app writes a result's date in the user's own calendar, with the weekday,
// so the model copies it and never converts between calendars. No network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  dateLabel,
  knownLocale,
} from "../../supabase/functions/ai-chat/retrieval/dates.ts";

test("dateLabel: Persian readers get the Solar Hijri date with its weekday", () => {
  assert.equal(dateLabel("2026-10-29", "fa"), "پنجشنبه، ۷ آبان ۱۴۰۵");
  assert.equal(dateLabel("2026-10-14", "fa"), "چهارشنبه، ۲۲ مهر ۱۴۰۵");
});

test("dateLabel: everyone else gets the ordinary date with its weekday", () => {
  assert.equal(dateLabel("2026-10-29", "en"), "Thursday, October 29, 2026");
});

test("dateLabel: the day does not move with the server's time zone", () => {
  // Year boundaries are where a one-day slip would show first.
  assert.equal(dateLabel("2026-01-01", "en"), "Thursday, January 1, 2026");
  assert.equal(dateLabel("2026-12-31", "en"), "Thursday, December 31, 2026");
});

test("dateLabel: something that is not a day gives nothing", () => {
  assert.equal(dateLabel("", "fa"), null);
  assert.equal(dateLabel("last week", "en"), null);
  assert.equal(dateLabel("2026-10-29T10:00:00Z", "en"), null);
});

test("dateLabel: the date is written in the language the answer is written in", () => {
  assert.equal(dateLabel("2026-10-29", "en", "es"), "jueves, 29 de octubre de 2026");
  assert.equal(dateLabel("2026-10-29", "en", "ru"), "четверг, 29 октября 2026 г.");
  assert.equal(dateLabel("2026-10-29", "en", "de"), "Donnerstag, 29. Oktober 2026");
  assert.equal(dateLabel("2026-10-29", "en", "zh"), "2026年10月29日星期四");
  assert.equal(dateLabel("2026-10-29", "en", "hi"), "गुरुवार, 29 अक्टूबर 2026");
});

test("dateLabel: an unknown or missing language falls back to English", () => {
  assert.equal(dateLabel("2026-10-29", "en", null), "Thursday, October 29, 2026");
  assert.equal(dateLabel("2026-10-29", "en", "not a tag"), "Thursday, October 29, 2026");
  assert.equal(dateLabel("2026-10-29", "en", "xx-"), "Thursday, October 29, 2026");
});

test("dateLabel: Persian stays Solar Hijri however it is signalled", () => {
  assert.equal(dateLabel("2026-10-29", "fa", "es"), "پنجشنبه، ۷ آبان ۱۴۰۵");
  assert.equal(dateLabel("2026-10-29", "en", "fa"), "پنجشنبه، ۷ آبان ۱۴۰۵");
});

test("knownLocale: only real language tags pass", () => {
  assert.equal(knownLocale("es"), "es");
  assert.equal(knownLocale(" pt-BR "), "pt-BR");
  assert.equal(knownLocale(""), null);
  assert.equal(knownLocale("<script>"), null);
  assert.equal(knownLocale(42 as unknown as string), null);
});
