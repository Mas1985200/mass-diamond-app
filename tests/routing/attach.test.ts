// tests/routing/attach.test.ts
// "I do not see a photo" must only be said when the user's words point at
// something they sent that is not there. It must never be applied to a request
// that names a thing (an animal, an object, a body part ...), whatever the
// thing is. The model call is replaced by a fake, so nothing real is called.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouterMessages,
  offersTool,
  parseCapability,
  routeCapability,
  selectTools,
  type Capability,
} from "../../supabase/functions/ai-chat/routing/capability.ts";
import { buildSystemPrompt } from "../../supabase/functions/ai-chat/prompt/system.ts";
import type {
  AIMessage,
  ToolContext,
} from "../../supabase/functions/ai-chat/types.ts";

const MISSING_PHOTO_TEXT = "attach it with the + button";

const context: ToolContext = {
  now: new Date("2026-10-23T05:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: "test-key",
  memory: null,
};

const signal = new AbortController().signal;

test("parseCapability: reads the new label and keeps the old ones", () => {
  assert.equal(parseCapability("ATTACH"), "attach");
  assert.equal(parseCapability(" attach.\n"), "attach");
  assert.equal(parseCapability("KNOW"), "know");
  assert.equal(parseCapability("CHAT"), "chat");
  assert.equal(parseCapability("FRESH"), "fresh");
  assert.equal(parseCapability("PLACE"), "place");
  assert.equal(parseCapability("TIME"), "time");
  assert.equal(parseCapability("maybe"), null);
});

test("the router instruction names the label and says a named subject is never ATTACH", () => {
  const built = buildRouterMessages([{ role: "user", content: "عکس شیر ماده و نر" }]);
  const instruction = String(built[0]?.content);

  assert.ok(instruction.includes("ATTACH:"));
  assert.ok(instruction.includes("names ANY subject"));
  assert.ok(instruction.includes("is never ATTACH"));
  assert.ok(instruction.includes("ATTACH or CHAT"));
  assert.ok(String(built[1]?.content).includes("ATTACH or CHAT"));
});

test("routeCapability: the router's ATTACH decision is returned", async () => {
  const messages: AIMessage[] = [{ role: "user", content: "این چیه؟" }];
  const decision = await routeCapability(messages, signal, async () => "ATTACH");

  assert.equal(decision, "attach");
});

test("routeCapability: a message that carries a photo description is never ATTACH", async () => {
  const messages: AIMessage[] = [
    {
      role: "user",
      content:
        "What is this?\n\n[Photo description: the user attached 1 photo. A vision assistant looked at it and wrote the description below. The photos themselves cannot be seen.]\nA glass bottle.",
    },
  ];
  const decision = await routeCapability(messages, signal, async () => "ATTACH");

  assert.equal(decision, "chat");
});

test("routeCapability: other decisions are not changed", async () => {
  const messages: AIMessage[] = [{ role: "user", content: "عکس شیر ماده و نر" }];

  assert.equal(await routeCapability(messages, signal, async () => "KNOW"), "know");
  assert.equal(await routeCapability(messages, signal, async () => "CHAT"), "chat");
  assert.equal(await routeCapability(messages, signal, async () => null), null);
});

test("ATTACH offers no tool at all", () => {
  assert.equal(offersTool("attach", "web_search"), false);
  assert.equal(offersTool("attach", "find_place"), false);
  assert.equal(offersTool("attach", "remember"), false);
  assert.equal(selectTools([], "attach").length, 0);
});

test("the missing-photo rule is written only when the words point at something not sent", () => {
  const written: ReadonlyArray<Capability | null> = [null, "attach"];
  const notWritten: ReadonlyArray<Capability> = [
    "chat",
    "know",
    "fresh",
    "place",
    "time",
  ];

  for (const capability of written) {
    const prompt = buildSystemPrompt(context, undefined, capability);

    assert.ok(prompt.includes(MISSING_PHOTO_TEXT), String(capability));
    assert.ok(prompt.includes("never guess what it is"), String(capability));
    assert.ok(prompt.includes("A request to SEE a named thing"), String(capability));
  }

  for (const capability of notWritten) {
    const prompt = buildSystemPrompt(context, undefined, capability);

    assert.ok(!prompt.includes(MISSING_PHOTO_TEXT), capability);
  }
});

test("the missing-photo rule is never written when a photo is attached", () => {
  for (const capability of [null, "attach"] as const) {
    const prompt = buildSystemPrompt(context, undefined, capability, 1);

    assert.ok(!prompt.includes(MISSING_PHOTO_TEXT), String(capability));
    assert.ok(prompt.includes("Photos from the user"), String(capability));
  }
});

test("the wrong-picture rule stays for every kind of question", () => {
  for (const capability of [null, "chat", "know", "fresh", "place", "time", "attach"] as const) {
    const prompt = buildSystemPrompt(context, undefined, capability);

    assert.ok(
      prompt.includes("a comment about the app's automatic pictures"),
      String(capability),
    );
  }
});
