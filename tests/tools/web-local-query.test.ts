// tests/tools/web-local-query.test.ts
// The model always writes the place's own language for a web search. The app
// then repeats a thin search in that language (see tools/web.ts), so this field
// must never be left out.

import test from "node:test";
import assert from "node:assert/strict";

import { WEB_SEARCH_TOOL } from "../../supabase/functions/ai-chat/tools/definitions.ts";

test("web_search asks for both the query and the place's own language", () => {
  const parameters = WEB_SEARCH_TOOL.function.parameters as {
    required?: string[];
    properties: Record<string, { description?: string }>;
  };

  assert.ok(parameters.required?.includes("query"));
  assert.ok(parameters.required?.includes("local_query"));
});

test("the local_query description tells the model what to write", () => {
  const parameters = WEB_SEARCH_TOOL.function.parameters as {
    properties: Record<string, { description?: string }>;
  };
  const text = parameters.properties.local_query?.description ?? "";

  assert.match(text, /main language of the country or place/);
  assert.match(text, /same as query/i);
  assert.doesNotMatch(text, /^Optional/);
});
