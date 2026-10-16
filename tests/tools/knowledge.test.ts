import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPassages,
  splitIntoChunks,
  tokenize,
} from "../../supabase/functions/ai-chat/tools/knowledge.ts";

const ARTICLE = [
  "A black hole is a region of spacetime where gravity is so strong that nothing can escape from it.",
  "",
  "== History ==",
  "The idea of a body so massive that even light could not escape was proposed in the eighteenth century by John Michell.",
  "",
  "== Formation ==",
  "Stellar black holes form when a massive star runs out of fuel, its core collapses under gravity and a supernova blasts the outer layers away.",
  "",
  "== Observation ==",
  "Black holes emit no light themselves, but matter falling into them heats up and radiates strongly in X-rays.",
].join("\n");

test("tokenize unifies Arabic and Persian letters", () => {
  assert.deepEqual(tokenize("علي"), tokenize("علی"));
});

test("tokenize splits CJK text into character pairs", () => {
  assert.deepEqual(tokenize("黑洞形成"), ["黑洞", "洞形", "形成"]);
});

test("splitIntoChunks keeps section headings and drops tiny pieces", () => {
  const chunks = splitIntoChunks(ARTICLE);

  assert.equal(chunks.length, 4);
  assert.equal(chunks[2]?.heading, "Formation");
});

test("selectPassages returns the passage that answers the question", () => {
  const passages = selectPassages(ARTICLE, "how does a star collapse and form", 400);

  assert.ok(passages.some((passage) => passage.includes("supernova")));
  assert.ok(passages[0]?.includes("region of spacetime"));
});

test("selectPassages keeps article order and respects the budget", () => {
  const passages = selectPassages(ARTICLE, "formation supernova", 300);
  const joined = passages.join(" ");

  assert.ok(joined.indexOf("region of spacetime") < joined.indexOf("supernova"));
  assert.ok(!joined.includes("X-rays"));
});

test("selectPassages falls back to the opening when nothing matches", () => {
  const passages = selectPassages(ARTICLE, "zzzz qqqq", 600);

  assert.ok(passages.length >= 1);
  assert.ok(passages[0]?.includes("region of spacetime"));
});

test("selectPassages handles empty text", () => {
  assert.deepEqual(selectPassages("", "anything"), []);
});
