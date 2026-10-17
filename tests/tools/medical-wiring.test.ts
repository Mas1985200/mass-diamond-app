// tests/tools/medical-wiring.test.ts
// lookup_medical is connected to the rest of the function: the tool list, the
// router's tool table, the first model round, the prompt and the dispatcher.

import test from "node:test";
import assert from "node:assert/strict";

import { firstRoundOptions } from "../../supabase/functions/ai-chat/agent.ts";
import { buildSystemPrompt } from "../../supabase/functions/ai-chat/prompt/system.ts";
import {
  selectTools,
  TOOLS_BY_CAPABILITY,
  type Capability,
} from "../../supabase/functions/ai-chat/routing/capability.ts";
import { buildToolDefinitions } from "../../supabase/functions/ai-chat/tools/definitions.ts";
import { clearMedicalCache } from "../../supabase/functions/ai-chat/tools/medical.ts";
import { executeTool } from "../../supabase/functions/ai-chat/tools/registry.ts";
import type {
  AIMessage,
  ToolContext,
  ToolDefinition,
} from "../../supabase/functions/ai-chat/types.ts";

const context: ToolContext = {
  now: new Date("2026-10-17T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "fa",
  tavilyKey: undefined,
  memory: null,
};

const say = (text: string): AIMessage[] => [{ role: "user", content: text }];

function names(tools: readonly ToolDefinition[]): string[] {
  return tools.map((tool) => tool.function.name);
}

test("the tool list always offers lookup_medical, with no key needed", () => {
  const tools = buildToolDefinitions(context);
  const medical = tools.find((tool) => tool.function.name === "lookup_medical");

  assert.ok(medical);
  assert.deepEqual(medical.function.parameters.required, ["query"]);

  const properties = medical.function.parameters.properties as Record<string, unknown>;

  assert.deepEqual(Object.keys(properties).sort(), ["focus", "query", "research"]);
});

test("health topics are pointed at lookup_medical, not lookup_knowledge", () => {
  const tools = buildToolDefinitions(context);
  const knowledge = tools.find((tool) => tool.function.name === "lookup_knowledge");

  assert.ok(knowledge);
  assert.ok(knowledge.function.description.includes("use lookup_medical"));
});

test("know offers both lookup tools; other kinds of question offer neither", () => {
  assert.deepEqual(TOOLS_BY_CAPABILITY.know, ["lookup_knowledge", "lookup_medical"]);

  const tools = buildToolDefinitions({ ...context, tavilyKey: "k" });

  assert.deepEqual(names(selectTools(tools, "know")), ["lookup_knowledge", "lookup_medical"]);

  for (const capability of ["chat", "fresh", "place", "time"] as const) {
    assert.ok(!names(selectTools(tools, capability)).includes("lookup_medical"));
  }

  assert.ok(names(selectTools(tools, null)).includes("lookup_medical"));
});

test("first round for know: both lookup tools, one of them required", () => {
  const tools = selectTools(buildToolDefinitions(context), "know");
  const options = firstRoundOptions(say("علائم دیابت چیست"), tools, "know");

  assert.ok(options);
  assert.equal(options.toolChoice, "required");
  assert.deepEqual(names(options.tools), ["lookup_knowledge", "lookup_medical"]);
});

test("the prompt carries the medical rules for know and leaves them out for time", () => {
  const know = buildSystemPrompt(context, undefined, "know");
  const time = buildSystemPrompt(context, undefined, "time");

  assert.ok(know.includes("- lookup_medical:"));
  assert.ok(know.includes("naming MedlinePlus"));
  assert.ok(!time.includes("- lookup_medical:"));

  // The safety rules are there whatever the kind of question.
  for (const capability of [null, "chat", "know", "fresh", "place", "time"] as const) {
    assert.ok(
      buildSystemPrompt(context, undefined, capability as Capability | null).includes(
        "Emergency first",
      ),
    );
  }
});

test("executeTool: lookup_medical runs, and the log counts the topics, not the text", async () => {
  clearMedicalCache();

  const xml =
    '<?xml version="1.0"?><nlmSearchResult><list num="1" start="0" per="3">' +
    '<document rank="0" url="https://medlineplus.gov/migraine.html">' +
    '<content name="title">Migraine</content>' +
    '<content name="FullSummary">&lt;p&gt;A migraine is a headache that can cause severe throbbing pain, usually on one side of the head.&lt;/p&gt;</content>' +
    "</document></list></nlmSearchResult>";

  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const lines: string[] = [];

  globalThis.fetch = (async () => new Response(xml, { status: 200 })) as typeof fetch;
  console.log = (...parts: unknown[]) => {
    lines.push(parts.join(" "));
  };

  try {
    const secret = "my private migraine question 98765";
    const outcome = await executeTool(
      "lookup_medical",
      JSON.stringify({ query: "migraine", focus: secret }),
      context,
      new AbortController().signal,
    );
    const data = outcome.data as { topics: { title: string }[] };

    assert.equal(data.topics[0]?.title, "Migraine");

    const entry = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;

    assert.equal(entry.event, "tool");
    assert.equal(entry.name, "lookup_medical");
    assert.equal(entry.ok, true);
    assert.equal(entry.results, 1);
    assert.ok(!lines.join("\n").includes(secret));
    assert.ok(!lines.join("\n").includes("migraine question"));
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
