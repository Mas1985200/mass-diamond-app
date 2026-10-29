// tests/eval/understanding.test.ts
// Measures how well the request-understanding layer decides, not only whether
// the code runs. It covers the parts that need no network: the rule that forces
// the map tool, the tolerance for messy router output, the conversation context
// that follow-ups depend on, and the safe fallback when the router fails.
//
// A case the system gets WRONG today is registered as `todo`: it is counted and
// printed in the baseline, but it never blocks a deploy. When a fix lands, move
// the case from KNOWN_GAPS into the normal list so it stays protected.
// Nothing real is called: the model call is replaced by a fake.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouterMessages,
  isPlaceQuestion,
  parseCapability,
  routeCapability,
  selectTools,
} from "../../supabase/functions/ai-chat/routing/capability.ts";
import type {
  AIMessage,
  ToolDefinition,
} from "../../supabase/functions/ai-chat/types.ts";

type PlaceCase = { readonly text: string; readonly place: boolean };

// Every case states what the user means; `place: true` means the map tool must
// be forced, `place: false` means it must NOT be.
const PLACE_CASES: readonly PlaceCase[] = [
  // Formal and colloquial Persian.
  { text: "زیباشهر کجاست؟", place: true },
  { text: "زیبا شهر کجاس", place: true },
  { text: "برج میلاد کجاست", place: true },
  { text: "میدان آزادی کجایه؟", place: true },
  { text: "کجاست دانشگاه تهران", place: true },
  { text: "آدرس برج میلاد", place: true },
  { text: "لوکیشن کافه نادری", place: true },
  { text: "ایفل کجا هست؟", place: true },
  { text: "برج میلاد کجاسته؟", place: true },
  { text: "برج میلاد کجا هستش", place: true },
  { text: "چیتگر کجاست\nزیباشهر کجاست\nمیدان ونک کجاست", place: true },
  // English.
  { text: "where is the Eiffel Tower", place: true },
  { text: "Where's Shibuya station?", place: true },
  // Must never force the map tool.
  { text: "چرا آسمان آبی است؟", place: false },
  { text: "قیمت دلار امروز چنده", place: false },
  { text: "یک شعر کوتاه برای مادرم بنویس", place: false },
  { text: "how do I reverse a string in python", place: false },
  { text: "what is my IP address", place: false },
  {
    text: "این یک پاراگراف طولانی است. ".repeat(60) + " کجاست",
    place: false,
  },
];

// Cases the rule gets wrong today (measured, see the printed baseline).
const KNOWN_GAPS: readonly PlaceCase[] = [
  // Spelling variant of "آدرس" written without the long alef.
  { text: "ادرس دانشگاه تهران", place: true },
  // Other supported languages.
  { text: "¿dónde está la Torre Eiffel?", place: true },
  { text: "wo ist das Brandenburger Tor?", place: true },
  { text: "Eyfel Kulesi nerede?", place: true },
  { text: "где находится Красная площадь?", place: true },
  // "address" used in a non-place sense.
  { text: "آدرس ایمیل جدید چطور بسازم؟", place: false },
];

for (const item of PLACE_CASES) {
  test(`place rule: ${item.place ? "forces" : "does not force"} the map tool for «${item.text.slice(0, 40)}»`, () => {
    assert.equal(isPlaceQuestion(item.text), item.place);
  });
}

for (const item of KNOWN_GAPS) {
  test(
    `KNOWN GAP place rule: ${item.place ? "should force" : "should not force"} the map tool for «${item.text.slice(0, 40)}»`,
    { todo: true },
    () => {
      assert.equal(isPlaceQuestion(item.text), item.place);
    },
  );
}

test("baseline: place rule score is printed for later comparison", () => {
  const all = [...PLACE_CASES, ...KNOWN_GAPS];
  const correct = all.filter((item) => isPlaceQuestion(item.text) === item.place);

  console.log(
    JSON.stringify({
      event: "baseline",
      suite: "place-rule",
      correct: correct.length,
      total: all.length,
      accuracy: Number((correct.length / all.length).toFixed(3)),
    }),
  );

  assert.ok(correct.length >= PLACE_CASES.length);
});

