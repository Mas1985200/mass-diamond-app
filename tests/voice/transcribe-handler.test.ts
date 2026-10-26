// tests/voice/transcribe-handler.test.ts
// The whole `transcribe` function, called like the platform calls it, with the
// network replaced by a fake (the sign-in check and the speech service). It
// proves the wiring: sign-in is required, a recording becomes text, the same
// recording sent twice is worked on once and uses the allowance once, a user
// who sends too many gets a clear refusal, a recording that is too big is
// refused, and a failed answer is not kept so that asking again really asks.

import test from "node:test";
import assert from "node:assert/strict";

const SETTINGS: Record<string, string> = {
  SUPABASE_URL: "https://fake.supabase.test",
  SUPABASE_ANON_KEY: "anon",
  GROQ_API_KEY: "groq",
  GROQ_STT_FIX_MODEL: "off",
  TRANSCRIBE_MAX_PER_MINUTE: "2",
};

type Handler = (request: Request) => Promise<Response>;

let handler: Handler | null = null;

const globals = globalThis as unknown as { Deno?: unknown };

globals.Deno = {
  env: { get: (name: string): string | undefined => SETTINGS[name] },
  serve: (served: Handler): void => {
    handler = served;
  },
};

// The speech service: how it answers, and how many times it was asked.
let speechMode: "ok" | "down" = "ok";
let speechCalls = 0;

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;

globalThis.fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = String(input);

  if (url.includes("/auth/v1/user")) {
    const header = new Headers(init?.headers).get("Authorization") ?? "";
    const user = header.replace(/^Bearer\s+/i, "");

    return Response.json({ id: user });
  }

  if (url.includes("/audio/transcriptions")) {
    speechCalls += 1;

    if (speechMode === "down") {
      return new Response("unavailable", { status: 500 });
    }

    return Response.json({
      text: "سلام دنیا",
      language: "persian",
      segments: [
        {
          text: "سلام دنیا",
          no_speech_prob: 0.01,
          avg_logprob: -0.2,
          compression_ratio: 1.1,
        },
      ],
    });
  }

  throw new Error(`unexpected request to ${url}`);
}) as typeof fetch;

console.log = (): void => undefined;
console.error = (): void => undefined;

await import("../../supabase/functions/transcribe/index.ts");

test.after(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
});

interface Sent {
  readonly user?: string;
  readonly requestId?: string;
  readonly bytes?: number;
}

async function send(options: Sent): Promise<{
  readonly status: number;
  readonly retryAfter: string | null;
  readonly body: Record<string, unknown>;
}> {
  assert.ok(handler, "the function did not register itself");

  const form = new FormData();

  form.append(
    "audio",
    new File([new Uint8Array(options.bytes ?? 4_000)], "recording", {
      type: "audio/webm",
    }),
  );
  form.append("language", "fa");

  if (options.requestId) {
    form.append("request_id", options.requestId);
  }

  const headers: Record<string, string> = {};

  if (options.user) {
    headers.Authorization = `Bearer ${options.user}`;
  }

  const response = await handler(
    new Request("https://fake.supabase.test/functions/v1/transcribe", {
      method: "POST",
      headers,
      body: form,
    }),
  );

  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    body: (await response.json()) as Record<string, unknown>,
  };
}

function errorCode(body: Record<string, unknown>): unknown {
  return (body.error as { code?: unknown } | undefined)?.code;
}

test("without sign-in nothing is done", async () => {
  const before = speechCalls;
  const answer = await send({});

  assert.equal(answer.status, 401);
  assert.equal(errorCode(answer.body), "AUTH_REQUIRED");
  assert.equal(speechCalls, before);
});

test("a recording becomes text", async () => {
  const answer = await send({ user: "user-ok" });

  assert.equal(answer.status, 200);
  assert.equal(answer.body.success, true);
  assert.equal(answer.body.text, "سلام دنیا");
});

test("a recording over the size limit is refused before any work", async () => {
  const before = speechCalls;
  const answer = await send({ user: "user-big", bytes: 2 * 1024 * 1024 + 1 });

  assert.equal(answer.status, 413);
  assert.equal(errorCode(answer.body), "AUDIO_TOO_LARGE");
  assert.equal(speechCalls, before);
});

test("the same recording sent again is worked on once and counted once", async () => {
  const before = speechCalls;
  const id = "recording-0001";

  const first = await send({ user: "user-replay", requestId: id });
  const second = await send({ user: "user-replay", requestId: id });
  const third = await send({ user: "user-replay", requestId: id });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(second.body.text, first.body.text);
  assert.equal(speechCalls - before, 1);

  // The limit is 2 per minute: the three sends above used only one of them.
  const another = await send({ user: "user-replay", requestId: "recording-0002" });
  const tooMany = await send({ user: "user-replay", requestId: "recording-0003" });

  assert.equal(another.status, 200);
  assert.equal(tooMany.status, 429);
});

test("too many requests get a clear refusal with a time to wait", async () => {
  await send({ user: "user-many", requestId: "many-00000001" });
  await send({ user: "user-many", requestId: "many-00000002" });

  const refused = await send({ user: "user-many", requestId: "many-00000003" });

  assert.equal(refused.status, 429);
  assert.equal(errorCode(refused.body), "RATE_LIMITED");
  assert.ok(Number(refused.retryAfter) >= 1);
});

test("one user's limit never blocks another user", async () => {
  const answer = await send({ user: "user-other", requestId: "other-0000001" });

  assert.equal(answer.status, 200);
});

test("a failed answer is not kept, so asking again really asks", async () => {
  const id = "failing-00001";

  speechMode = "down";

  const failed = await send({ user: "user-fail", requestId: id });

  assert.equal(failed.status, 502);
  assert.equal(errorCode(failed.body), "PROVIDER_ERROR");

  speechMode = "ok";

  const again = await send({ user: "user-fail", requestId: id });

  assert.equal(again.status, 200);
  assert.equal(again.body.text, "سلام دنیا");
});

test("an odd request id is ignored, not trusted", async () => {
  const before = speechCalls;

  await send({ user: "user-odd", requestId: "x" });
  await send({ user: "user-odd", requestId: "x" });

  // Too short to be an id, so both are worked on (and counted).
  assert.equal(speechCalls - before, 2);
});
