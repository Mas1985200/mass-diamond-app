// supabase/functions/ai-chat/retrieval/translate.ts
// A news question about a place is found far more often in the place's own
// language. The model names that language with a short tag (place_language);
// when it did not write the second wording itself, a small model translates the
// search. Any failure returns null and the search simply goes on without it.
// Nothing here depends on a language or a topic.

import { GROQ_ENDPOINT } from "../config.ts";
import { createAttempt } from "../lib/http.ts";
import { getOptionalEnv, isRecord } from "../lib/util.ts";

export const TRANSLATE_TIMEOUT_MS = 5_000;

const DEFAULT_TRANSLATE_MODEL = "openai/gpt-oss-20b";
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

// A language tag as the model wrote it ("fa", "zh-CN"), or null when it is not
// one.
export function languageTag(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const tag = value.trim();

  return LANGUAGE_TAG.test(tag) ? tag : null;
}

// "fa-IR" and "fa" are the same language.
export function sameLanguage(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }

  return (
    (a.split("-")[0] ?? "").toLowerCase() ===
    (b.split("-")[0] ?? "").toLowerCase()
  );
}

export async function translateQuery(
  query: string,
  tag: string,
  master: AbortSignal,
): Promise<string | null> {
  let apiKey: string | undefined;
  let model = DEFAULT_TRANSLATE_MODEL;

  try {
    apiKey = getOptionalEnv("GROQ_API_KEY");
    model = getOptionalEnv("GROQ_TRANSLATE_MODEL") ?? DEFAULT_TRANSLATE_MODEL;
  } catch {
    return null;
  }

  if (!apiKey) {
    return null;
  }

  const attempt = createAttempt(master, TRANSLATE_TIMEOUT_MS);

  try {
    const payload: Record<string, unknown> = {
      model,
      temperature: 0,
      max_completion_tokens: 400,
      messages: [
        {
          role: "system",
          content: `Translate the user's web search into the language with the tag "${tag}". Keep the names of people, teams and places in the form that language uses. Reply with the translated search only: no quotes, no notes.`,
        },
        { role: "user", content: query },
      ],
    };

    if (model.includes("gpt-oss")) {
      payload.reasoning_effort = "low";
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
      return null;
    }

    const json: unknown = await response.json();
    const choices = isRecord(json) && Array.isArray(json.choices) ? json.choices : [];
    const first: unknown = choices[0];
    const message = isRecord(first) ? first.message : null;
    const content =
      isRecord(message) && typeof message.content === "string"
        ? message.content
        : "";
    const line = content.split("\n")[0] ?? "";
    const text = line
      .trim()
      .replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, "")
      .trim()
      .slice(0, 300);

    if (!text || text.toLowerCase() === query.trim().toLowerCase()) {
      return null;
    }

    return text;
  } catch {
    return null;
  } finally {
    attempt.clearConnectTimer();
  }
}