test("parseCapability: tolerates messy model output", () => {
  assert.equal(parseCapability("FRESH"), "fresh");
  assert.equal(parseCapability("  fresh.\n"), "fresh");
  assert.equal(parseCapability("Label: PLACE"), "place");
  assert.equal(parseCapability("The answer is KNOW because it is science"), "know");
  assert.equal(parseCapability("**TIME**"), "time");
  assert.equal(parseCapability(""), null);
  assert.equal(parseCapability("I am not sure"), null);
  assert.equal(parseCapability("FRESHER"), null);
});

test("router context: a short follow-up carries the earlier messages", () => {
  const messages: AIMessage[] = [
    { role: "user", content: "قیمت دلار چنده؟" },
    { role: "assistant", content: "دلار امروز حدود ... تومان است." },
    { role: "user", content: "و طلا؟" },
  ];

  const built = buildRouterMessages(messages);
  const transcript = String(built[1]?.content);

  assert.ok(transcript.includes("قیمت دلار چنده؟"));
  assert.ok(transcript.includes("و طلا؟"));
  assert.ok(transcript.indexOf("قیمت دلار") < transcript.indexOf("و طلا؟"));
});

test("router context: only the last three messages, each cut to 400 characters", () => {
  const messages: AIMessage[] = [
    { role: "user", content: "OLDEST-MARKER" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
    { role: "assistant", content: "x".repeat(900) },
  ];

  const transcript = String(buildRouterMessages(messages)[1]?.content);

  assert.ok(!transcript.includes("OLDEST-MARKER"));
  assert.ok(!transcript.includes("x".repeat(401)));
  assert.ok(transcript.includes("x".repeat(400)));
});

const fakeTools: ToolDefinition[] = [
  "web_search",
  "get_market_prices",
  "find_place",
  "get_datetime",
  "lookup_knowledge",
  "lookup_medical",
  "remember",
].map((name) => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
})) as ToolDefinition[];

const signal = new AbortController().signal;

test("failure: router error, empty answer, junk answer and timeout all fall back to every tool", async () => {
  const messages: AIMessage[] = [{ role: "user", content: "سلام، حالت چطوره؟" }];

  const behaviours: Array<() => Promise<string | null>> = [
    async () => {
      throw new Error("provider down");
    },
    async () => null,
    async () => "",
    async () => "no idea",
  ];

  for (const behaviour of behaviours) {
    const decision = await routeCapability(messages, signal, behaviour);

    assert.equal(decision, null);
    assert.equal(selectTools(fakeTools, decision).length, fakeTools.length);
  }
});

test("failure: an already stopped request reaches the router already aborted", async () => {
  const stopped = new AbortController();
  stopped.abort();

  let sawAbortedSignal = false;
  const decision = await routeCapability(
    [{ role: "user", content: "hello" }],
    stopped.signal,
    async (_messages, innerSignal) => {
      sawAbortedSignal = innerSignal.aborted;
      return innerSignal.aborted ? null : "CHAT";
    },
  );

  assert.equal(sawAbortedSignal, true);
  assert.equal(decision, null);
});

test("no invented sources: the router gets no tool and no way to answer for the model", () => {
  const built = buildRouterMessages([{ role: "user", content: "hi" }]);

  assert.equal(built.length, 2);
  assert.equal(built[0]?.role, "system");
  assert.ok(String(built[0]?.content).includes("Reply with exactly one word"));
});

test("tool scope: a question of one kind sees only the tools of that kind", () => {
  const names = (kind: Parameters<typeof selectTools>[1]) =>
    selectTools(fakeTools, kind).map((tool) => tool.function.name);

  assert.deepEqual(names("time"), ["get_datetime"]);
  assert.deepEqual(names("place"), ["find_place"]);
  assert.deepEqual(names("fresh").sort(), ["get_market_prices", "web_search"]);
  assert.deepEqual(names("attach"), []);
});
