// supabase/functions/ai-chat/providers/text-tool-call.ts
// Some models write a tool call as ordinary text instead of using the real
// tool-call channel, for example:
//   {"type": "function", "name": "web_search", "parameters": {"query": "..."}}
// Shown as an answer, that text is a bug the user can see. This reads such a
// text so the call can be run as a real call, and decides what to do with a
// turn whose text was held back instead of being streamed (ModelTurn.held).

import type { ModelTurn } from "./types.ts";

export type TextToolCall = {
  readonly name: string;
  readonly arguments: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text may be wrapped in a code fence such as ```json ... ```.
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(trimmed);

  return fenced?.[1] !== undefined ? fenced[1] : trimmed;
}

function argumentsOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return "{}";
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    try {
      return isRecord(JSON.parse(value)) ? value : null;
    } catch {
      return null;
    }
  }

  return null;
}

// Accepts the shapes models use:
//   {"name": "...", "parameters": {...}}   (also "arguments" or "input")
//   {"type": "function", "name": "...", "parameters": {...}}
//   {"function": {"name": "...", "arguments": ...}}
// Anything else (ordinary JSON data, a name without arguments, broken JSON)
// is not a tool call and gives null.
export function parseTextToolCall(text: string): TextToolCall | null {
  const body = unfence(text);

  if (!body.startsWith("{") || !body.endsWith("}")) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const holder = isRecord(parsed.function) ? parsed.function : parsed;
  const name = holder.name;

  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  const hasArguments =
    "parameters" in holder || "arguments" in holder || "input" in holder;

  if (!hasArguments) {
    return null;
  }

  const args = argumentsOf(
    holder.parameters ?? holder.arguments ?? holder.input,
  );

  return args === null ? null : { name: name.trim(), arguments: args };
}

// What to do with a turn whose text was held back (ModelTurn.held):
// - the text is a tool call for an offered tool and the loop may still call
//   tools: it becomes a real tool call and nothing is shown;
// - the text is a tool call that cannot run (unknown tool, no round left, or
//   the model also made a real call): it is dropped and never shown, so the
//   empty-answer retry takes over when nothing else is left;
// - otherwise it is an ordinary answer that merely starts with "{" or a code
//   fence (for example JSON the user asked for): it is shown as it is.
export function settleHeldTurn(
  turn: ModelTurn,
  offered: readonly string[],
  canCallTools: boolean,
): { readonly turn: ModelTurn; readonly show: string } {
  if (!turn.held) {
    return { turn, show: "" };
  }

  const written = parseTextToolCall(turn.text);

  if (written === null) {
    return { turn: { ...turn, held: false }, show: turn.text };
  }

  if (
    turn.toolCalls.length === 0 &&
    canCallTools &&
    offered.includes(written.name)
  ) {
    return {
      turn: {
        ...turn,
        text: "",
        toolCalls: [
          { id: "call_text_0", name: written.name, arguments: written.arguments },
        ],
        held: false,
      },
      show: "",
    };
  }

  return { turn: { ...turn, text: "", held: false }, show: "" };
}
