// tests/prompt/cache-prefix.test.ts
// Groq reuses the identical beginning of a prompt (prompt caching) and does not
// count those tokens against the per-minute limits. So everything in the system
// prompt that changes (date, time, position, saved notes) must come after every
// rule, and two requests of one kind must share all of their rules letter for
// letter. No network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemPrompt,
  type MemoryContext,
} from "../../supabase/functions/ai-chat/prompt/system.ts";
import type { Capability } from "../../supabase/functions/ai-chat/routing/capability.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const base: ToolContext = {
  now: new Date("2026-10-17T05:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: "test-key",
  memory: null,
};

const later: ToolContext = {
  ...base,
  now: new Date("2026-10-31T09:37:00Z"),
  timeZone: "Europe/London",
  location: { lat: 51.5, lon: -0.12 } as unknown as ToolContext["location"],
};

const notes: MemoryContext = {
  facts: ["Likes football", "Lives in Tehran"],
  summaries: ["Talked about the league table"],
};

const kinds: ReadonlyArray<Capability | null> = [
  null,
  "chat",
  "know",
  "fresh",
  "place",
  "time",
  "attach",
];

const MARKER = "Reference data (authoritative; never recompute it):";

test("everything that changes comes last, after every rule", () => {
  for (const kind of kinds) {
    const prompt = buildSystemPrompt(base, notes, kind);
    const marker = prompt.indexOf(MARKER);

    assert.ok(marker > 0, `no reference data for ${String(kind)}`);
    // The last fixed rules sit in front of it.
    assert.ok(marker > prompt.indexOf("Honesty:"));
    assert.ok(marker > prompt.indexOf("Health and medical questions"));
    // Dates, time and saved notes are all behind it.
    for (const changing of [
      "Gregorian date:",
      "Local time:",
      "Saved notes about this user",
      "Short summaries of the user's earlier",
    ]) {
      assert.ok(
        prompt.indexOf(changing) > marker,
        `${changing} is in front of the marker for ${String(kind)}`,
      );
    }
  }
});

test("two requests of one kind share all their rules, whatever the date, place or notes", () => {
  for (const kind of kinds) {
    const a = buildSystemPrompt(base, undefined, kind);
    const b = buildSystemPrompt(later, notes, kind);
    const headA = a.slice(0, a.indexOf(MARKER));
    const headB = b.slice(0, b.indexOf(MARKER));

    assert.ok(headA.length > 1_000, `the shared part is tiny for ${String(kind)}`);
    assert.equal(headA, headB, `the rules differ between requests for ${String(kind)}`);
  }
});

test("the shared part is most of the prompt, so most of it can be reused", () => {
  const prompt = buildSystemPrompt(base, undefined, "fresh");
  const shared = prompt.indexOf(MARKER) / prompt.length;

  assert.ok(shared > 0.9, `only ${(shared * 100).toFixed(0)}% is shared`);
});
