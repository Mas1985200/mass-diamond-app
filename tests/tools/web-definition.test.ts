// tests/tools/web-definition.test.ts
// The web_search schema lives in its own file and is still offered to the
// model; place_language carries examples so that the app knows which language
// to search in when the first search finds too little.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolDefinitions,
  WEB_SEARCH_TOOL,
} from "../../supabase/functions/ai-chat/tools/definitions.ts";
import { WEB_SEARCH_TOOL as FROM_OWN_FILE } from "../../supabase/functions/ai-chat/tools/web-definition.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
};

test("definitions.ts still exports the same web_search tool", () => {
  assert.equal(WEB_SEARCH_TOOL, FROM_OWN_FILE);
});

test("web_search is offered when a search key exists, and only then", () => {
  const names = (ctx: ToolContext): string[] =>
    buildToolDefinitions(ctx).map((tool) => tool.function.name);

  assert.ok(names(context).includes("web_search"));
  assert.ok(!names({ ...context, tavilyKey: undefined }).includes("web_search"));
});

test("place_language has examples and says when to use the answer language", () => {
  const parameters = WEB_SEARCH_TOOL.function.parameters as {
    properties: Record<string, { description?: string }>;
  };
  const text = parameters.properties.place_language?.description ?? "";

  assert.match(text, /fa for Iran/);
  assert.match(text, /tr for Turkey/);
  assert.match(text, /ja for Japan/);
  assert.match(text, /not about a particular country/);
});
