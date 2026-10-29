// tests/chat/sources-card.test.ts
// Behavior tests for src/components/chat/sourcesCard.ts.
// The card comes from the server as data; nothing in it is trusted.

import test from "node:test";
import assert from "node:assert/strict";

import {
  hostOf,
  MAX_SOURCES,
  parseSourcesCard,
} from "../../src/components/chat/sourcesCard.ts";

test("hostOf: the name shown comes from the address, without www", () => {
  assert.equal(hostOf("https://www.example.com/a/b?x=1"), "example.com");
  assert.equal(hostOf("http://news.example.org/x"), "news.example.org");
  assert.equal(hostOf("javascript:alert(1)"), null);
  assert.equal(hostOf("ftp://example.com/file"), null);
  assert.equal(hostOf("not an address"), null);
});

test("parseSourcesCard: keeps real addresses and takes the host from the address", () => {
  const card = parseSourcesCard({
    t: "sources",
    lang: "fa",
    items: [
      {
        url: "https://www.news-a.com/world/1",
        host: "evil.example",
        title: "Story",
      },
      { url: "http://news-b.org/2", host: "news-b.org" },
    ],
  });

  assert.deepEqual(card, {
    t: "sources",
    lang: "fa",
    items: [
      { url: "https://www.news-a.com/world/1", host: "news-a.com", title: "Story" },
      { url: "http://news-b.org/2", host: "news-b.org", title: "" },
    ],
  });
});

test("parseSourcesCard: drops dangerous or malformed addresses", () => {
  const card = parseSourcesCard({
    t: "sources",
    lang: "en",
    items: [
      { url: "javascript:alert(1)", host: "x", title: "bad" },
      { url: "data:text/html,<b>x</b>", host: "x", title: "bad" },
      { url: "https://example.com/a b", host: "x", title: "space" },
      { url: 'https://example.com/"onmouseover="x', host: "x", title: "quote" },
      { url: 42, host: "x", title: "number" },
      "not an object",
      { url: "https://good.example/ok", host: "good.example", title: "Good" },
    ],
  });

  assert.deepEqual(card?.items, [
    { url: "https://good.example/ok", host: "good.example", title: "Good" },
  ]);
});

test("parseSourcesCard: one entry per site and at most the limit", () => {
  const items = [
    { url: "https://same.example/1", title: "one" },
    { url: "https://www.same.example/2", title: "two" },
    ...Array.from({ length: 8 }, (_, index) => ({
      url: `https://site${index}.example/p`,
      title: `t${index}`,
    })),
  ];

  const card = parseSourcesCard({ t: "sources", lang: "fa", items });

  assert.equal(card?.items.length, MAX_SOURCES);
  assert.equal(card?.items[0]?.host, "same.example");
  assert.equal(
    new Set(card?.items.map((item) => item.host)).size,
    card?.items.length,
  );
});

test("parseSourcesCard: nothing usable means no card", () => {
  assert.equal(parseSourcesCard({ t: "sources", lang: "fa" }), null);
  assert.equal(parseSourcesCard({ t: "sources", lang: "fa", items: [] }), null);
  assert.equal(
    parseSourcesCard({
      t: "sources",
      lang: "fa",
      items: [{ url: "javascript:alert(1)" }],
    }),
    null,
  );
});

test("parseSourcesCard: the language defaults to Persian", () => {
  assert.equal(
    parseSourcesCard({
      t: "sources",
      lang: "xx",
      items: [{ url: "https://a.example/1" }],
    })?.lang,
    "fa",
  );
  assert.equal(
    parseSourcesCard({
      t: "sources",
      lang: "en",
      items: [{ url: "https://a.example/1" }],
    })?.lang,
    "en",
  );
});
