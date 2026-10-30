// tests/retrieval/date-label.test.ts
// The app writes a result's date in the user's own calendar, with the weekday,
// so the model copies it and never converts between calendars. No network.

import test from "node:test";
import assert from "node:assert/strict";

import { dateLabel } from "../../supabase/functions/ai-chat/retrieval/dates.ts";

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
