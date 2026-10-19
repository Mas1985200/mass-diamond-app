// tests/attachments/vision.test.ts
// A message with photos goes to a vision model with the photos inside it;
// a message without photos is not affected. The prompt tells the model about
// the photos only when there are some.

import test from "node:test";
import assert from "node:assert/strict";

import { startAgent } from "../../supabase/functions/ai-chat/agent.ts";
import { hasPhotos } from "../../supabase/functions/ai-chat/providers/router.ts";
import { buildSystemPrompt } from "../../supabase/functions/ai-chat/prompt/system.ts";
import type {
  AIMessage,
  OAIMessage,
  ToolContext,
} from "../../supabase/functions/ai-chat/types.ts";

const PHOTO = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64")}`;

const context: ToolContext = {
  now: new Date("2026-10-19T10:00:00Z"),
  timeZone: "UTC",
  location: null,
  lang: "en",
  tavilyKey: undefined,
  memory: null,
};

type Sent = { model: string; messages: OAIMessage[] };

// Runs one start of the agent against a fake model endpoint.
async function sentToModel(messages: AIMessage[]): Promise<Sent> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  let sent: Sent | null = null;

  globals.Deno = {
    env: { get: (name: string) => (name === "GROQ_API_KEY" ? "test-key" : undefined) },
  };

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as Sent;

    return new Response("data: [DONE]\n\n", { status: 200 });
  }) as typeof fetch;

  try {
    const started = await startAgent(messages, context, new AbortController().signal, null);

    assert.equal(started.success, true);
    assert.ok(sent);

    return sent;
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
  }
}

test("hasPhotos: finds photos only in user messages that carry them", () => {
  assert.equal(hasPhotos([{ role: "user", content: "hi" }]), false);
  assert.equal(
    hasPhotos([
      {
        role: "user",
        content: [
          { type: "text", text: "what is it?" },
          { type: "image_url", image_url: { url: PHOTO } },
        ],
      },
    ]),
    true,
  );
});

test("a message with a photo is sent to the vision model with the photo inside", async () => {
  const sent = await sentToModel([
    { role: "system", content: "rules" },
    { role: "user", content: "what is this?", images: [PHOTO] },
  ]);
  const last = sent.messages[sent.messages.length - 1];

  assert.equal(sent.model, "qwen/qwen3.8-27b");
  assert.equal(last?.role, "user");
  assert.deepEqual(last?.content, [
    { type: "text", text: "what is this?" },
    { type: "image_url", image_url: { url: PHOTO } },
  ]);
});

test("a message without a photo keeps its text model and plain text", async () => {
  const sent = await sentToModel([
    { role: "system", content: "rules" },
    { role: "user", content: "hello" },
  ]);

  assert.notEqual(sent.model, "qwen/qwen3.8-27b");
  assert.equal(sent.messages[sent.messages.length - 1]?.content, "hello");
});

test("the prompt mentions photos only when some were attached", () => {
  const without = buildSystemPrompt(context);
  const one = buildSystemPrompt(context, undefined, null, 1);
  const two = buildSystemPrompt(context, undefined, null, 2);

  assert.ok(!without.includes("Photos from the user"));
  assert.ok(one.includes("attached 1 photo to the latest message"));
  assert.ok(two.includes("attached 2 photos to the latest message"));
  assert.ok(two.includes("Never identify a real person"));
});
