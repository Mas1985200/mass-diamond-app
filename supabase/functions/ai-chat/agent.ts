// supabase/functions/ai-chat/agent.ts
// The agent loop: stream a model turn, run tools, stream the final answer.
// An empty model answer is treated like a failure and retried on another model.

import {
  MAX_CARDS,
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_ROUNDS,
  TOOL_RESULT_CHAR_CAP,
} from "./config.ts";
import type {
  AIMessage,
  CardPayload,
  OAIMessage,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
} from "./types.ts";
import { encodeCard } from "./cards/codec.ts";
import { buildToolDefinitions } from "./tools/definitions.ts";
import { executeTool } from "./tools/registry.ts";
import { readTurn } from "./providers/groq.ts";
import { openRound, type OpenSuccess } from "./providers/router.ts";
import type { ToolOptions } from "./providers/types.ts";

// Short "where is X" style questions must always use the map tool.
// Covers formal and colloquial spellings: کجاست، کجاس، کجایه، کجایت، کجاش، کجا هست.
const PLACE_QUESTION_PATTERN =
  /(کجاست|کجاس|کجایه|کجایت|کجاش|کجا\s?است|کجا\s?هست|لوکیشن|آدرس|where\s+is|where's)/i;

// Every line must be short, so a long paragraph is never mistaken for a place
// question. Several short lines (one place per line) are allowed together.
const PLACE_QUESTION_MAX_LINE_LENGTH = 200;
const PLACE_QUESTION_MAX_TOTAL_LENGTH = 1_000;

export type AgentStart =
  | {
      readonly success: true;
      readonly provider: "groq";
      readonly model: string;
      readonly chunks: AsyncGenerator<string, void, void>;
    }
  | {
      readonly success: false;
      readonly error: string;
      readonly retryable: boolean;
    };

type AgentParams = {
  readonly messages: readonly AIMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly ctx: ToolContext;
  readonly signal: AbortSignal;
  readonly first: OpenSuccess;
};

function toOAIMessage(message: AIMessage): OAIMessage {
  return message.role === "assistant"
    ? { role: "assistant", content: message.content }
    : { role: message.role, content: message.content };
}

// Only the first round may call tools; the next round must write the answer.
function roundOptions(
  round: number,
  withTools: boolean,
  tools: readonly ToolDefinition[],
): ToolOptions {
  if (!withTools) {
    return null;
  }

  return {
    tools,
    toolChoice: round + 1 >= MAX_TOOL_ROUNDS ? "none" : "auto",
  };
}

function lastUserText(messages: readonly AIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message && message.role === "user") {
      return message.content;
    }
  }

  return "";
}

