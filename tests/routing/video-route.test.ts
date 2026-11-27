// tests/routing/video-route.test.ts
// The chat connects to the video maker by itself when the words of the
// conversation are about making a video, a film or an animation, in any
// language, and never starts a video when the router is unsure. The model call
// is replaced by a fake, so nothing real is called.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouterMessages,
  offersTool,
  parseCapability,
  routeCapability,
  selectTools,
} from "../../supabase/functions/ai-chat/routing/capability.ts";
import type { AIMessage, ToolDefinition } from "../../supabase/functions/ai-chat/types.ts";

const signal = new AbortController().signal;

function tool(name: string): ToolDefinition {
  return {
    type: "function",
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  };
}

test("parseCapability: reads VIDEO and keeps every older label", () => {
  assert.equal(parseCapability("VIDEO"), "video");
  assert.equal(parseCapability(" video.\n"), "video");
  assert.equal(parseCapability("ATTACH"), "attach");
  assert.equal(parseCapability("CHAT"), "chat");
  assert.equal(parseCapability("KNOW"), "know");
  assert.equal(parseCapability("FRESH"), "fresh");
  assert.equal(parseCapability("PLACE"), "place");
  assert.equal(parseCapability("TIME"), "time");
  assert.equal(parseCapability("maybe"), null);
});

test("the router instruction describes VIDEO for any language and follow-ups", () => {
  const built = buildRouterMessages([{ role: "user", content: "یه انیمه بساز" }]);
  const instruction = String(built[0]?.content);

  assert.ok(instruction.includes("VIDEO:"));
  assert.ok(instruction.includes("animation"));
  assert.ok(instruction.includes("anime"));
  assert.ok(instruction.includes("in any language"));
  assert.ok(instruction.includes("follow-up"));
  assert.ok(instruction.includes("is not VIDEO"));
  assert.ok(instruction.includes("KNOW, VIDEO, ATTACH or CHAT"));
  assert.ok(String(built[1]?.content).includes("VIDEO, ATTACH or CHAT"));
});

test("routeCapability: a video request is routed to video, whatever the language", async () => {
  const requests = [
    "یه ویدیوی تبلیغاتی ۲ دقیقه‌ای برای کافه من بساز",
    "make me a 3 minute anime about a lonely robot",
    "hazme un cortometraje de animación",
    "给我做一个电影预告片",
  ];

  for (const content of requests) {
    const messages: AIMessage[] = [{ role: "user", content }];
    const decision = await routeCapability(messages, signal, async () => "VIDEO");

    assert.equal(decision, "video");
  }
});

test("routeCapability: the router sees the director's question with the short answer", async () => {
  const messages: AIMessage[] = [
    { role: "user", content: "یه فیلم کوتاه می‌خوام" },
    { role: "assistant", content: "چه سبکی؟ انیمه، کلاسیک یا واقعی؟" },
    { role: "user", content: "انیمه" },
  ];
  let seen = "";

  const decision = await routeCapability(messages, signal, async (asked) => {
    seen = asked.map((message) => String(message.content)).join("\n");
    return "VIDEO";
  });

  assert.equal(decision, "video");
  assert.ok(seen.includes("چه سبکی؟"));
  assert.ok(seen.includes("User: انیمه"));
});

test("only the video kind offers create_video; an unsure router never starts a video", () => {
  const tools = [tool("create_video"), tool("web_search"), tool("remember")];
  const names = (kind: Parameters<typeof selectTools>[1]) =>
    selectTools(tools, kind).map((item) => item.function.name);

  assert.deepEqual(names("video"), ["create_video"]);
  assert.deepEqual(names(null), ["web_search", "remember"]);

  for (const kind of ["chat", "know", "fresh", "place", "time", "attach"] as const) {
    assert.ok(!names(kind).includes("create_video"));
  }

  assert.equal(offersTool("video", "create_video"), true);
  assert.equal(offersTool("video", "web_search"), false);
  assert.equal(offersTool(null, "create_video"), false);
  assert.equal(offersTool(null, "web_search"), true);
});

test("routeCapability: a failing router returns null, so no video is started", async () => {
  const messages: AIMessage[] = [{ role: "user", content: "یه ویدیو بساز" }];
  const decision = await routeCapability(messages, signal, async () => {
    throw new Error("provider down");
  });

  assert.equal(decision, null);
  assert.equal(offersTool(decision, "create_video"), false);
});
