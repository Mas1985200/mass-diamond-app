// tests/images/openverse.test.ts
// Openverse results: only licenses that allow showing the picture are kept.
// The fixture follows the documented API shape and is NOT checked against the
// live service.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenverseUrl,
  parseOpenverse,
} from "../../supabase/functions/ai-chat/images/openverse.ts";

const THUMB = "https://api.openverse.org/v1/images/4bbfe191-1cca-4a07-a76e-ce2c15ce0a2a/thumb/";

function result(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "4bbfe191-1cca-4a07-a76e-ce2c15ce0a2a",
    title: "Title",
    creator: "Author",
    license: "by-sa",
    license_version: "4.0",
    thumbnail: THUMB,
    mature: false,
    ...over,
  };
}

test("a free picture keeps author, license and links", () => {
  const [item] = parseOpenverse({ results: [result({})] });

  assert.equal(item?.src, THUMB);
  assert.equal(item?.author, "Author");
  assert.equal(item?.license, "CC BY-SA 4.0");
  assert.equal(item?.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
  assert.equal(
    item?.page,
    "https://openverse.org/image/4bbfe191-1cca-4a07-a76e-ce2c15ce0a2a",
  );
});

test("CC0 and public domain are kept", () => {
  const items = parseOpenverse({
    results: [
      result({ license: "cc0", license_version: "1.0" }),
      result({ id: "bbbbbbbb-1cca-4a07-a76e-ce2c15ce0a2a", license: "pdm", license_version: "1.0" }),
    ],
  });

  assert.deepEqual(
    items.map((item) => item.license),
    ["CC0 1.0", "Public Domain"],
  );
});

test("non-commercial, no-derivatives, mature and foreign hosts are dropped", () => {
  const items = parseOpenverse({
    results: [
      result({ license: "by-nc" }),
      result({ license: "by-nd" }),
      result({ mature: true }),
      result({ thumbnail: "https://evil.example/x.jpg" }),
      result({ id: "../bad" }),
      result({ license: "by", license_version: "" }),
    ],
  });

  assert.deepEqual(items, []);
});

test("the same picture is not listed twice and junk input is safe", () => {
  assert.equal(parseOpenverse({ results: [result({}), result({})] }).length, 1);
  assert.deepEqual(parseOpenverse(null), []);
  assert.deepEqual(parseOpenverse({ results: "x" }), []);
});

test("the search asks for reusable, non-mature photographs", () => {
  const url = buildOpenverseUrl("  Saffron   crocus ");
  const params = new URL(url).searchParams;

  assert.equal(params.get("q"), "Saffron crocus");
  assert.equal(params.get("license_type"), "commercial,modification");
  assert.equal(params.get("mature"), "false");
});
