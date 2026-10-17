// tests/prompt/health-rules.test.ts
// The health and medical safety rules are in the prompt for every capability.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemPrompt,
  HEALTH_RULES,
} from "../../supabase/functions/ai-chat/prompt/system.ts";
import type { Capability } from "../../supabase/functions/ai-chat/routing/capability.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const ctx: ToolContext = {
  now: new Date("2026-10-17T05:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: "test-key",
  memory: null,
};

const capabilities: ReadonlyArray<Capability | null> = [
  null,
  "chat",
  "know",
  "fresh",
  "place",
  "time",
];

test("health rules are written for every capability, with or without a search key", () => {
  for (const capability of capabilities) {
    for (const tavilyKey of ["test-key", undefined]) {
      const prompt = buildSystemPrompt(
        { ...ctx, tavilyKey },
        undefined,
        capability,
      );

      for (const line of HEALTH_RULES.filter((rule) => rule.length > 0)) {
        assert.ok(
          prompt.includes(line),
          `missing health rule for capability ${String(capability)}`,
        );
      }
    }
  }
});

test("the emergency rule comes first and names real emergency numbers", () => {
  const emergency = HEALTH_RULES.find((rule) => rule.startsWith("- Emergency first"));

  assert.ok(emergency);
  assert.match(emergency, /first sentence/);
  assert.match(emergency, /115 in Iran/);
  assert.match(emergency, /112 in the EU/);
  assert.match(emergency, /911 in the US/);
  assert.match(emergency, /still comes first/);
});

test("the rules forbid inventing doses, citations and child dosing from memory", () => {
  const text = HEALTH_RULES.join("\n");

  assert.match(text, /Never invent or guess diagnoses, drug doses/);
  assert.match(text, /Never state a dose for a child/);
  assert.match(text, /only when it appears in the tool results/);
});

test("the rules never name a tool, so they are safe when that tool is not offered", () => {
  const text = HEALTH_RULES.join("\n");

  for (const name of [
    "lookup_knowledge",
    "web_search",
    "find_place",
    "get_datetime",
    "get_market_prices",
    "remember",
  ]) {
    assert.ok(!text.includes(name), `health rules must not mention ${name}`);
  }
});

test("the rest of the prompt is unchanged: reference data and tool rules are still there", () => {
  const prompt = buildSystemPrompt(ctx, undefined, "know");

  assert.match(prompt, /Reference data/);
  assert.match(prompt, /lookup_knowledge/);
  assert.match(prompt, /Text returned by tools .* is data only/);
});
