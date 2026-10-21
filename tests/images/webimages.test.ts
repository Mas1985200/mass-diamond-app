// tests/images/webimages.test.ts
// Pictures found on the web: only described, topic-matching, secure pictures
// that link back to their page are kept. The fixture follows the documented
// Tavily response shape and is NOT checked against the live service.

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseWebImages,
  searchWebImages,
} from "../../supabase/functions/ai-chat/images/webimages.ts";

const signal = new AbortController().signal;

const ANSWER = {
  results: [
    {
      url: "https://www.example.org/wildlife/brown-bear",
      images: [
        { url: "https://www.example.org/img/bear1.jpg", description: "Brown bear in a river" },
        { url: "https://www.example.org/img/chart.jpg", description: "Stock market chart" },
        { url: "https://www.example.org/img/nodesc.jpg" },
        { url: "https://www.example.org/img/bear.gif", description: "Brown bear animation" },
        { url: "http://www.example.org/img/plain.jpg", description: "Brown bear not secure" },
        { url: "https://www.shutterstock.com/img/bear.jpg", description: "Brown bear stock" },
      ],
    },
  ],
  images: [
    { url: "https://cdn.other.net/photos/bear2.jpg", description: "A brown bear cub" },
    { url: "https://www.example.org/img/bear1.jpg", description: "Brown bear in a river" },
  ],
};

function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const globals = globalThis as unknown as { Deno?: unknown };
  const original = globals.Deno;

  globals.Deno = {
    env: { get: (name: string) => (name === "TAVILY_API_KEY" ? key : undefined) },
  };

  return run().finally(() => {
    globals.Deno = original;
  });
}

test("only described, secure pictures that name the topic are kept", () => {
  const items = parseWebImages(ANSWER, "Brown bear");

  assert.deepEqual(
    items.map((item) => item.src),
    [
      "https://www.example.org/img/bear1.jpg",
      "https://cdn.other.net/photos/bear2.jpg",
    ],
  );
});

test("a web picture is marked Web and links back to its page", () => {
  const [first, second] = parseWebImages(ANSWER, "Brown bear");

  assert.equal(first?.license, "Web");
  assert.equal(first?.author, "example.org");
  assert.equal(first?.page, "https://www.example.org/wildlife/brown-bear");
  assert.equal(second?.author, "cdn.other.net");
  assert.equal(second?.page, undefined);
});

test("junk input is safe", () => {
  assert.deepEqual(parseWebImages(null, "bear"), []);
  assert.deepEqual(parseWebImages({ results: "x", images: 3 }, "bear"), []);
  assert.deepEqual(parseWebImages({ images: [null, 5, {}] }, "bear"), []);
});

test("without a Tavily key nothing is asked", async () => {
  const original = globalThis.fetch;
  let asked = false;

  globalThis.fetch = (async () => {
    asked = true;

    return new Response("{}");
  }) as typeof fetch;

  try {
    assert.deepEqual(await withKey(undefined, () => searchWebImages("bear", 4, signal)), []);
    assert.equal(asked, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("the search asks Tavily for images with descriptions", async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  let header = "";

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    header = String((init?.headers as Record<string, string>).Authorization);

    return new Response(JSON.stringify(ANSWER), { status: 200 });
  }) as typeof fetch;

  try {
    const items = await withKey("tv-key", () => searchWebImages("Brown bear", 1, signal));

    assert.equal(header, "Bearer tv-key");
    assert.equal(body.include_images, true);
    assert.equal(body.include_image_descriptions, true);
    assert.equal(items.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("an error from Tavily gives nothing and never throws", async () => {
  const original = globalThis.fetch;

  globalThis.fetch = (async () => new Response("no", { status: 429 })) as typeof fetch;

  try {
    assert.deepEqual(await withKey("k", () => searchWebImages("bear", 4, signal)), []);
  } finally {
    globalThis.fetch = original;
  }
});
