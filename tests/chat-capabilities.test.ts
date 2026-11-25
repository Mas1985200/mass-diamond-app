// tests/chat-capabilities.test.ts
// Every ability on the chat's start screen has one real sentence, ids are
// unique, and an unknown id has no sentence. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITIES,
  summaryFor,
} from "../src/features/chat/capabilities.ts";

test("every ability has a non-empty one-line sentence", () => {
  for (const capability of CAPABILITIES) {
    assert.ok(capability.summary.trim().length > 0, capability.id);
    assert.equal(capability.summary.includes("\n"), false, capability.id);
  }
});

test("ids are unique", () => {
  const ids = CAPABILITIES.map((capability) => capability.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("summaryFor finds a known id and returns null for an unknown one", () => {
  assert.equal(summaryFor("video"), CAPABILITIES.find((c) => c.id === "video")?.summary);
  assert.equal(summaryFor("nope"), null);
  assert.equal(summaryFor(""), null);
});

test("the ids the chat already uses are all covered", () => {
  for (const id of ["ask", "web", "image", "video", "learn", "product", "property"]) {
    assert.notEqual(summaryFor(id), null, id);
  }
});
