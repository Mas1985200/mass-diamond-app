// supabase/functions/ai-chat/retrieval/small-model.ts
// One short question to the small, fast model that also translates searches.
// It never answers the user: its text is read by the app. Any failure returns
// null, and the caller simply goes on without what it asked for.

import { GROQ_ENDPOINT } from "../config.ts";
import { createAttempt } from "../lib/http.ts";
import { getOptionalEnv, isRecord } from "../lib/util.ts";

export const SMALL_MODEL_TIMEOUT_MS = 5_000;

const DEFAULT_SMALL_MODEL = "openai/gpt-oss-20b";

export async function askSmallModel(
  system: string,
  user: string,
  master: AbortSignal,
  maxTokens = 300,
): Promise<string | null> {
  let apiKey: string | undefined;
  let model = DEFAULT_SMALL_MODEL;

  try {
    apiKey = getOptionalEnv("GROQ_API_KEY");
    model = getOptionalEnv("GROQ_TRANSLATE_MODEL") ?? DEFAULT_SMALL_MODEL;
  } catch {
    return null;
  }

  if (!apiKey) {
    return null;
  }

  const attempt = createAttempt(master, SMALL_MODEL_TIMEOUT_MS);

  try {
    const payload: Record<string, unknown> = {
      model,
      temperature: 0,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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
    const choices =
      isRecord(json) && Array.isArray(json.choices) ? json.choices : [];
    const first: unknown = choices[0];
    const message = isRecord(first) ? first.message : null;
    const content =
      isRecord(message) && typeof message.content === "string"
        ? message.content
        : "";

    return content.trim() || null;
  } catch {
    return null;
  } finally {
    attempt.clearConnectTimer();
  }
}
