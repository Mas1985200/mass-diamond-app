// supabase/functions/ai-chat/providers/groq.ts
// One streaming request to Groq, and a reader that turns the stream into a turn.

import {
  GROQ_ENDPOINT,
  MAX_OUTPUT_TOKENS,
  TEMPERATURE,
} from "../config.ts";
import type { OAIMessage } from "../types.ts";
import { describeError, getOptionalEnv, isRecord } from "../lib/util.ts";
import { createAttempt, readSseData } from "../lib/http.ts";
import { parseRetryDelayMs } from "./cooldown.ts";
import type {
  ModelTurn,
  ParsedToolCall,
  RoundResult,
  ToolOptions,
} from "./types.ts";

export async function requestRound(
  apiKey: string,
  model: string,
  messages: readonly OAIMessage[],
  toolOptions: ToolOptions,
  master: AbortSignal,
): Promise<RoundResult> {
  const attempt = createAttempt(master);

  try {
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: TEMPERATURE,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
    };

    if (model.includes("gpt-oss")) {
      payload.reasoning_effort =
        getOptionalEnv("GROQ_REASONING_EFFORT") ?? "low";
    }

    if (toolOptions) {
      payload.tools = toolOptions.tools;
      payload.tool_choice = toolOptions.toolChoice;
    }

    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: attempt.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const headerSeconds = Number(response.headers.get("retry-after"));
      const retryAfterMs =
        Number.isFinite(headerSeconds) && headerSeconds > 0
          ? Math.ceil(headerSeconds * 1_000)
          : parseRetryDelayMs(errorText);

      return {
        ok: false,
        status: response.status,
        error:
          errorText.slice(0, 500) ||
          `Groq request failed with status ${response.status}.`,
        retryAfterMs,
      };
    }

    if (!response.body) {
      return {
        ok: false,
        status: 502,
        error: "Groq returned an empty stream.",
        retryAfterMs: null,
      };
    }

    return { ok: true, body: response.body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: describeError(error),
      retryAfterMs: null,
    };
  } finally {
    attempt.clearConnectTimer();
  }
}

function extractDelta(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first: unknown = choices[0];

  if (!isRecord(first) || !isRecord(first.delta)) {
    return null;
  }

  return first.delta;
}

// Yields text chunks as they arrive and returns the full turn at the end.
export async function* readTurn(
  body: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<string, ModelTurn, void> {
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();

  for await (const data of readSseData(body)) {
    if (data === "[DONE]") {
      break;
    }

    if (!data) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    const delta = extractDelta(parsed);

    if (!delta) {
      continue;
    }

    const content = delta.content;

    if (typeof content === "string" && content) {
      text += content;
      yield content;
    }

    const toolDeltas = delta.tool_calls;

    if (Array.isArray(toolDeltas)) {
      for (const item of toolDeltas) {
        if (!isRecord(item)) {
          continue;
        }

        const index = typeof item.index === "number" ? item.index : 0;
        const fn = isRecord(item.function) ? item.function : {};
        const current = calls.get(index) ?? { id: "", name: "", args: "" };

        if (typeof item.id === "string" && item.id) {
          current.id = item.id;
        }

        if (typeof fn.name === "string" && fn.name && !current.name) {
          current.name = fn.name;
        }

        if (typeof fn.arguments === "string") {
          current.args += fn.arguments;
        }

        calls.set(index, current);
      }
    }
  }

  const toolCalls: ParsedToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.args,
    }))
    .filter((call) => call.name);

  return { text, toolCalls, model };
}
