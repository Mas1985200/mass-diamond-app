// supabase/functions/ai-chat/history/trim.ts
// Shrinks the stored conversation so fewer tokens are sent to the model.

import { HISTORY_CHAR_BUDGET, HISTORY_MESSAGE_CAP } from "../config.ts";
import type { AIMessage } from "../types.ts";

export function trimHistory(history: readonly AIMessage[]): AIMessage[] {
  const kept: AIMessage[] = [];
  let used = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];

    if (!item) {
      continue;
    }

    const content =
      item.content.length > HISTORY_MESSAGE_CAP
        ? `${item.content.slice(0, HISTORY_MESSAGE_CAP)}…`
        : item.content;

    if (used + content.length > HISTORY_CHAR_BUDGET && kept.length > 0) {
      break;
    }

    used += content.length;
    kept.unshift({ role: item.role, content });
  }

  while (kept.length > 0 && kept[0]?.role !== "user") {
    kept.shift();
  }

  return kept;
}
