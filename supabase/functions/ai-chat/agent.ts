// supabase/functions/ai-chat/agent.ts
// The agent loop: stream a model turn, run tools, stream the final answer.
// An empty model answer is treated like a failure and retried on another model.

import {
  MAX_CARDS,
  MAX_TOOL_ROUNDS,
  TOOL_RESULT_CHAR_CAP,
} from "./config.ts";
import type {
  AIMessage,
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

    convo.push({
      role: "assistant",
      content: turn.text ? turn.text : null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      })),
    });

    const outcomes: ToolOutcome[] = await Promise.all(
      turn.toolCalls.map((call) =>
        executeTool(call.name, call.arguments, params.ctx, params.signal),
      ),
    );

    for (let index = 0; index < turn.toolCalls.length; index += 1) {
      const call = turn.toolCalls[index];
      const outcome = outcomes[index];

      if (!call || !outcome) {
        continue;
      }

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.data).slice(0, TOOL_RESULT_CHAR_CAP),
      });

      for (const card of outcome.cards ?? []) {
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

    if (outcomes.every((outcome) => outcome.finalText !== undefined)) {
      for (const outcome of outcomes) {
        if (outcome.finalText) {
          yield `${outcome.finalText}\n\n`;
        }

        for (const card of outcome.cards ?? []) {
          const marker = encodeCard(card);

          if (!emitted.has(marker)) {
            emitted.add(marker);
            yield `${marker}\n\n`;
          }
        }
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
    roundOptions(0, true, tools),
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
