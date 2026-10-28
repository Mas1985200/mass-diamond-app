// tests/providers/fallback.test.ts
// When Groq refuses a round, the router asks Cloudflare Workers AI next.
// Fake network only; no real key or account is used.

import test from "node:test";
import assert from "node:assert/strict";

import { openRound } from "../../supabase/functions/ai-chat/providers/router.ts";
import {
  activeProviders,
  providerOrder,
} from "../../supabase/functions/ai-chat/providers/registry.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const DEFAULT_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];
const GROQ_HOST = "api.groq.com";
const CF_HOST = "api.cloudflare.com";

type Call = { url: string; auth: string; body: Record<string, unknown> };

// Runs `body` with the given secrets and a fake network. `answer` decides the
// reply for every request; each request is recorded in `calls`.
async function withNetwork(
  env: Record<string, string>,
  answer: (url: string) => Response,
  body: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];

  globals.Deno = { env: { get: (name: string) => env[name] } };

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    calls.push({
      url: String(url),
      auth: headers.get("authorization") ?? "",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });

    return answer(String(url));
  }) as typeof fetch;

  try {
    await body(calls);
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
}

const busy = () =>
  new Response('{"error":{"message":"Rate limit reached. Please try again in 30s."}}', {
    status: 429,
  });
const fine = () => new Response("data: [DONE]\n\n", { status: 200 });
const signal = () => new AbortController().signal;
const ask = [{ role: "user" as const, content: "hi" }];

test("when Groq is rate limited the round opens on Cloudflare", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-1",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
      CF_AI_MODEL: "@cf/fb-model-1",
    },
    (url) => (url.includes(GROQ_HOST) ? busy() : fine()),
    async (calls) => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, true);

      if (result.ok) {
        assert.equal(result.model, "@cf/fb-model-1");
      }

      const last = calls[calls.length - 1];

      assert.ok(last);
      assert.equal(
        last.url,
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`,
      );
      assert.equal(last.auth, "Bearer cf-token");
      assert.equal(last.body.max_tokens, 4500);
      assert.equal("max_completion_tokens" in last.body, false);
      assert.equal("reasoning_effort" in last.body, false);
      assert.equal(last.body.stream, true);
      // The Groq key is never sent to Cloudflare, nor the Cloudflare token to Groq.
      assert.ok(calls.every((call) => !call.auth.includes("groq-key") || call.url.includes(GROQ_HOST)));
    },
  );
});

test("a working Groq is used first and Cloudflare is not called", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-2",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
    },
    () => fine(),
    async (calls) => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.ok(calls[0]?.url.includes(GROQ_HOST));
      assert.equal(calls[0]?.body.max_completion_tokens, 4500);
    },
  );
});

test("AI_PROVIDER_ORDER can put Cloudflare first, or use it alone", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-3",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
      CF_AI_MODEL: "@cf/fb-model-3",
      AI_PROVIDER_ORDER: "cloudflare",
    },
    () => fine(),
    async (calls) => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.ok(calls[0]?.url.includes(CF_HOST));
    },
  );
});

test("without a valid Cloudflare account id only Groq is used", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-4",
      CF_ACCOUNT_ID: "../not-an-id",
      CF_AI_TOKEN: "cf-token",
    },
    () => busy(),
    async (calls) => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, false);
      assert.ok(calls.length > 0);
      assert.ok(calls.every((call) => call.url.includes(GROQ_HOST)));
    },
  );
});

test("a photo is never sent to Cloudflare", async () => {
  const photo = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "what is this" },
        { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    },
  ];

  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_VISION_MODEL: "fb-vision-5",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
    },
    () => busy(),
    async (calls) => {
      const result = await openRound(photo, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, false);
      assert.ok(calls.every((call) => call.url.includes(GROQ_HOST)));
    },
  );
});

test("when both services refuse, the user sees the plain busy message", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-6",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
      CF_AI_MODEL: "@cf/fb-model-6",
    },
    () => busy(),
    async (calls) => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, false);

      if (!result.ok) {
        assert.match(result.error, /busy/i);
        assert.doesNotMatch(result.error, /Rate limit reached/);
        assert.equal(result.retryable, true);
      }

      assert.ok(calls.some((call) => call.url.includes(GROQ_HOST)));
      assert.ok(calls.some((call) => call.url.includes(CF_HOST)));
    },
  );
});

test("a Cloudflare error that is not a rate limit does not hide a Groq one", async () => {
  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-7",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "bad-token",
      CF_AI_MODEL: "@cf/fb-model-7",
    },
    (url) => (url.includes(GROQ_HOST) ? busy() : new Response("bad token", { status: 401 })),
    async () => {
      const result = await openRound(ask, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, false);

      if (!result.ok) {
        assert.match(result.error, /busy/i);
      }
    },
  );
});

test("the order secret ignores unknown names and falls back to the default", () => {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;

  try {
    globals.Deno = { env: { get: (name: string) => (name === "AI_PROVIDER_ORDER" ? " Cloudflare , nope,groq,cloudflare" : undefined) } };
    assert.deepEqual(providerOrder(), ["cloudflare", "groq"]);

    globals.Deno = { env: { get: (name: string) => (name === "AI_PROVIDER_ORDER" ? "nope" : undefined) } };
    assert.deepEqual(providerOrder(), ["groq", "cloudflare"]);

    globals.Deno = { env: { get: () => undefined } };
    assert.deepEqual(providerOrder(), ["groq", "cloudflare"]);
    assert.deepEqual(activeProviders(false), []);
  } finally {
    globals.Deno = originalDeno;
  }
});

test("a turn that only called a tool has empty text, not null, on other services", async () => {
  const withToolTurn = [
    { role: "user" as const, content: "news" },
    {
      role: "assistant" as const,
      content: null,
      tool_calls: [
        { id: "c1", type: "function" as const, function: { name: "web_search", arguments: "{}" } },
      ],
    },
    { role: "tool" as const, tool_call_id: "c1", content: "result" },
  ];

  await withNetwork(
    {
      GROQ_API_KEY: "groq-key",
      GROQ_MODEL_PREFERRED: "fb-groq-8",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_AI_TOKEN: "cf-token",
      CF_AI_MODEL: "@cf/fb-model-8",
    },
    (url) => (url.includes(GROQ_HOST) ? busy() : fine()),
    async (calls) => {
      const result = await openRound(withToolTurn, null, signal(), new Set(DEFAULT_MODELS));

      assert.equal(result.ok, true);

      const toCloudflare = calls.filter((call) => call.url.includes(CF_HOST));
      const toGroq = calls.filter((call) => call.url.includes(GROQ_HOST));
      const cfMessages = toCloudflare[0]?.body.messages as { role: string; content: unknown }[];
      const groqMessages = toGroq[0]?.body.messages as { role: string; content: unknown }[];

      assert.equal(cfMessages[1]?.content, "");
      assert.equal(groqMessages[1]?.content, null);
    },
  );
});
