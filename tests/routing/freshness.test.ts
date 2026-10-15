// tests/routing/freshness.test.ts
// The router that decides whether a question needs live information.
// The model call is replaced by a fake, so nothing real is called.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouterMessages,
  needsFreshInfo,
  parseFreshness,
} from "../../supabase/functions/ai-chat/routing/freshness.ts";
import type { AIMessage } from "../../supabase/functions/ai-chat/types.ts";

const signal = new AbortController().signal;

const chat: AIMessage[] = [
  { role: "user", content: "اخبار امروز چیه؟" },
  { role: "assistant", content: "خلاصه‌ی خبرها ..." },
  { role: "user", content: "دیگه" },
];

test("parseFreshness: reads one word answers and rejects the rest", () => {
  assert.equal(parseFreshness("FRESH"), true);
  assert.equal(parseFreshness("  fresh\n"), true);
  assert.equal(parseFreshness("NO"), false);
  assert.equal(parseFreshness("no."), false);
  assert.equal(parseFreshness("maybe"), null);
  assert.equal(parseFreshness(""), null);
});

test("buildRouterMessages: keeps the last three messages, cut short", () => {
  const long: AIMessage[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: "a".repeat(1000) },
    { role: "user", content: "b" },
    { role: "assistant", content: "c" },
    { role: "user", content: "last question" },
  ];
  const built = buildRouterMessages(long);

  assert.equal(built.length, 2);

  const text = String(built[1]?.content);

  assert.ok(!text.includes("old"));
  assert.ok(text.includes("last question"));
  assert.ok(text.includes("Assistant: c"));
  assert.ok(!text.includes("a".repeat(401)));
});

test("needsFreshInfo: follows the model's decision", async () => {
  assert.equal(await needsFreshInfo(chat, signal, async () => "FRESH"), true);
  assert.equal(await needsFreshInfo(chat, signal, async () => "NO"), false);
});

test("needsFreshInfo: the follow-up is sent together with its topic", async () => {
  let seen = "";

  await needsFreshInfo(chat, signal, async (messages) => {
    seen = String(messages[1]?.content);

    return "FRESH";
  });

  assert.ok(seen.includes("اخبار امروز"));
  assert.ok(seen.includes("دیگه"));
});

test("needsFreshInfo: failure, garbage, and no messages give null", async () => {
  assert.equal(await needsFreshInfo(chat, signal, async () => null), null);
  assert.equal(await needsFreshInfo(chat, signal, async () => "???"), null);
  assert.equal(
    await needsFreshInfo(chat, signal, async () => {
      throw new Error("boom");
    }),
    null,
  );
  assert.equal(await needsFreshInfo([], signal, async () => "FRESH"), null);
});

test("needsFreshInfo: a hanging model is cut off by the timeout", async () => {
  const started = Date.now();

  const result = await needsFreshInfo(
    chat,
    signal,
    (_messages, stop) =>
      new Promise<string | null>((_resolve, reject) => {
        stop.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );

  assert.equal(result, null);
  assert.ok(Date.now() - started < 6_000);
});

test("needsFreshInfo: an already aborted request gives null quickly", async () => {
  const controller = new AbortController();

  controller.abort();

  const result = await needsFreshInfo(
    chat,
    controller.signal,
    (_messages, stop) =>
      new Promise<string | null>((_resolve, reject) => {
        if (stop.aborted) {
          reject(new Error("aborted"));
        }
      }),
  );

  assert.equal(result, null);
});
