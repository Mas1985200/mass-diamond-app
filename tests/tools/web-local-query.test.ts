// tests/tools/web-local-query.test.ts
// The model names the language of the place (place_language, required) and may
// also write the second wording itself (local_query, optional). The app
// translates the search when the model did not (retrieval/translate.ts).

import test from "node:test";
import assert from "node:assert/strict";

import { WEB_SEARCH_TOOL } from "../../supabase/functions/ai-chat/tools/definitions.ts";

type Parameters = {
  required?: string[];
  properties: Record<string, { description?: string }>;
};

test("web_search requires the query and the place's language tag", () => {
  const parameters = WEB_SEARCH_TOOL.function.parameters as Parameters;

  assert.ok(parameters.required?.includes("query"));
  assert.ok(parameters.required?.includes("place_language"));
  assert.ok(!parameters.required?.includes("local_query"));
});

test("place_language and local_query descriptions tell the model what to write", () => {
  const parameters = WEB_SEARCH_TOOL.function.parameters as Parameters;
  const tag = parameters.properties.place_language?.description ?? "";
  const local = parameters.properties.local_query?.description ?? "";

  assert.match(tag, /language tag/);
  assert.match(tag, /fa for Iran/);
  assert.match(local, /main language of that country or place/);
});