function isPlaceQuestion(text: string): boolean {
  if (text.length > PLACE_QUESTION_MAX_TOTAL_LENGTH) {
    return false;
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return (
    lines.length > 0 &&
    lines.every((line) => line.length <= PLACE_QUESTION_MAX_LINE_LENGTH) &&
    PLACE_QUESTION_PATTERN.test(text)
  );
}

function firstRoundOptions(
  messages: readonly AIMessage[],
  tools: readonly ToolDefinition[],
): ToolOptions {
  if (isPlaceQuestion(lastUserText(messages))) {
    const placeTools = tools.filter(
      (tool) => tool.function.name === "find_place",
    );

    if (placeTools.length > 0) {
      return { tools: placeTools, toolChoice: "required" };
    }
  }

  return roundOptions(0, true, tools);
}

// When one message asks about several places, photo galleries are left out so
// the screen is not flooded; a single place keeps its photos.
function visibleCards(
  outcome: ToolOutcome,
  multiple: boolean,
): readonly CardPayload[] {
  return (outcome.cards ?? []).filter(
    (card) => !(multiple && card.t === "photos"),
  );
}

function tooManyNote(ctx: ToolContext): string {
  return ctx.lang === "fa"
    ? `فقط ${MAX_TOOL_CALLS_PER_ROUND.toLocaleString("fa-IR")} مورد اول را جواب دادم؛ بقیه را در پیام بعدی بپرس.`
    : `I answered the first ${MAX_TOOL_CALLS_PER_ROUND} items; ask about the rest in your next message.`;
}

async function* agentChunks(
  params: AgentParams,
): AsyncGenerator<string, void, void> {
  const convo: OAIMessage[] = params.messages.map(toOAIMessage);
  const emitted = new Set<string>();
  const deferred: string[] = [];
  const failed = new Set<string>();
  let current: OpenSuccess = params.first;

  for (let round = 0; ; round += 1) {
    const turn = yield* readTurn(current.body, current.model);

    const wantsTools =
      current.withTools &&
      round + 1 < MAX_TOOL_ROUNDS &&
      turn.toolCalls.length > 0;

    if (!wantsTools && turn.text.trim().length === 0) {
      console.error(
        `model ${current.model} returned an empty answer; trying another model`,
      );

      failed.add(current.model);

      const next = await openRound(
        convo,
        roundOptions(round, current.withTools, params.tools),
        params.signal,
        failed,
      );

      if (!next.ok) {
        throw new Error("The AI provider returned an empty response.");
      }

      current = next;
      round -= 1;
      continue;
    }

    if (!wantsTools) {
      break;
    }

    if (turn.text.trim()) {
      yield "\n\n";
    }

    // Several places can be asked in one message: run up to the limit.
    const calls = turn.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND);
    const droppedCalls = turn.toolCalls.length - calls.length;

    convo.push({
      role: "assistant",
      content: turn.text ? turn.text : null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      })),
    });

    // Identical calls run once and share the result.
    const running = new Map<string, Promise<ToolOutcome>>();

    const outcomes: ToolOutcome[] = await Promise.all(
      calls.map((call) => {
        const key = `${call.name}\u0000${call.arguments}`;
        let pending = running.get(key);

        if (!pending) {
          pending = executeTool(
            call.name,
            call.arguments,
            params.ctx,
            params.signal,
          );
          running.set(key, pending);
        }

        return pending;
      }),
    );

    const allFinal = outcomes.every((outcome) => outcome.finalText !== undefined);
    const multiple = new Set(outcomes).size > 1;

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const outcome = outcomes[index];

      if (!call || !outcome) {
        continue;
      }

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.data).slice(0, TOOL_RESULT_CHAR_CAP),
      });

      if (allFinal) {
        // Cards and texts are written together, place by place, below.
        continue;
      }

      for (const card of visibleCards(outcome, multiple)) {
        const marker = encodeCard(card);

        if (outcome.cardFirst) {
          if (!emitted.has(marker) && emitted.size < MAX_CARDS) {
            emitted.add(marker);
            yield `${marker}\n\n`;
          }
        } else if (
          !emitted.has(marker) &&
          !deferred.includes(marker) &&
          emitted.size + deferred.length < MAX_CARDS
        ) {
          deferred.push(marker);
        }
      }
    }

    if (allFinal) {
      const writtenTexts = new Set<string>();
      const seenOutcomes = new Set<ToolOutcome>();

      for (const outcome of outcomes) {
        if (seenOutcomes.has(outcome)) {
          continue;
        }

        seenOutcomes.add(outcome);

        const markers: string[] = [];

        for (const card of visibleCards(outcome, multiple)) {
          const marker = encodeCard(card);

          if (!emitted.has(marker) && emitted.size < MAX_CARDS) {
            emitted.add(marker);
            markers.push(marker);
          }
        }

        const text = (outcome.finalText ?? "").trim();
        const isNewText = text.length > 0 && !writtenTexts.has(text);

        if (isNewText) {
          writtenTexts.add(text);
        }

        if (outcome.cardFirst) {
          for (const marker of markers) {
            yield `${marker}\n\n`;
          }

          if (isNewText) {
            yield `${text}\n\n`;
          }
        } else {
          if (isNewText) {
            yield `${text}\n\n`;
          }

          for (const marker of markers) {
            yield `${marker}\n\n`;
          }
        }
      }

      if (droppedCalls > 0) {
        yield `${tooManyNote(params.ctx)}\n\n`;
      }

      return;
    }

    const next = await openRound(
      convo,
      roundOptions(round + 1, current.withTools, params.tools),
      params.signal,
      failed,
    );

    if (!next.ok) {
      throw new Error(next.error);
    }

    current = next;
  }

  for (const marker of deferred) {
    if (!emitted.has(marker)) {
      emitted.add(marker);
      yield `\n\n${marker}`;
    }
  }
}

export async function startAgent(
  messages: readonly AIMessage[],
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<AgentStart> {
  const tools = buildToolDefinitions(ctx);

  const opened = await openRound(
    messages.map(toOAIMessage),
    firstRoundOptions(messages, tools),
    signal,
    new Set<string>(),
  );

  if (!opened.ok) {
    return {
      success: false,
      error: opened.error,
      retryable: opened.retryable,
    };
  }

  return {
    success: true,
    provider: "groq",
    model: opened.model,
    chunks: agentChunks({ messages, tools, ctx, signal, first: opened }),
  };
}
