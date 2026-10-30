// tests/providers/output-limit.test.ts
// Groq can refuse a request because the model may produce only a few output
// tokens a minute ("output tokens per minute (OTPM): Limit 1000, Requested
// 1277"). A model whose limit is too small for any useful answer is set aside
// instead of being tried every time; a bigger limit is simply respected.
// Fake network only; the wording of the refusal follows Groq's real one.

import test from "node:test";
import assert from "node:assert/strict";

import {
  outputTokenLimit,
  shrinkForOutputLimit,
} from "../../supabase/functions/ai-chat/providers/budget.ts";
import {
  isUnsuitable,
  markUnsuitable,
} from "../../supabase/functions/ai-chat/providers/cooldown.ts";
import { openRound } from "../../supabase/functions/ai-chat/providers/router.ts";

const OTPM = (limit: number, requested: number) =>
  JSON.stringify({
    error: {
      message: `Request too large for model \`m\` in organization \`o\` service tier \`on_demand\` on output tokens per minute (OTPM): Limit ${limit}, Requested ${requested}. The request's expected output tokens exceed the enforced limit; reduce max_tokens (or the request's expected output) and try again.`,
      type: "tokens",
      code: "rate_limit_exceeded",
    },
  });

test("outputTokenLimit: reads the limit from the real refusal and ignores others", () => {
  assert.equal(outputTokenLimit(OTPM(1000, 1277)), 1000);
  assert.equal(
    outputTokenLimit("on tokens per minute (TPM): Limit 8000, Used 1, Requested 2"),
    null,
  );
  assert.equal(outputTokenLimit("garbage"), null);
  assert.equal(outputTokenLimit(""), null);
});

test("shrinkForOutputLimit: a tiny limit does not fit, a roomy one is respected", () => {
  assert.equal(shrinkForOutputLimit(1000, 4500, "high"), null);
  assert.deepEqual(shrinkForOutputLimit(2000, 4500, "high"), {
    maxTokens: 1800,
    effort: "low",
  });
  assert.deepEqual(shrinkForOutputLimit(3000, 4500, "high"), {
    maxTokens: 2800,
    effort: "medium",
  });
  // Never more room than was asked for.
  assert.deepEqual(shrinkForOutputLimit(9000, 4500, "high"), {
    maxTokens: 4500,
    effort: "high",
  });
});

test("markUnsuitable: set aside for a while, never for ever", () => {
  markUnsuitable("otpm-test-unit", 60_000);
  assert.equal(isUnsuitable("otpm-test-unit"), true);
  markUnsuitable("otpm-test-unit-over", -1);
  assert.equal(isUnsuitable("otpm-test-unit-over"), false);
  assert.equal(isUnsuitable("otpm-test-never-marked"), false);
});

type Seen = { model: string; max: number };

async function withNetwork(
  env: Record<string, string>,
  answer: (model: string, max: number) => Response,
  body: (seen: Seen[]) => Promise<void>,
): Promise<void> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  const seen: Seen[] = [];

  globals.Deno = { env: { get: (name: string) => env[name] } };

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      model: string;
      max_completion_tokens: number;
    };

    seen.push({ model: payload.model, max: payload.max_completion_tokens });

    return answer(payload.model, payload.max_completion_tokens);
  }) as typeof fetch;

  try {
    await body(seen);
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
}

const fine = () => new Response("data: [DONE]\n\n", { status: 200 });
const ask = [{ role: "user" as const, content: "hi" }];
// Only the preferred test model and gpt-oss-20b are left to try.
const exclude = () => new Set(["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);

test("a model with a tiny output limit is skipped now and not tried again", async () => {
  await withNetwork(
    { GROQ_API_KEY: "k", GROQ_MODEL_PREFERRED: "otpm-test-small" },
    (model) =>
      model === "otpm-test-small"
        ? new Response(OTPM(1000, 1277), { status: 429 })
        : fine(),
    async (seen) => {
      const first = await openRound(ask, null, new AbortController().signal, exclude());

      assert.equal(first.ok, true);
      assert.equal(first.ok && first.model, "openai/gpt-oss-20b");
      // The small model was tried once and gave no second chance with less room.
      assert.deepEqual(
        seen.filter((call) => call.model === "otpm-test-small").length,
        1,
      );
      assert.equal(isUnsuitable("otpm-test-small"), true);

      const second = await openRound(ask, null, new AbortController().signal, exclude());

      assert.equal(second.ok, true);
      // It is not asked again: only the other model is called this time.
      assert.equal(
        seen.filter((call) => call.model === "otpm-test-small").length,
        1,
      );
    },
  );
});

test("a model with a roomy output limit is asked again with that room", async () => {
  await withNetwork(
    { GROQ_API_KEY: "k", GROQ_MODEL_PREFERRED: "otpm-test-roomy" },
    (model, max) =>
      model === "otpm-test-roomy" && max > 2800
        ? new Response(OTPM(3000, max), { status: 429 })
        : fine(),
    async (seen) => {
      const result = await openRound(ask, null, new AbortController().signal, exclude());

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.model, "otpm-test-roomy");
      assert.deepEqual(
        seen.filter((call) => call.model === "otpm-test-roomy").map((call) => call.max),
        [4500, 2800],
      );
      assert.equal(isUnsuitable("otpm-test-roomy"), false);
    },
  );
});

test("the model that answered is logged, with no user text", async () => {
  const logged: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };

  try {
    await withNetwork(
      { GROQ_API_KEY: "k", GROQ_MODEL_PREFERRED: "otpm-test-logged" },
      () => fine(),
      async () => {
        const result = await openRound(
          [{ role: "user", content: "a very private question" }],
          null,
          new AbortController().signal,
          exclude(),
        );

        assert.equal(result.ok, true);
      },
    );
  } finally {
    console.log = originalLog;
  }

  const line = logged.find((text) => text.includes('"model_used"'));

  assert.ok(line);
  assert.ok(line.includes("otpm-test-logged"));
  assert.ok(!line.includes("private"));
});
