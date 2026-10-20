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
  PhotoItem,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
} from "./types.ts";
import { encodeCard } from "./cards/codec.ts";
import { buildUserContent } from "./attachments/images.ts";
import { buildToolDefinitions } from "./tools/definitions.ts";
import { executeTool } from "./tools/registry.ts";
import { readTurn } from "./providers/groq.ts";
import { openRound, type OpenSuccess } from "./providers/router.ts";
import type { ToolOptions } from "./providers/types.ts";
import {
  isPlaceQuestion,
  lastUserText,
  selectTools,
  type Capability,
} from "./routing/capability.ts";

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
  // Pictures chosen beside the answer (never rejects). Shown at the end when
  // no tool has already shown pictures.
  readonly illustration: Promise<readonly PhotoItem[]> | null;
};

function toOAIMessage(message: AIMessage): OAIMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content };
  }

  if (message.role === "user") {
    // The newest user message may carry the photos the user attached.
    return {
      role: "user",
      content: buildUserContent(message.content, message.images),
    };
  }

  return { role: "system", content: message.content };
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

// Tools that can answer a question about current information.
const FRESH_TOOL_NAMES: readonly string[] = ["web_search", "get_market_prices"];

// `capability` is the router's decision: it says what kind of question this is
// and `tools` already holds only the tools that kind may use. null = unknown.
export function firstRoundOptions(
  messages: readonly AIMessage[],
  tools: readonly ToolDefinition[],
  capability: Capability | null = null,
): ToolOptions {
  const only = (names: readonly string[]): ToolDefinition[] =>
    tools.filter((tool) => names.includes(tool.function.name));

  if (isPlaceQuestion(lastUserText(messages)) || capability === "place") {
    const placeTools = only(["find_place"]);

    if (placeTools.length > 0) {
      return { tools: placeTools, toolChoice: "required" };
    }
  }

  if (capability === "fresh") {
    const freshTools = only(FRESH_TOOL_NAMES);

    if (freshTools.some((tool) => tool.function.name === "web_search")) {
      return { tools: freshTools, toolChoice: "required" };
    }
  }

  if (capability === "know") {
    const knowledgeTools = only(["lookup_knowledge", "lookup_medical"]);

    if (knowledgeTools.length > 0) {
      return { tools: knowledgeTools, toolChoice: "required" };
    }
  }

  // No tool is needed (for example plain conversation): a single round.
  if (tools.length === 0) {
    return null;
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
  let picturesFromTools = false;

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

    if (
      outcomes.some((outcome) =>
        (outcome.cards ?? []).some((card) => card.t === "photos"),
      )
    ) {
      picturesFromTools = true;
    }

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

  // Answers about a concrete thing end with its pictures, whether or not the
  // model chose to call a tool.
  if (!picturesFromTools && params.illustration && emitted.size < MAX_CARDS) {
    const items = await params.illustration;

    if (items.length > 0) {
      yield `\n\n${encodeCard({ t: "photos", lang: params.ctx.lang, items })}`;
    }
  }
}

export async function startAgent(
  messages: readonly AIMessage[],
  ctx: ToolContext,
  signal: AbortSignal,
  capability: Capability | null = null,
  illustration: Promise<readonly PhotoItem[]> | null = null,
): Promise<AgentStart> {
  const tools = selectTools(buildToolDefinitions(ctx), capability);

  const opened = await openRound(
    messages.map(toOAIMessage),
    firstRoundOptions(messages, tools, capability),
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
    chunks: agentChunks({
      messages,
      tools,
      ctx,
      signal,
      first: opened,
      illustration,
    }),
  };
}
