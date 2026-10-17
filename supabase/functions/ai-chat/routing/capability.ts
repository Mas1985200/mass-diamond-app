// supabase/functions/ai-chat/routing/capability.ts
// Decides, before the main answer, what KIND of question the user asked, so the
// main model receives only the prompt rules and tool schemas it needs. A lean
// request leaves the model's token budget for thinking instead of for unused
// instructions, which is what raises the quality of its reasoning.
//
// The decision is made by a small model, so it works in every language and on
// every topic. If anything goes wrong the result is null and the full prompt
// and every tool are used (the old behaviour).

import { readTurn, requestRound } from "../providers/groq.ts";
import { cooldownLeftMs, markCooldown } from "../providers/cooldown.ts";
import { groqApiKey, groqModels } from "../providers/models.ts";
import type { AIMessage, OAIMessage, ToolDefinition } from "../types.ts";

export type Capability = "chat" | "know" | "fresh" | "place" | "time";

export const ROUTER_TIMEOUT_MS = 3_500;
const CONTEXT_MESSAGES = 3;
const CONTEXT_CHARS = 400;

// The only tools each kind of question may use. Single source of truth for
// both the tool list and the prompt rules, so they can never disagree.
export const TOOLS_BY_CAPABILITY: Record<Capability, readonly string[]> = {
  chat: ["remember"],
  know: ["lookup_knowledge", "lookup_medical"],
  fresh: ["web_search", "get_market_prices"],
  place: ["find_place"],
  time: ["get_datetime"],
};

// null = unknown: everything is offered.
export function offersTool(
  capability: Capability | null,
  toolName: string,
): boolean {
  return capability === null || TOOLS_BY_CAPABILITY[capability].includes(toolName);
}

export function selectTools(
  tools: readonly ToolDefinition[],
  capability: Capability | null,
): ToolDefinition[] {
  return tools.filter((tool) => offersTool(capability, tool.function.name));
}

// Short "where is X" style questions must always use the map tool.
// Covers formal and colloquial spellings: کجاست، کجاس، کجایه، کجایت، کجاش، کجا هست.
const PLACE_QUESTION_PATTERN =
  /(کجاست|کجاس|کجایه|کجایت|کجاش|کجا\s?است|کجا\s?هست|لوکیشن|آدرس|where\s+is|where's)/i;

// Every line must be short, so a long paragraph is never mistaken for a place
// question. Several short lines (one place per line) are allowed together.
const PLACE_QUESTION_MAX_LINE_LENGTH = 200;
const PLACE_QUESTION_MAX_TOTAL_LENGTH = 1_000;

export function lastUserText(messages: readonly AIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message && message.role === "user") {
      return message.content;
    }
  }

  return "";
}

export function isPlaceQuestion(text: string): boolean {
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

const INSTRUCTION = [
  "You are a router. Pick the ONE label that best fits the LAST user message. Use the earlier messages only to understand short follow-ups.",
  "FRESH: needs up-to-date internet information or live data: news and current events, who currently holds an office or role, prices, exchange rates, gold, crypto, stocks, weather, sports results or schedules, product or software releases, laws or rules now in force, rankings, anything that may have changed after 2025.",
  "PLACE: asks where a specific place, business or address is, or for places near the user.",
  "TIME: asks for today's date, the weekday, the current time, or the time in another place.",
  "KNOW: a factual, educational or scientific question whose answer does not change over time and where accuracy matters: science, medicine and health facts, space, history, geography, how a technology or concept works, cooking and food science, culture, people, definitions; also requests for research, studies or sources.",
  "CHAT: everything else: chit-chat, greetings, advice, opinions, jokes, stories, writing, editing, translation, math, programming, planning, brainstorming, business or real estate help, asking to remember something.",
  "A short follow-up ('more', 'and what else', 'دیگه', 'و چی؟') keeps the label of the topic it continues.",
  "Reply with exactly one word: FRESH, PLACE, TIME, KNOW or CHAT.",
].join("\n");

export type CapabilityAsk = (
  messages: readonly OAIMessage[],
  signal: AbortSignal,
) => Promise<string | null>;

export function buildRouterMessages(
  messages: readonly AIMessage[],
): OAIMessage[] {
  const recent = messages
    .filter((message) => message.role !== "system")
    .slice(-CONTEXT_MESSAGES);

  const transcript = recent
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, CONTEXT_CHARS)}`,
    )
    .join("\n");

  return [
    { role: "system", content: INSTRUCTION },
    {
      role: "user",
      content: `${transcript}\n\nLabel (FRESH, PLACE, TIME, KNOW or CHAT):`,
    },
  ];
}

export function parseCapability(text: string): Capability | null {
  const match = /\b(FRESH|PLACE|TIME|KNOW|CHAT)\b/i.exec(text);

  switch (match?.[1]?.toUpperCase()) {
    case "FRESH":
      return "fresh";
    case "PLACE":
      return "place";
    case "TIME":
      return "time";
    case "KNOW":
      return "know";
    case "CHAT":
      return "chat";
    default:
      return null;
  }
}

// The smallest configured model is tried first: this call must be fast.
async function askGroq(
  messages: readonly OAIMessage[],
  signal: AbortSignal,
): Promise<string | null> {
  const apiKey = groqApiKey();

  if (!apiKey) {
    return null;
  }

  const model = [...groqModels()]
    .reverse()
    .find((candidate) => cooldownLeftMs(candidate) === 0);

  if (!model) {
    return null;
  }

  const round = await requestRound(apiKey, model, messages, null, signal);

  if (!round.ok) {
    if (round.status === 429) {
      markCooldown(model, round.retryAfterMs);
    }

    return null;
  }

  const reader = readTurn(round.body, model);
  let step = await reader.next();

  while (!step.done) {
    step = await reader.next();
  }

  return step.value.text;
}

export async function routeCapability(
  messages: readonly AIMessage[],
  master: AbortSignal,
  ask: CapabilityAsk = askGroq,
): Promise<Capability | null> {
  if (messages.length === 0) {
    return null;
  }

  // The map tool is always forced for these; no model call is needed.
  if (isPlaceQuestion(lastUserText(messages))) {
    return "place";
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, ROUTER_TIMEOUT_MS);

  if (master.aborted) {
    controller.abort();
  } else {
    master.addEventListener("abort", stop, { once: true });
  }

  const started = Date.now();

  try {
    const text = await ask(buildRouterMessages(messages), controller.signal);
    const decision = text === null ? null : parseCapability(text);

    console.log(
      JSON.stringify({
        event: "capability",
        decision,
        ms: Date.now() - started,
      }),
    );

    return decision;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    master.removeEventListener("abort", stop);
  }
}
