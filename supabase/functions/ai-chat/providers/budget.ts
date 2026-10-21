// supabase/functions/ai-chat/providers/budget.ts
// Groq limits the tokens a model may handle per minute, and it checks a
// request against what is LEFT of that minute: the prompt plus the room asked
// for the answer. When a request is refused for that reason, the refusal says
// the limit, what is used and what was requested. From those numbers the room
// for the answer is cut to what fits, and the same model is asked again,
// instead of giving up on it and losing its quality.

import type { ReasoningEffort } from "./groq.ts";

// Below this a reasoning model could not finish thinking and answering.
export const MIN_OUTPUT_TOKENS = 1_500;
const SAFETY_TOKENS = 200;

export type Shrunk = {
  readonly maxTokens: number;
  readonly effort: ReasoningEffort;
};

// null = nothing useful fits (or the refusal is not about tokens per minute).
export function shrinkForTokenLimit(
  errorText: string,
  sentMaxTokens: number,
  effort: ReasoningEffort,
): Shrunk | null {
  if (!/tokens per minute/i.test(errorText)) {
    return null;
  }

  const numbers = /Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i.exec(errorText);

  if (!numbers) {
    return null;
  }

  const limit = Number(numbers[1]);
  const used = Number(numbers[2]);
  const requested = Number(numbers[3]);
  const prompt = requested - sentMaxTokens;
  const room = limit - used - prompt - SAFETY_TOKENS;

  if (![limit, used, requested, prompt, room].every(Number.isFinite) || prompt < 0) {
    return null;
  }

  if (room < MIN_OUTPUT_TOKENS) {
    return null;
  }

  // Less room means less thinking, so the answer itself still fits.
  const lowered: ReasoningEffort =
    room < 2_500 ? "low" : room < 3_500 && effort === "high" ? "medium" : effort;

  return { maxTokens: Math.min(sentMaxTokens, room), effort: lowered };
}
