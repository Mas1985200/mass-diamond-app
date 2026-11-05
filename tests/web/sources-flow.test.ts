import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SOURCES,
  TOPICS,
  preferredDomains,
} from "../../supabase/functions/ai-chat/retrieval/sources.ts";

test("a country and field give that field's sites", () => {
  const list = preferredDomains("IR", "sports");

  assert.ok(list?.includes("varzesh3.com"));
});

test("a field the country has no list for uses its general list", () => {
  assert.deepEqual(preferredDomains("TR", "health"), SOURCES.TR.general);
});

test("codes are case-insensitive and aliases work", () => {
  assert.deepEqual(preferredDomains("uk", "general"), SOURCES.GB.general);
  assert.deepEqual(preferredDomains(" ir ", "sports"), preferredDomains("IR", "sports"));
});

test("an unknown topic falls back to general", () => {
  assert.deepEqual(preferredDomains("DE", "nonsense"), SOURCES.DE.general);
});

test("unknown or missing country gives null", () => {
  assert.equal(preferredDomains("ZZ", "sports"), null);
  assert.equal(preferredDomains(undefined, "sports"), null);
  assert.equal(preferredDomains(5, "sports"), null);
});

test("every list is short, bare host names, no duplicates", () => {
  for (const [country, sources] of Object.entries(SOURCES)) {
    for (const topic of TOPICS) {
      const list = sources[topic] ?? [];

      assert.ok(list.length <= 12, `${country}/${topic} too long`);
      assert.equal(new Set(list).size, list.length, `${country}/${topic} duplicates`);

      for (const site of list) {
        assert.match(site, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${country}/${topic}: ${site}`);
      }
    }
  }
});
