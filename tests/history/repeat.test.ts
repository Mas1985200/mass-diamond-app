// tests/history/repeat.test.ts
// The app, not the model, decides that the user asked the same question again.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isRepeatedQuestion,
  REPEATED_QUESTION_RULE,
  withRepeatNote,
} from "../../supabase/functions/ai-chat/history/repeat.ts";
import type {
  AIMessage,
  ToolDefinition,
} from "../../supabase/functions/ai-chat/types.ts";

const user = (content: string): AIMessage => ({ role: "user", content });
const bot = (content: string): AIMessage => ({ role: "assistant", content });

test("the same question twice is a repeat, in any language", () => {
  assert.equal(
    isRepeatedQuestion([
      user("آخرین خبرهای امروز دربارهٔ فوتبال ایران"),
      bot("..."),
      user("آخرین خبرهای امروز دربارهٔ فوتبال ایران"),
    ]),
    true,
  );
  assert.equal(
    isRepeatedQuestion([
      user("What is the latest football news?"),
      bot("..."),
      user("what is the latest football news"),
    ]),
    true,
  );
});

test("spelling variants, spacing and punctuation do not hide a repeat", () => {
  assert.equal(
    isRepeatedQuestion([
      user("آخرین خبرهای فوتبال ایران؟"),
      bot("..."),
      // No long alef, a zero-width non-joiner, an Arabic yeh and a double space.
      user("اخرین  خبر\u200cهای فوتبال ا\u064aران"),
    ]),
    true,
  );
  assert.equal(
    isRepeatedQuestion([
      user("آخرین خبرهای فوتبال ایران"),
      bot("..."),
      user("آخرین خبرهای فوتبال ا\u064aران!!"),
    ]),
    true,
  );
});

test("a different question, a first message or a short reply is not a repeat", () => {
  assert.equal(
    isRepeatedQuestion([
      user("آخرین خبرهای فوتبال ایران"),
      bot("..."),
      user("قیمت دلار امروز چنده"),
    ]),
    false,
  );
  assert.equal(isRepeatedQuestion([user("آخرین خبرهای فوتبال ایران")]), false);
  assert.equal(isRepeatedQuestion([]), false);
  assert.equal(
    isRepeatedQuestion([user("ok"), bot("..."), user("ok")]),
    false,
  );
});

test("only the user's own messages count, not the assistant's", () => {
  assert.equal(
    isRepeatedQuestion([
      bot("آخرین خبرهای فوتبال ایران"),
      user("آخرین خبرهای فوتبال ایران"),
    ]),
    false,
  );
});

test("a repeat is found even when other questions came in between", () => {
  assert.equal(
    isRepeatedQuestion([
      user("آخرین خبرهای فوتبال ایران"),
      bot("..."),
      user("قیمت دلار امروز چنده"),
      bot("..."),
      user("آخرین خبرهای فوتبال ایران"),
    ]),
    true,
  );
});

const SEARCH_TOOL = {
  type: "function",
  function: { name: "web_search", description: "", parameters: {} },
} as unknown as ToolDefinition;
const OTHER_TOOL = {
  type: "function",
  function: { name: "get_datetime", description: "", parameters: {} },
} as unknown as ToolDefinition;

const system: AIMessage = { role: "system", content: "SYSTEM PROMPT" };

test("withRepeatNote: the rule is added to the system prompt only for a repeat that can search", () => {
  const repeat = [
    system,
    user("آخرین خبرهای فوتبال ایران"),
    bot("..."),
    user("آخرین خبرهای فوتبال ایران"),
  ];
  const noted = withRepeatNote(repeat, [SEARCH_TOOL]);

  assert.equal(noted.length, repeat.length);
  assert.ok(noted[0]?.content.startsWith("SYSTEM PROMPT\n"));
  assert.ok(noted[0]?.content.includes(REPEATED_QUESTION_RULE));
  // The other messages are untouched, and the input is not modified.
  assert.deepEqual(noted.slice(1), repeat.slice(1));
  assert.equal(repeat[0]?.content, "SYSTEM PROMPT");

  // No search tool: unchanged.
  assert.equal(withRepeatNote(repeat, [OTHER_TOOL]), repeat);
  assert.equal(withRepeatNote(repeat, []), repeat);

  // Not a repeat: unchanged.
  const fresh = [system, user("سلام دوست من"), bot("..."), user("قیمت دلار")];

  assert.equal(withRepeatNote(fresh, [SEARCH_TOOL]), fresh);

  // No system prompt first: unchanged.
  const noSystem = [user("آخرین خبرهای فوتبال ایران"), user("آخرین خبرهای فوتبال ایران")];

  assert.equal(withRepeatNote(noSystem, [SEARCH_TOOL]), noSystem);
});
