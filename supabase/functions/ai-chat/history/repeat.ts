// supabase/functions/ai-chat/history/repeat.ts
// Did the user just ask the same question again? The app decides this by
// comparing words, not the model: a model that sees "ask again" next to the
// rule "a follow-up wants NEW items" answers "nothing new" or wanders off to
// other topics instead of answering the question a second time.

import type { AIMessage, ToolDefinition } from "../types.ts";
import { tokensOf } from "../retrieval/evidence.ts";

// Two messages with at least this share of the same words are one question.
const SAME_QUESTION = 0.85;
// Very short messages ("ok", "hi") are never counted as a repeated question.
const MIN_WORDS = 2;

export const REPEATED_QUESTION_RULE =
  "- The user has just asked the same question again. Answer it again completely from your tools, exactly as if it were new, and give the full answer. This overrides the rule about follow-ups asking for new items: do not say there is nothing new, do not search for other topics, and do not mention that the question was repeated.";

function sameWords(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const setB = new Set(b);
  const shared = a.filter((word) => setB.has(word)).length;

  return shared / (a.length + b.length - shared);
}

// True when the newest user message says the same thing as an earlier user
// message of this chat (spelling variants, spacing and punctuation ignored).
export function isRepeatedQuestion(messages: readonly AIMessage[]): boolean {
  const users = messages.filter((message) => message.role === "user");
  const last = users[users.length - 1];

  if (!last) {
    return false;
  }

  const lastWords = tokensOf(last.content);

  if (lastWords.length < MIN_WORDS) {
    return false;
  }

  return users
    .slice(0, -1)
    .some(
      (earlier) =>
        sameWords(lastWords, tokensOf(earlier.content)) >= SAME_QUESTION,
    );
}

// Adds the rule above to the system prompt when the question is a repeat and
// the model can search the web (the only case where "nothing new" goes wrong).
// Everything else is returned unchanged.
export function withRepeatNote(
  messages: readonly AIMessage[],
  tools: readonly ToolDefinition[],
): readonly AIMessage[] {
  const first = messages[0];

  if (
    !first ||
    first.role !== "system" ||
    !tools.some((tool) => tool.function.name === "web_search") ||
    !isRepeatedQuestion(messages)
  ) {
    return messages;
  }

  return [
    { ...first, content: `${first.content}\n${REPEATED_QUESTION_RULE}` },
    ...messages.slice(1),
  ];
}
