// tests/providers/budget.test.ts
// When Groq refuses a request only because this minute's token allowance is
// nearly used, the same model is asked again with less room for the answer.
// Fake network only; the wording of the refusal follows Groq's real one.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_OUTPUT_TOKENS,
  shrinkForTokenLimit,
} from "../../supabase/functions/ai-chat/providers/budget.ts";
import { openRound } from "../../supabase/functions/ai-chat/providers/router.ts";

const REFUSAL = (limit: number, used: number, requested: number) =>
  JSON.stringify({
    error: {
      message: `Rate limit reached for model \`m\` in organization \`o\` service tier \`on_demand\` on tokens per minute (TPM): Limit ${limit}, Used ${used}, Requested ${requested}. Please try again in 5s.`,
    },
  });

test("the room for the answer is cut to what is left of the minute", () => {
  const shrunk = shrinkForTokenLimit(REFUSAL(8000, 4607, 5986), 4500, "high");

  // prompt = 5986 - 4500 = 1486; room = 8000 - 4607 - 1486 - 200 = 1707
  assert.deepEqual(shrunk, { maxTokens: 1707, effort: "low" });
});

test("a roomy minute keeps the thinking level", () => {
  const shrunk = shrinkForTokenLimit(REFUSAL(8000, 100, 5986), 4500, "high");

  assert.deepEqual(shrunk, { maxTokens: 4500, effort: "high" });
});

test("less room means less thinking, never more than was asked", () => {
  assert.equal(shrinkForTokenLimit(REFUSAL(8000, 3000, 5986), 4500, "high")?.effort, "medium");
  assert.equal(shrinkForTokenLimit(REFUSAL(8000, 1000, 5986), 3000, "low")?.effort, "low");
});

test("nothing useful fits, or the refusal is about something else", () => {
  assert.equal(shrinkForTokenLimit(REFUSAL(8000, 7000, 5986), 4500, "high"), null);
  assert.equal(shrinkForTokenLimit("tokens per day (TPD): Limit 1, Used 1, Requested 1", 4500, "high"), null);
  assert.equal(shrinkForTokenLimit("garbage", 4500, "high"), null);
  assert.equal(shrinkForTokenLimit(REFUSAL(8000, 0, 100), 4500, "high"), null);
  assert.ok(MIN_OUTPUT_TOKENS >= 1_000);
});

test("openRound asks the same model again with a smaller room", async () => {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  const sent: number[] = [];

  globals.Deno = {
    env: {
      get: (name: string) =>
        name === "GROQ_API_KEY"
          ? "k"
          : name === "GROQ_MODEL_PREFERRED"
            ? "budget-test-model"
            : undefined,
    },
  };

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { max_completion_tokens: number };

    sent.push(payload.max_completion_tokens);

    return sent.length === 1
      ? new Response(REFUSAL(8000, 4607, 1486 + payload.max_completion_tokens), { status: 429 })
      : new Response("data: [DONE]\n\n", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await openRound(
      [{ role: "user", content: "hi" }],
      null,
      new AbortController().signal,
      new Set(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]),
    );

    assert.equal(result.ok, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0], 4500);
    assert.equal(sent[1], 1707);
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});

test("when every model is rate limited the user gets a plain message, not the raw refusal", async () => {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;

  globals.Deno = {
    env: {
      get: (name: string) =>
        name === "GROQ_API_KEY" ? "k" : name === "GROQ_MODEL_PREFERRED" ? "budget-test-model-2" : undefined,
    },
  };

  globalThis.fetch = (async () =>
    new Response(REFUSAL(8000, 7900, 6000), { status: 429 })) as typeof fetch;

  try {
    const result = await openRound(
      [{ role: "user", content: "hi" }],
      null,
      new AbortController().signal,
      new Set(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]),
    );

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.match(result.error, /busy/i);
      assert.doesNotMatch(result.error, /org|Limit|Requested/);
    }
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
});
