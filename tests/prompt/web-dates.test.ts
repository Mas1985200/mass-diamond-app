// tests/prompt/web-dates.test.ts
// The web search rule must tell the model how to read what the app worked out
// for each result (when, age_days, note, reported_by), so that only a result
// from today is called today's, and sites are never named.

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../../supabase/functions/ai-chat/prompt/system.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const ctx: ToolContext = {
  now: new Date("2026-10-29T05:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: "test-key",
  memory: null,
};

test("the web search rule explains when, age_days, note and reported_by", () => {
  for (const capability of [null, "fresh"] as const) {
    const prompt = buildSystemPrompt(ctx, undefined, capability);

    assert.ok(prompt.includes("'when' and 'age_days'"), String(capability));
    assert.ok(prompt.includes("ONLY for a result whose 'when' is 'today'"));
    assert.ok(prompt.includes("follow it"));
    assert.ok(prompt.includes("'reported_by'"));
    assert.ok(prompt.includes("never name them"));
  }
});

test("without a search key the rule about results is not written", () => {
  const prompt = buildSystemPrompt(
    { ...ctx, tavilyKey: undefined },
    undefined,
    "fresh",
  );

  assert.ok(!prompt.includes("'age_days'"));
});
