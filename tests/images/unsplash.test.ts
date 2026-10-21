// tests/images/unsplash.test.ts
// Unsplash results: credit, license and links are kept, unrelated photos are
// dropped, and without a key nothing is asked. The fixture follows the
// documented API shape and is NOT checked against the live service.

import test from "node:test";
import assert from "node:assert/strict";

import { picturesOfTopic } from "../../supabase/functions/ai-chat/images/illustrate.ts";
import {
  buildUnsplashUrl,
  parseUnsplash,
  searchUnsplash,
} from "../../supabase/functions/ai-chat/images/unsplash.ts";
import { describesTopic } from "../../supabase/functions/ai-chat/images/topic-match.ts";

const signal = new AbortController().signal;

function photo(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "abc",
    alt_description: "a brown bear walking in a forest",
    urls: { small: "https://images.unsplash.com/photo-1?w=400&ixid=x" },
    links: { html: "https://unsplash.com/photos/abc" },
    user: { name: "Jane Doe" },
    ...over,
  };
}

function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const original = globals.Deno;

  globals.Deno = {
    env: { get: (name: string) => (name === "UNSPLASH_ACCESS_KEY" ? key : undefined) },
  };

  return run().finally(() => {
    globals.Deno = original;
  });
}

test("a photo keeps its photographer, license and Unsplash page", () => {
  const [item] = parseUnsplash({ results: [photo({})] }, "Brown bear");

  assert.equal(item?.src, "https://images.unsplash.com/photo-1?w=400&ixid=x");
  assert.equal(item?.author, "Jane Doe");
  assert.equal(item?.license, "Unsplash License");
  assert.equal(item?.licenseUrl, "https://unsplash.com/license");
  assert.match(item?.page ?? "", /^https:\/\/unsplash\.com\/photos\/abc\?utm_source=/);
});

test("foreign hosts, foreign pages, duplicates and junk are dropped", () => {
  const items = parseUnsplash({
    results: [
      photo({ urls: { small: "https://evil.example/x.jpg" } }),
      photo({ links: { html: "https://evil.example/photos/1" } }),
      photo({}),
      photo({}),
      null,
      5,
      { urls: 3 },
    ],
  });

  assert.equal(items.length, 1);
  assert.deepEqual(parseUnsplash(null), []);
  assert.deepEqual(parseUnsplash({ results: "x" }), []);
});

test("a described photo must name the topic; an undescribed one is accepted", () => {
  assert.equal(describesTopic("A brown bear walking", "Brown bear", true), true);
  assert.equal(describesTopic("A teddy toy on a shelf", "Brown bear", true), false);
  assert.equal(describesTopic("", "Brown bear", true), false);
  assert.equal(describesTopic("", "Brown bear", false), true);
  assert.equal(describesTopic("Anything", "", false), true);
  assert.deepEqual(
    parseUnsplash({ results: [photo({ alt_description: "a stock chart on a screen" })] }, "Bear"),
    [],
  );
});

test("the search asks for safe landscape photos", () => {
  const params = new URL(buildUnsplashUrl("  Brown   bear ")).searchParams;

  assert.equal(params.get("query"), "Brown bear");
  assert.equal(params.get("orientation"), "landscape");
  assert.equal(params.get("content_filter"), "high");
});

test("without a key nothing is asked", async () => {
  const original = globalThis.fetch;
  let asked = false;

  globalThis.fetch = (async () => {
    asked = true;

    return new Response("{}");
  }) as typeof fetch;

  try {
    assert.deepEqual(await withKey(undefined, () => searchUnsplash("bear", 4, signal)), []);
    assert.equal(asked, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("with a key the key is sent in the Authorization header", async () => {
  const original = globalThis.fetch;
  let header = "";

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    header = String((init?.headers as Record<string, string>).Authorization);

    return new Response(JSON.stringify({ results: [photo({})] }), { status: 200 });
  }) as typeof fetch;

  try {
    const items = await withKey("secret", () => searchUnsplash("Brown bear", 4, signal));

    assert.equal(header, "Client-ID secret");
    assert.equal(items.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("an error from Unsplash gives nothing and never throws", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () => new Response("no", { status: 403 })) as typeof fetch;

  try {
    assert.deepEqual(await withKey("k", () => searchUnsplash("bear", 4, signal)), []);
  } finally {
    globalThis.fetch = original;
  }
});

test("picturesOfTopic mixes the article's photos and Unsplash", async () => {
  const original = globalThis.fetch;
  const article = (name: string) => ({
    title: `File:${name}.jpg`,
    imageinfo: [
      {
        mime: "image/jpeg",
        thumburl: `https://upload.wikimedia.org/thumb/${name}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
        extmetadata: {
          Artist: { value: "Someone" },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
        },
      },
    ],
  });

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    if (url.startsWith("https://api.unsplash.com/")) {
      return new Response(
        JSON.stringify({
          results: [2, 3, 4].map((n) =>
            photo({
              urls: { small: `https://images.unsplash.com/photo-${n}` },
              links: { html: `https://unsplash.com/photos/p${n}` },
            }),
          ),
        }),
      );
    }

    if (url.includes("titles=Brown+bear&")) {
      return new Response(JSON.stringify({ query: { pages: [{ title: "Brown bear" }] } }));
    }

    if (url.includes("prop=pageimages")) {
      return new Response(JSON.stringify({ query: { pages: [{ pageimage: "Lead.jpg" }] } }));
    }

    if (url.includes("/page/media-list/")) {
      return new Response(
        JSON.stringify({
          items: ["Lead", "Second", "Third"].map((name) => ({
            type: "image",
            title: `File:${name}.jpg`,
          })),
        }),
      );
    }

    if (url.includes("commons.wikimedia.org") && url.includes("imageinfo")) {
      return new Response(
        JSON.stringify({
          query: { pages: [article("Lead"), article("Second"), article("Third")] },
        }),
      );
    }

    return new Response(JSON.stringify({}));
  }) as typeof fetch;

  try {
    const photos = await withKey("k", () => picturesOfTopic({ topic: "Brown bear" }, signal));
    const hosts = photos.map((item) => new URL(item.src).host);

    assert.equal(photos.length, 4);
    assert.deepEqual(hosts, [
      "upload.wikimedia.org",
      "upload.wikimedia.org",
      "images.unsplash.com",
      "images.unsplash.com",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
