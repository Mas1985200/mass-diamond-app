// tests/providers/effort.test.ts
// How hard the model that writes the answer thinks: high by default, the
// secret GROQ_REASONING_EFFORT can change it, helper calls stay on low.

import test from "node:test";
import assert from "node:assert/strict";

import {
  answerEffort,
  effortFor,
  requestRound,
} from "../../supabase/functions/ai-chat/providers/groq.ts";

function withEnv<T>(value: string | undefined, run: () => T): T {
  const globals = globalThis as unknown as { Deno?: unknown };
  const original = globals.Deno;

  globals.Deno = {
    env: {
      get: (name: string) => (name === "GROQ_REASONING_EFFORT" ? value : undefined),
    },
  };

  try {
    return run();
  } finally {
    globals.Deno = original;
  }
}

test("the answer model thinks at high effort by default", () => {
  assert.equal(withEnv(undefined, answerEffort), "high");
});

test("the secret can choose low, medium or high, in any case", () => {
  assert.equal(withEnv("low", answerEffort), "low");
  assert.equal(withEnv("HIGH", answerEffort), "high");
  assert.equal(withEnv(" medium ", answerEffort), "medium");
});

test("a wrong value falls back to high", () => {
  assert.equal(withEnv("extreme", answerEffort), "high");
});

async function sentEffort(effort?: "low" | "medium" | "high"): Promise<unknown> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return new Response(null, { status: 500 });
  }) as typeof fetch;

  try {
    const signal = new AbortController().signal;

    await (effort
      ? requestRound("k", "openai/gpt-oss-120b", [], null, signal, effort)
      : requestRound("k", "openai/gpt-oss-120b", [], null, signal));

    return body.reasoning_effort;
  } finally {
    globalThis.fetch = original;
  }
}

test("a helper call stays on low unless a higher effort is asked for", async () => {
  assert.equal(await sentEffort(), "low");
  assert.equal(await sentEffort("medium"), "medium");
});

test("a round that must pick a tool thinks one step lower than the answer round", () => {
  const forced = {
    tools: [],
    toolChoice: "required" as const,
  };
  const optional = {
    tools: [],
    toolChoice: "auto" as const,
  };

  assert.equal(withEnv(undefined, () => effortFor(forced)), "medium");
  assert.equal(withEnv(undefined, () => effortFor(optional)), "high");
  assert.equal(withEnv(undefined, () => effortFor(null)), "high");
  assert.equal(withEnv("low", () => effortFor(forced)), "low");
  assert.equal(withEnv("medium", () => effortFor(forced)), "medium");
});
