// supabase/functions/ai-chat/providers/router.ts
// Opens a streaming round on the first model that works. A rate-limited model
// is put on cooldown and skipped immediately; there is no waiting on 429.

import { MAX_QUEUE_WAIT_MS } from "../config.ts";
import type { OAIMessage } from "../types.ts";
import { sleep } from "../lib/util.ts";
import { cooldownLeftMs, markCooldown, soonestReadyMs } from "./cooldown.ts";
import { groqApiKey, groqModels } from "./models.ts";
import { requestRound } from "./groq.ts";
import type { ToolOptions } from "./types.ts";

export type OpenSuccess = {
  readonly ok: true;
  readonly body: ReadableStream<Uint8Array>;
  readonly model: string;
  readonly withTools: boolean;
};

export type OpenFailure = {
  readonly ok: false;
  readonly error: string;
  readonly retryable: boolean;
};

export type OpenResult = OpenSuccess | OpenFailure;

type PassResult =
  | {
      readonly kind: "ok";
      readonly body: ReadableStream<Uint8Array>;
      readonly model: string;
    }
  | {
      readonly kind: "failed";
      readonly error: string;
      readonly retryable: boolean;
      readonly sawBadRequest: boolean;
    };

async function tryModels(
  apiKey: string,
  models: readonly string[],
  messages: readonly OAIMessage[],
  tools: ToolOptions,
  master: AbortSignal,
): Promise<PassResult> {
  let ready = models.filter((model) => cooldownLeftMs(model) === 0);

  if (ready.length === 0) {
    const wait = soonestReadyMs(models);

    if (wait <= MAX_QUEUE_WAIT_MS) {
      await sleep(wait + 100);
      ready = models.filter((model) => cooldownLeftMs(model) === 0);
    }
  }

  if (ready.length === 0) {
    return {
      kind: "failed",
      error: "All AI models are rate limited right now.",
      retryable: true,
      sawBadRequest: false,
    };
  }

  let lastError = "No AI model answered.";
  let sawBadRequest = false;

  for (const model of ready) {
    if (master.aborted) {
      break;
    }

    const round = await requestRound(apiKey, model, messages, tools, master);

    if (round.ok) {
      return { kind: "ok", body: round.body, model };
    }

    console.error(
      `Groq model ${model} failed (status ${round.status}): ${round.error.slice(0, 200)}`,
    );

    lastError = round.error;

    if (round.status === 429) {
      markCooldown(model, round.retryAfterMs);
    } else if (round.status === 400) {
      sawBadRequest = true;
    } else {
      markCooldown(model, 10_000);
    }
  }

  return {
    kind: "failed",
    error: lastError,
    retryable: !sawBadRequest,
    sawBadRequest,
  };
}

export async function openRound(
  messages: readonly OAIMessage[],
  toolOptions: ToolOptions,
  master: AbortSignal,
  exclude: ReadonlySet<string>,
): Promise<OpenResult> {
  const apiKey = groqApiKey();

  if (!apiKey) {
    return {
      ok: false,
      error: "GROQ_API_KEY is not configured.",
      retryable: false,
    };
  }

  const models = groqModels().filter((model) => !exclude.has(model));

  if (models.length === 0) {
    return {
      ok: false,
      error: "No AI model is left to try.",
      retryable: true,
    };
  }

  let tools = toolOptions;

  while (true) {
    const result = await tryModels(apiKey, models, messages, tools, master);

    if (result.kind === "ok") {
      return {
        ok: true,
        body: result.body,
        model: result.model,
        withTools: tools !== null,
      };
    }

    // A 400 with tools usually means the model rejected the tool format:
    // retry once without tools before giving up.
    if (result.sawBadRequest && tools !== null) {
      tools = null;
      continue;
    }

    return {
      ok: false,
      error: result.error.slice(0, 300),
      retryable: result.retryable,
    };
  }
}
