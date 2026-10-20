// supabase/functions/ai-chat/images/illustrate.ts
// Pictures for any answer about a concrete thing, chosen WITHOUT relying on
// the main model to call a tool. A small model reads the conversation, names
// the main subject (or says there is nothing to picture), and credited free
// pictures of that subject are fetched. The answer never waits for this: it
// runs beside the answer and the pictures are added at the end.

import { stripThinking } from "../attachments/describe.ts";
import { createAttempt } from "../lib/http.ts";
import { describeError } from "../lib/util.ts";
import {
  askGroq,
  type CapabilityAsk,
} from "../routing/capability.ts";
import type { AIMessage, OAIMessage, PhotoItem } from "../types.ts";
import { searchOpenverse } from "./openverse.ts";
import { fetchLicensedPhotosForTopic } from "./photos.ts";

export const PLAN_TIMEOUT_MS = 4_000;
export const ILLUSTRATION_DEADLINE_MS = 14_000;
export const ILLUSTRATION_MAX = 4;

const CONTEXT_MESSAGES = 4;
const CONTEXT_CHARS = 400;
const TOPIC_MAX_CHARS = 80;
const TOPIC_MIN_CHARS = 2;

const INSTRUCTION = [
  "You decide what to show as pictures under the answer to the LAST user message. Use the earlier messages only to understand short follow-ups ('a photo of it', 'and its picture').",
  "Reply with exactly one line: either NONE, or TOPIC: <the main subject, written in English as the title of its Wikipedia article, 1 to 5 words>.",
  "Give a TOPIC when the main subject is a concrete thing that can be pictured: a body part or organ, an animal or breed, a plant, a food or dish, a drug or substance, a tool, device or vehicle, a material, a place, building or landmark, an artwork, a famous historical or public figure, an event, a natural phenomenon, a space object, a sport, an instrument, a profession. Do it also when the user only names the thing, asks what it is, or asks to see it.",
  "Give NONE for greetings, chit-chat, advice, opinions, feelings, writing, editing or translation help, math, programming, planning, brainstorming, memory statements, questions about the assistant itself, questions whose answer is a price, a news item, the weather or the time, and any question about private individuals.",
  "If the user asks for a picture but names no kind (for example just 'a dog'), give the plain general subject; never ask anything back.",
  "Never write anything except that one line.",
].join("\n");

export type Plan = {
  readonly topic: string;
};

// "TOPIC: Human liver" -> "Human liver". Empty when there is nothing to show.
export function parseTopic(text: string): string {
  return parsePlan(text)?.topic ?? "";
}

export function parsePlan(text: string): Plan | null {
  const match = /TOPIC\s*:\s*([^\n\r]+)/i.exec(stripThinking(text));

  if (!match?.[1]) {
    return null;
  }

  const topic = match[1]
    .replace(/\|.*$/u, "")
    .replace(/["'`*_«»“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!؟?\s]+$/u, "")
    .trim()
    .slice(0, TOPIC_MAX_CHARS)
    .trim();

  if (topic.length < TOPIC_MIN_CHARS || /^none$/i.test(topic)) {
    return null;
  }

  return { topic };
}

export function buildPlanMessages(
  messages: readonly AIMessage[],
): OAIMessage[] {
  const transcript = messages
    .filter((message) => message.role !== "system")
    .slice(-CONTEXT_MESSAGES)
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, CONTEXT_CHARS)}`,
    )
    .join("\n");

  return [
    { role: "system", content: INSTRUCTION },
    { role: "user", content: `${transcript}\n\nAnswer (NONE or TOPIC: ...):` },
  ];
}

// What the pictures should show; null = no pictures for this message.
export async function planTopic(
  messages: readonly AIMessage[],
  master: AbortSignal,
  ask: CapabilityAsk = askGroq,
): Promise<Plan | null> {
  if (messages.length === 0) {
    return null;
  }

  const attempt = createAttempt(master, PLAN_TIMEOUT_MS);

  try {
    const text = await ask(buildPlanMessages(messages), attempt.signal);

    return text === null ? null : parsePlan(text);
  } catch {
    return null;
  } finally {
    attempt.clearConnectTimer();
  }
}

// Every source is used, in this order, until there are enough pictures:
// Wikimedia Commons photos, free diagrams of the topic, then Openverse (a free
// search over openly licensed pictures from many collections). Whatever a
// source cannot supply is filled from the next one.
export async function picturesOfTopic(
  plan: Plan,
  master: AbortSignal,
): Promise<PhotoItem[]> {
  const found: PhotoItem[] = [];

  const add = (items: readonly PhotoItem[]): void => {
    for (const item of items) {
      if (
        found.length < ILLUSTRATION_MAX &&
        !found.some((known) => known.src === item.src)
      ) {
        found.push(item);
      }
    }
  };

  add(
    await fetchLicensedPhotosForTopic(plan.topic, "en", master, {
      max: ILLUSTRATION_MAX,
    }),
  );

  if (found.length < ILLUSTRATION_MAX) {
    add(
      await fetchLicensedPhotosForTopic(plan.topic, "en", master, {
        max: ILLUSTRATION_MAX - found.length,
        diagramsOnly: true,
      }),
    );
  }

  if (found.length < ILLUSTRATION_MAX) {
    add(await searchOpenverse(plan.topic, ILLUSTRATION_MAX, master));
  }

  return found;
}

export type IllustrationDeps = {
  readonly ask?: CapabilityAsk;
  readonly pictures?: (plan: Plan, master: AbortSignal) => Promise<PhotoItem[]>;
};

// Never throws and never takes longer than the deadline: [] when there is
// nothing to show.
export async function prepareIllustration(
  messages: readonly AIMessage[],
  master: AbortSignal,
  deps: IllustrationDeps = {},
): Promise<PhotoItem[]> {
  const started = Date.now();
  const deadline = createAttempt(master, ILLUSTRATION_DEADLINE_MS);
  let planned = false;
  let shown = 0;

  try {
    const plan = await planTopic(messages, deadline.signal, deps.ask);

    if (!plan) {
      return [];
    }

    planned = true;

    const photos = await (deps.pictures ?? picturesOfTopic)(
      plan,
      deadline.signal,
    );

    shown = photos.length;

    return photos;
  } catch (error) {
    console.error(`illustration failed: ${describeError(error).slice(0, 200)}`);

    return [];
  } finally {
    deadline.clearConnectTimer();

    // Counts only, never the topic text.
    console.log(
      JSON.stringify({
        event: "illustration",
        planned,
        shown,
        ms: Date.now() - started,
      }),
    );
  }
}
