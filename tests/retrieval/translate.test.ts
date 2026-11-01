// tests/retrieval/translate.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  languageTag,
  sameLanguage,
  translateQuery,
} from "../../supabase/functions/ai-chat/retrieval/translate.ts";

const g = globalThis as unknown as Record<string, unknown>;

function withEnv(env: Record<string, string>, fetchImpl: typeof fetch): () => void {
  const oldDeno = g.Deno;
  const oldFetch = globalThis.fetch;
  g.Deno = { env: { get: (k: string) => env[k] } };
  globalThis.fetch = fetchImpl;
  return () => {
    g.Deno = oldDeno;
    globalThis.fetch = oldFetch;
  };
}

const reply = (content: string): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
    })) as typeof fetch;

test("languageTag accepts tags and rejects everything else", () => {
  assert.equal(languageTag(" fa "), "fa");
  assert.equal(languageTag("zh-CN"), "zh-CN");
  assert.equal(languageTag("Persian language"), null);
  assert.equal(languageTag(5), null);
  assert.equal(languageTag(""), null);
});

test("sameLanguage ignores region and case", () => {
  assert.ok(sameLanguage("fa-IR", "FA"));
  assert.ok(!sameLanguage("fa", "es"));
  assert.ok(!sameLanguage(null, "es"));
});

test("translateQuery returns the first line, unquoted", async () => {
  const restore = withEnv({ GROQ_API_KEY: "k" }, reply('"اخبار فوتبال ایران"\nnote'));
  try {
    const out = await translateQuery("iran football news", "fa", new AbortController().signal);
    assert.equal(out, "اخبار فوتبال ایران");
  } finally {
    restore();
  }
});

test("translateQuery gives null without a key, on errors and on a copy", async () => {
  let restore = withEnv({}, reply("x"));
  try {
    assert.equal(await translateQuery("a b", "fa", new AbortController().signal), null);
  } finally {
    restore();
  }

  restore = withEnv({ GROQ_API_KEY: "k" }, (async () => new Response("no", { status: 500 })) as typeof fetch);
  try {
    assert.equal(await translateQuery("a b", "fa", new AbortController().signal), null);
  } finally {
    restore();
  }

  restore = withEnv({ GROQ_API_KEY: "k" }, reply("A B"));
  try {
    assert.equal(await translateQuery("a b", "fa", new AbortController().signal), null);
  } finally {
    restore();
  }

  restore = withEnv({ GROQ_API_KEY: "k" }, (async () => { throw new Error("net"); }) as typeof fetch);
  try {
    assert.equal(await translateQuery("a b", "fa", new AbortController().signal), null);
  } finally {
    restore();
  }
});
