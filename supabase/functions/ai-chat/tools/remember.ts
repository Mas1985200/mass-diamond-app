// supabase/functions/ai-chat/tools/remember.ts
// remember tool: saves one short long-term fact about the current user.

import type { ToolContext, ToolOutcome } from "../types.ts";

const SENSITIVE_WORDS = /(password|passcode|cvv|رمز|پسورد|کارت\s*بانکی|شماره\s*کارت)/i;

function toLatinDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

// True when the text looks like it contains an ID, card or account number
// or a secret; such text must never be stored.
export function looksSensitive(text: string): boolean {
  const latin = toLatinDigits(text);
  const joined = latin.replace(/(?<=\d)[\s-]+(?=\d)/g, "");

  return /\d{9,}/.test(joined) || SENSITIVE_WORDS.test(latin);
}

export async function runRemember(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!ctx.memory) {
    return { data: { status: "memory_unavailable" } };
  }

  const fact = typeof args.fact === "string" ? args.fact.trim() : "";

  if (!fact) {
    return { data: { status: "invalid", hint: "fact is required." } };
  }

  if (looksSensitive(fact)) {
    return {
      data: {
        status: "refused_sensitive",
        hint: "This looks like a number or secret and was not saved. Do not mention numbers or secrets back; tell the user briefly that you do not store sensitive details.",
      },
    };
  }

  const result = await ctx.memory.remember(fact);

  switch (result) {
    case "saved":
      return {
        data: {
          status: "saved",
          hint: "Saved. Continue the normal answer; if you acknowledge it, use at most a few words in the user's language.",
        },
      };
    case "duplicate":
      return {
        data: {
          status: "already_known",
          hint: "Already known. Continue the normal answer without mentioning it.",
        },
      };
    case "full":
      return {
        data: {
          status: "memory_full",
          hint: "Memory is full. Tell the user in one short sentence that it is full and they can delete old items.",
        },
      };
    case "invalid":
      return { data: { status: "invalid" } };
    default:
      return { data: { status: "error" } };
  }
}
