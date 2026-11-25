// tests/chat-choices.test.ts
// The tappable answers in a chat message: found, taken out of the text, kept
// in order, limited, and never shown half-written. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CHOICES,
  MAX_CHOICE_CHARS,
  joinAnswers,
  parseOptions,
  splitChoices,
} from "../src/features/chat/choices.ts";

test("a question with its choices becomes text and buttons", () => {
  const parts = splitChoices(
    "چه سبکی؟\n[[choices: انیمه | واقعی | تاریخی]]",
  );

  assert.deepEqual(parts, [
    { kind: "text", text: "چه سبکی؟" },
    { kind: "choices", options: ["انیمه", "واقعی", "تاریخی"] },
  ]);
});

test("two questions keep their own order and their own buttons", () => {
  const parts = splitChoices(
    "Which look?\n[[choices: Anime | Real]]\nWhat to do with the photos?\n[[choices: Bring to life | Change style]]",
  );

  assert.deepEqual(
    parts.map((part) => part.kind),
    ["text", "choices", "text", "choices"],
  );
  assert.deepEqual(parts[3], {
    kind: "choices",
    options: ["Bring to life", "Change style"],
  });
});

test("text without a marker is returned unchanged", () => {
  assert.deepEqual(splitChoices("سلام، چه ویدیویی بسازم؟"), [
    { kind: "text", text: "سلام، چه ویدیویی بسازم؟" },
  ]);
  assert.deepEqual(splitChoices(""), []);
});

test("one option alone is not a question: the marker disappears", () => {
  assert.deepEqual(splitChoices("Ready?\n[[choices: Yes]]"), [
    { kind: "text", text: "Ready?" },
  ]);
  assert.deepEqual(parseOptions(" | | "), []);
});

test("options are trimmed, without repeats, shortened and limited", () => {
  assert.deepEqual(parseOptions("  a  |  b |a| \n c "), ["a", "b", "c"]);

  const many = parseOptions("1|2|3|4|5|6|7");
  assert.equal(many.length, MAX_CHOICES);

  const long = parseOptions(`${"x".repeat(100)} | y`);
  assert.equal(long[0]?.length, MAX_CHOICE_CHARS);
});

test("a marker that is still being written is hidden", () => {
  assert.deepEqual(splitChoices("چه سبکی؟\n[[choices: انیمه | وا"), [
    { kind: "text", text: "چه سبکی؟" },
  ]);
  assert.deepEqual(splitChoices("Which look?\n[[ch"), [
    { kind: "text", text: "Which look?" },
  ]);
  assert.deepEqual(splitChoices("Which look?\n["), [
    { kind: "text", text: "Which look?" },
  ]);
});

test("the word choices is matched in any letter case and spacing", () => {
  assert.deepEqual(splitChoices("[[ Choices : a | b ]]"), [
    { kind: "choices", options: ["a", "b"] },
  ]);
});

test("joinAnswers puts the chosen answers in one line, in order", () => {
  assert.equal(joinAnswers(["انیمه", "جان دادن به عکس"]), "انیمه، جان دادن به عکس");
  assert.equal(joinAnswers(["only"]), "only");
  assert.equal(joinAnswers([" a ", "", "b"]), "a، b");
  assert.equal(joinAnswers([]), "");
});
