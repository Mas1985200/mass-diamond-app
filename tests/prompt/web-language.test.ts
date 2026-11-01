// tests/prompt/web-language.test.ts
// The web search rule and the reference data must not push Persian habits (the
// Persian calendar, Persian digits, Persian filler words) onto readers of other
// languages, and must forbid closing offers and outlet names after results.

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../../supabase/functions/ai-chat/prompt/system.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const base: ToolContext = {
  now: new Date("2026-11-01T06:30:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
  memory: null,
};

test("the Persian-calendar date is given only to Persian readers", () => {
  const spanish = buildSystemPrompt(base, undefined, "fresh");
  const persian = buildSystemPrompt({ ...base, lang: "fa" }, undefined, "fresh");

  assert.ok(!spanish.includes("Solar Hijri date"));
  assert.ok(persian.includes("Persian (Solar Hijri) date:"));
  // The ordinary date is always there.
  assert.ok(spanish.includes("Gregorian date:"));
  assert.ok(persian.includes("Gregorian date:"));
});

test("numbers and dates follow the language of the user's message", () => {
  const prompt = buildSystemPrompt(base, undefined, "fresh");

  assert.ok(prompt.includes("language and calendar of the user's latest message"));
  assert.ok(prompt.includes("any other reader gets that language's own digits and words, never Persian ones"));
  assert.ok(!prompt.includes("Write numbers with Persian digits"));
  assert.ok(!prompt.includes("yours to convert"));
});

test("after search results: no closing offer, no outlet names, an update is not news", () => {
  const prompt = buildSystemPrompt(base, undefined, "fresh");

  assert.ok(prompt.includes("no closing question, no offer to search more"));
  assert.ok(prompt.includes("never write the name of a news agency, newspaper or website"));
  assert.ok(prompt.includes("was updated is not news"));
});
