// supabase/functions/ai-chat/routing/freshness.ts
// Decides, before the main answer, whether the user's last message needs
// up-to-date information from the internet (news, current office holders,
// prices, weather, sports, releases, laws, rankings ...). It also covers short
// follow-ups such as "more" or "دیگه". The decision is made by a small model,
// so it works in every language and on every topic. If anything goes wrong the
// result is null and the normal behaviour is kept.

import { readTurn, requestRound } from "../providers/groq.ts";
import { cooldownLeftMs, markCooldown } from "../providers/cooldown.ts";
import { groqApiKey, groqModels } from "../providers/models.ts";
import type { AIMessage, OAIMessage } from "../types.ts";

export const FRESHNESS_TIMEOUT_MS = 3_500;
const CONTEXT_MESSAGES = 3;
const CONTEXT_CHARS = 400;

const INSTRUCTION = [
  "You are a router. Decide whether answering the LAST user message needs up-to-date information from the internet.",
  "Answer FRESH when it is about: news or current events, who currently holds an office or role, prices or market values, weather, sports results or schedules, product or software releases, laws or rules now in force, rankings, or anything that may have changed after 2025.",
  "A short follow-up ('more', 'and what else', 'دیگه', 'و چی؟') to a FRESH topic is FRESH too.",
  "Answer NO for: chit-chat, writing or editing, translation, math, programming, timeless knowledge or explanations, the current date or time, where a place is, and asking to remember something.",
  "Reply with exactly one word: FRESH or NO.",
].join("\n");

export type FreshnessAsk = (
  messages: readonly OAIMessage[],
  signal: AbortSignal,
) => Promise<string | null>;

export function buildRouterMessages(
  messages: readonly AIMessage[],
): OAIMessage[] {
  const recent = messages.slice(-CONTEXT_MESSAGES);

  const transcript = recent
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, CONTEXT_CHARS)}`,
    )
    .join("\n");

  return [
    { role: "system", content: INSTRUCTION },
    { role: "user", content: `${transcript}\n\nAnswer (FRESH or NO):` },
  ];
}

export function parseFreshness(text: string): boolean | null {
  const answer = text.trim().toUpperCase();

  if (/\bFRESH\b/.test(answer)) {
    return true;
  }

  if (/^NO\b/.test(answer)) {
    return false;
  }

  return null;
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

export async function needsFreshInfo(
  messages: readonly AIMessage[],
  master: AbortSignal,
  ask: FreshnessAsk = askGroq,
): Promise<boolean | null> {
  if (messages.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, FRESHNESS_TIMEOUT_MS);

  if (master.aborted) {
    controller.abort();
  } else {
    master.addEventListener("abort", stop, { once: true });
  }

  const started = Date.now();

  try {
    const text = await ask(buildRouterMessages(messages), controller.signal);
    const decision = text === null ? null : parseFreshness(text);

    console.log(
      JSON.stringify({
        event: "freshness",
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
