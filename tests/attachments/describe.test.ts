// tests/attachments/describe.test.ts
// Photos are looked at once by the vision model in a small request of their
// own; the rest of the chat works on the text it returns.

import test from "node:test";
import assert from "node:assert/strict";

import {
  describePhotos,
  stripThinking,
  withPhotoDescription,
} from "../../supabase/functions/ai-chat/attachments/describe.ts";
import { markCooldown } from "../../supabase/functions/ai-chat/providers/cooldown.ts";
import {
  buildSystemPrompt,
  photoRules,
} from "../../supabase/functions/ai-chat/prompt/system.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const VISION_MODEL = "qwen/qwen3.8-27b";
const PHOTO = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64")}`;

const context: ToolContext = {
  now: new Date("2026-10-19T10:00:00Z"),
  timeZone: "UTC",
  location: null,
  lang: "en",
  tavilyKey: undefined,
  memory: null,
};

type Call = { url: string; body: Record<string, unknown> };

// Runs `run` against a fake model service; returns what it sent.
async function withService<T>(
  options: { key?: string | undefined; respond: (call: Call) => Response },
  run: () => Promise<T>,
): Promise<{ result: T; calls: Call[] }> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: Call[] = [];

  // A refusal from the service is logged on purpose; keep the test output clean.
  console.error = () => undefined;
  markCooldown(VISION_MODEL, 0);

  globals.Deno = {
    env: {
      get: (name: string) =>
        name === "GROQ_API_KEY" ? options.key : undefined,
    },
  };

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };

    calls.push(call);

    return options.respond(call);
  }) as typeof fetch;

  try {
    return { result: await run(), calls };
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

function answer(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200 },
  );
}

const signal = () => new AbortController().signal;

test("describePhotos: a small request with the question and every photo, no tools", async () => {
  const { result, calls } = await withService(
    {
      key: "test-key",
      respond: () => answer("Photo 1: a glass bottle with orange liquid."),
    },
    () => describePhotos([PHOTO, PHOTO], "What is this?", signal()),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.text, "Photo 1: a glass bottle with orange liquid.");
    assert.equal(result.model, VISION_MODEL);
  }

  assert.equal(calls.length, 1);

  const body = calls[0]?.body ?? {};
  const messages = body.messages as Array<{ role: string; content: unknown }>;

  assert.equal(body.model, VISION_MODEL);
  assert.equal(body.stream, false);
  assert.equal(body.tools, undefined);
  assert.equal(messages[0]?.role, "system");
  // The whole point: the instruction stays short so the photos fit the limit.
  assert.ok(String(messages[0]?.content).length < 2_500);

  const parts = messages[1]?.content as Array<{ type: string; text?: string }>;

  assert.ok(Array.isArray(parts));
  assert.ok(parts[0]?.text?.includes("What is this?"));
  assert.equal(parts.filter((part) => part.type === "image_url").length, 2);
});

test("describePhotos: a photo without words is asked about with the default question", async () => {
  const { calls } = await withService(
    { key: "test-key", respond: () => answer("Photo 1: a cat.") },
    () => describePhotos([PHOTO], "   ", signal()),
  );

  const messages = calls[0]?.body.messages as Array<{ content: unknown }>;
  const parts = messages[1]?.content as Array<{ text?: string }>;

  assert.ok(parts[0]?.text?.includes("What is in this photo?"));
});

test("describePhotos: thinking text is removed from the description", async () => {
  const { result } = await withService(
    {
      key: "test-key",
      respond: () => answer("<think>let me look</think>\nPhoto 1: a red car."),
    },
    () => describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.text, "Photo 1: a red car.");
  }
});

test("describePhotos: an empty answer is a failure that can be retried", async () => {
  const { result } = await withService(
    { key: "test-key", respond: () => answer("<think>hmm</think>") },
    () => describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.equal(result.retryable, true);
  }
});

test("describePhotos: a request that is too large asks for fewer photos and is not retried", async () => {
  const { result } = await withService(
    {
      key: "test-key",
      respond: () => new Response('{"error":{"message":"too large"}}', { status: 413 }),
    },
    () => describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.equal(result.retryable, false);
    assert.ok(result.error.includes("fewer photos"));
  }
});

test("describePhotos: a rate limit says how long to wait and the model rests", async () => {
  const limited = () =>
    new Response("{}", { status: 429, headers: { "retry-after": "7" } });

  const first = await withService({ key: "test-key", respond: limited }, () =>
    describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(first.result.ok, false);

  if (!first.result.ok) {
    assert.equal(first.result.retryable, true);
    assert.ok(first.result.error.includes("7 seconds"));
  }

  // Straight after, the model is still resting: no request is sent at all.
  const globals = globalThis as unknown as { Deno?: unknown };
  const originalDeno = globals.Deno;
  const originalFetch = globalThis.fetch;
  let sent = 0;

  globals.Deno = { env: { get: (name: string) => (name === "GROQ_API_KEY" ? "test-key" : undefined) } };
  globalThis.fetch = (async () => {
    sent += 1;

    return answer("never");
  }) as typeof fetch;

  try {
    const second = await describePhotos([PHOTO], "what?", signal());

    assert.equal(second.ok, false);
    assert.equal(sent, 0);

    if (!second.ok) {
      assert.ok(second.error.includes("busy"));
    }
  } finally {
    globals.Deno = originalDeno;
    globalThis.fetch = originalFetch;
    markCooldown(VISION_MODEL, 0);
  }
});

test("describePhotos: a server error can be retried; a missing key cannot", async () => {
  const broken = await withService(
    { key: "test-key", respond: () => new Response("oops", { status: 500 }) },
    () => describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(broken.result.ok, false);

  if (!broken.result.ok) {
    assert.equal(broken.result.retryable, true);
  }

  const noKey = await withService(
    { key: undefined, respond: () => answer("never") },
    () => describePhotos([PHOTO], "what?", signal()),
  );

  assert.equal(noKey.calls.length, 0);
  assert.equal(noKey.result.ok, false);

  if (!noKey.result.ok) {
    assert.equal(noKey.result.retryable, false);
  }
});

test("stripThinking: removes closed, dangling and unfinished thinking", () => {
  assert.equal(stripThinking("<think>a</think>Hello"), "Hello");
  assert.equal(stripThinking("a long thought</think> Hello"), "Hello");
  assert.equal(stripThinking("Hello <think>never finished"), "Hello");
  assert.equal(stripThinking("Plain text"), "Plain text");
});

test("withPhotoDescription: the user's words come first, then what the photos show", () => {
  const one = withPhotoDescription("What is this?", 1, "Photo 1: a bottle.");

  assert.ok(one.startsWith("What is this?\n\n[Photo description:"));
  assert.ok(one.includes("attached 1 photo."));
  assert.ok(one.endsWith("Photo 1: a bottle."));

  const two = withPhotoDescription("", 2, "Photo 1: a. Photo 2: b.");

  assert.ok(two.startsWith("What is in this photo?"));
  assert.ok(two.includes("attached 2 photos."));
});

test("the prompt: photo rules point to the description; a missing photo is never guessed", () => {
  const rules = photoRules(1).join("\n");

  assert.ok(rules.includes('under "Photo description"'));
  assert.ok(rules.includes("You cannot see it yourself"));

  const withoutPhotos = buildSystemPrompt(context);

  assert.ok(withoutPhotos.includes("never guess what it is"));
  assert.ok(withoutPhotos.includes("attach it with the + button"));
  assert.ok(!withoutPhotos.includes("Photos from the user"));
});
