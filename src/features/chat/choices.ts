// src/features/chat/choices.ts
// Tappable answers inside a chat message.
//
// When the assistant asks a short question it writes the possible answers on
// their own line in this form:   [[choices: first | second | third]]
// This file finds those lines, takes them out of the visible text and hands
// the options over as buttons, in the same order as they were written. While
// a message is still being written, an unfinished marker is hidden so the
// person never sees half of it.
// Pure code: no browser, no React.

export const MAX_CHOICES = 5;
export const MIN_CHOICES = 2;
export const MAX_CHOICE_CHARS = 40;

export type ChoicePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "choices"; readonly options: readonly string[] };

const CHOICES_RE = /\[\[\s*choices\s*:([^\]]*)\]\]/gi;
// The start of a marker that has not been finished yet (still streaming).
const PENDING_RE = /\[{1,2}(?:\s*c[^\]]*)?$/i;

// The options written inside one marker: trimmed, without empty or repeated
// ones, each cut to a sensible length, at most MAX_CHOICES. Fewer than
// MIN_CHOICES is not a real question, so it gives an empty list.
export function parseOptions(body: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const piece of body.split("|")) {
    const option = piece.replace(/\s+/g, " ").trim().slice(0, MAX_CHOICE_CHARS).trim();

    if (!option || seen.has(option)) {
      continue;
    }

    seen.add(option);
    options.push(option);

    if (options.length >= MAX_CHOICES) {
      break;
    }
  }

  return options.length >= MIN_CHOICES ? options : [];
}

// Splits a message into its text and its groups of buttons, in order.
export function splitChoices(raw: string): ChoicePart[] {
  const parts: ChoicePart[] = [];
  let cursor = 0;

  const pushText = (text: string): void => {
    const clean = text.trim();

    if (clean) {
      parts.push({ kind: "text", text: clean });
    }
  };

  for (const match of raw.matchAll(CHOICES_RE)) {
    const index = match.index ?? 0;

    pushText(raw.slice(cursor, index));

    const options = parseOptions(match[1] ?? "");

    if (options.length > 0) {
      parts.push({ kind: "choices", options });
    }

    cursor = index + match[0].length;
  }

  pushText(raw.slice(cursor).replace(PENDING_RE, ""));

  return parts;
}

// One message that answers every group: the chosen options, in order.
export function joinAnswers(chosen: readonly string[]): string {
  return chosen
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0)
    .join("، ");
}
