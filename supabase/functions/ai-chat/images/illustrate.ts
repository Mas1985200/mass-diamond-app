// supabase/functions/ai-chat/images/illustrate.ts
// Pictures for answers about a concrete thing, chosen WITHOUT relying on the
// main model to call a tool. A small model reads the conversation and names
// the thing the answer is literally about, and credited free pictures of it
// are fetched. A picture must show what the answer is about: when there is no
// such thing, no picture is shown rather than an unrelated one. The answer
// never waits for this: it runs beside the answer and the pictures are added
// at the end.

import { stripThinking } from "../attachments/describe.ts";
import { createAttempt } from "../lib/http.ts";
import { describeError } from "../lib/util.ts";
import {
  askGroq,
  type CapabilityAsk,
} from "../routing/capability.ts";
import type { AIMessage, OAIMessage, PhotoItem } from "../types.ts";
import { searchOpenverse } from "./openverse.ts";
import { searchUnsplash } from "./unsplash.ts";
import { searchWebImages } from "./webimages.ts";
import { fetchLicensedPhotosForTopic } from "./photos.ts";

// The planner runs beside the answer (nothing waits for it), so it can think
// at a higher level than the router and may take longer.
export const PLAN_TIMEOUT_MS = 8_000;
export const ILLUSTRATION_DEADLINE_MS = 14_000;
export const ILLUSTRATION_MAX = 4;

const CONTEXT_MESSAGES = 4;
const CONTEXT_CHARS = 400;
const TOPIC_MAX_CHARS = 80;
const TOPIC_MIN_CHARS = 2;

const INSTRUCTION = [
  "You choose the pictures shown under the answer to the LAST user message. A picture must show exactly what the answer is about; a wrong or loosely related picture is worse than none. Use the earlier messages only to understand short follow-ups such as 'a photo of it'.",
  "Reply with exactly one line: either TOPIC: <the thing, written in English as the title of its Wikipedia article, 1 to 5 words> or NONE.",
  "Give a TOPIC when the answer is literally about a concrete thing that can be photographed: a body part or organ, an animal or breed, a plant, a food or dish, a drug or substance, a tool, device or vehicle, a material, a place, building or landmark, an artwork, a famous historical or public figure, an event, a natural phenomenon, a space object, a sport, an instrument, a profession, a subject of science or technology. Do it also when the user only names the thing or asks to see it. Use the exact thing, not something it reminds you of.",
  "Give NONE when there is no such thing: greetings, thanks, feelings, advice about the user's own life, plans, writing, translation or editing help, math, code, prices, news, the weather, the time, questions about the assistant, any message about a photo the user attached (its description is in the chat) or about a person in it, and anything about a private individual.",
  "Never use a metaphor or a loosely related object as the topic (for example never a watch for a question about age). If unsure, answer NONE.",
  "If the user asks for a picture without naming a kind (just 'a dog'), give the plain general subject. Never ask anything back and never write anything except that one line.",
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

const askForPlan: CapabilityAsk = (messages, signal) =>
  askGroq(messages, signal, "medium");

// What the pictures should show; null = no pictures for this message.
export async function planTopic(
  messages: readonly AIMessage[],
  master: AbortSignal,
  ask: CapabilityAsk = askForPlan,
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
// the photos of the Wikipedia article (the surest match) mixed with Unsplash
// (many good photographs, when its key is set), pictures found on the web
// (only if the free ones are too few), free diagrams of the topic, then
// Openverse (a free search over openly licensed pictures). The first two are
// asked at the same time, so the extra source costs no extra waiting.
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

  const [article, stock] = await Promise.all([
    fetchLicensedPhotosForTopic(plan.topic, "en", master, {
      max: ILLUSTRATION_MAX,
    }),
    searchUnsplash(plan.topic, ILLUSTRATION_MAX, master),
  ]);

  // A mix of both: the article's best two, then Unsplash's best two, then
  // whatever is left of either, so the strip never depends on one source.
  add(article.slice(0, 2));
  add(stock.slice(0, 2));
  add(article);
  add(stock);

  if (found.length < ILLUSTRATION_MAX) {
    add(await searchWebImages(plan.topic, ILLUSTRATION_MAX - found.length, master));
  }

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
