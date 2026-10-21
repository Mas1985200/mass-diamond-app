// tests/images/illustrate.test.ts
// The picture-choosing step: a small model names the subject, free pictures of
// it are fetched. Fake model and fake network only.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlanMessages,
  parsePlan,
  parseTopic,
  picturesOfTopic,
  planTopic,
  prepareIllustration,
} from "../../supabase/functions/ai-chat/images/illustrate.ts";
import type { AIMessage, PhotoItem } from "../../supabase/functions/ai-chat/types.ts";

const signal = new AbortController().signal;

const chat: AIMessage[] = [
  { role: "user", content: "کبد چیه؟" },
  { role: "assistant", content: "کبد بزرگ‌ترین عضو داخلی بدن است." },
  { role: "user", content: "عکسش" },
];

const photo: PhotoItem = {
  src: "https://upload.wikimedia.org/a.jpg",
  title: "Liver",
  license: "CC BY-SA 4.0",
};

test("parseTopic reads the topic line", () => {
  assert.equal(parseTopic("TOPIC: Human liver"), "Human liver");
  assert.equal(parseTopic("topic: \"Golden retriever\"."), "Golden retriever");
  assert.equal(parseTopic("<think>x</think>\nTOPIC: Saffron"), "Saffron");
});

test("parseTopic gives nothing for NONE, noise or empty topics", () => {
  assert.equal(parseTopic("NONE"), "");
  assert.equal(parseTopic(""), "");
  assert.equal(parseTopic("TOPIC:"), "");
  assert.equal(parseTopic("TOPIC: none"), "");
  assert.equal(parseTopic("TOPIC: x"), "");
  assert.equal(parseTopic("Sure, here you go"), "");
});

test("parseTopic limits the length", () => {
  assert.ok(parseTopic(`TOPIC: ${"a".repeat(300)}`).length <= 80);
});

test("the plan request holds the recent chat and the instruction", () => {
  const messages = buildPlanMessages(chat);

  assert.equal(messages[0]?.role, "system");
  assert.match(String(messages[0]?.content), /TOPIC/);
  assert.match(String(messages[1]?.content), /عکسش/);
  assert.match(String(messages[1]?.content), /کبد چیه/);
});

test("planTopic returns the subject the model names", async () => {
  const topic = await planTopic(chat, signal, async () => "TOPIC: Liver");

  assert.deepEqual(topic, { topic: "Liver" });
});

test("planTopic is empty when the model fails or says NONE", async () => {
  assert.equal(await planTopic(chat, signal, async () => null), null);
  assert.equal(await planTopic(chat, signal, async () => "NONE"), null);
  assert.equal(
    await planTopic(chat, signal, async () => {
      throw new Error("down");
    }),
    null,
  );
  assert.equal(await planTopic([], signal, async () => "TOPIC: Liver"), null);
});

test("prepareIllustration fetches pictures of the planned topic", async () => {
  const asked: string[] = [];

  const photos = await prepareIllustration(chat, signal, {
    ask: async () => "TOPIC: Liver",
    pictures: async (plan) => {
      asked.push(plan.topic);

      return [photo];
    },
  });

  assert.deepEqual(asked, ["Liver"]);
  assert.deepEqual(photos, [photo]);
});

test("prepareIllustration does no picture search when there is nothing to show", async () => {
  let searched = false;

  const photos = await prepareIllustration(chat, signal, {
    ask: async () => "NONE",
    pictures: async () => {
      searched = true;

      return [photo];
    },
  });

  assert.equal(searched, false);
  assert.deepEqual(photos, []);
});

test("prepareIllustration never throws", async () => {
  const photos = await prepareIllustration(chat, signal, {
    ask: async () => "TOPIC: Liver",
    pictures: async () => {
      throw new Error("network");
    },
  });

  assert.deepEqual(photos, []);
});

test("parsePlan reads the topic and ignores anything after a bar", () => {
  assert.deepEqual(parsePlan("TOPIC: Diabetes | HEALTH"), { topic: "Diabetes" });
  assert.deepEqual(parsePlan("TOPIC: Human liver"), { topic: "Human liver" });
  assert.equal(parsePlan("NONE"), null);
});

const COMMONS_PAGES = {
  query: {
    pages: [
      {
        title: "File:Liver.jpg",
        imageinfo: [
          {
            mime: "image/jpeg",
            thumburl: "https://upload.wikimedia.org/thumb/liver.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Liver.jpg",
            extmetadata: {
              Artist: { value: "Someone" },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
            },
          },
        ],
      },
    ],
  },
};

const OPENVERSE = {
  results: [
    {
      id: "4bbfe191-1cca-4a07-a76e-ce2c15ce0a2a",
      title: "A saffron field",
      tags: [{ name: "diabetes" }, { name: "liver" }],
      creator: "A. Photographer",
      license: "by",
      license_version: "2.0",
      thumbnail: "https://api.openverse.org/v1/images/4bbfe191-1cca-4a07-a76e-ce2c15ce0a2a/thumb/",
      mature: false,
    },
    {
      id: "aaaaaaaa-1cca-4a07-a76e-ce2c15ce0a2a",
      title: "Not free to reuse",
      license: "by-nc",
      license_version: "2.0",
      thumbnail: "https://api.openverse.org/v1/images/aaaaaaaa-1cca-4a07-a76e-ce2c15ce0a2a/thumb/",
    },
  ],
};

function installNetwork(commons: boolean): { restore: () => void; urls: string[] } {
  const original = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    urls.push(url);

    if (url.startsWith("https://api.openverse.org/")) {
      return new Response(JSON.stringify(OPENVERSE), { status: 200 });
    }

    if (commons && url.includes("generator=search")) {
      return new Response(JSON.stringify(COMMONS_PAGES), { status: 200 });
    }

    if (url.includes("list=search") || url.includes("generator=search")) {
      return new Response(JSON.stringify({ query: { search: [], pages: [] } }), {
        status: 200,
      });
    }

    if (commons && url.includes("commons.wikimedia.org") && url.includes("imageinfo")) {
      return new Response(JSON.stringify(COMMONS_PAGES), { status: 200 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("picturesOfTopic falls back to Openverse when Commons has nothing", async () => {
  const net = installNetwork(false);

  try {
    const photos = await picturesOfTopic({ topic: "Saffron" }, signal);

    assert.equal(photos.length, 1);
    assert.equal(photos[0]?.license, "CC BY 2.0");
    assert.equal(photos[0]?.author, "A. Photographer");
    assert.match(photos[0]?.page ?? "", /^https:\/\/openverse\.org\/image\//);
    assert.ok(net.urls.some((url) => url.startsWith("https://api.openverse.org/")));
  } finally {
    net.restore();
  }
});

test("picturesOfTopic uses Openverse for a medical topic too", async () => {
  const net = installNetwork(false);

  try {
    const photos = await picturesOfTopic({ topic: "Diabetes" }, signal);

    assert.equal(photos.length, 1);
    assert.ok(net.urls.some((url) => url.startsWith("https://api.openverse.org/")));
  } finally {
    net.restore();
  }
});

test("picturesOfTopic fills up from Openverse after Commons", async () => {
  const net = installNetwork(true);

  try {
    const photos = await picturesOfTopic({ topic: "Liver" }, signal);
    const sources = photos.map((photo) => new URL(photo.src).host);

    assert.ok(sources.includes("upload.wikimedia.org"));
    assert.ok(sources.includes("api.openverse.org"));
    assert.ok(photos.length <= 4);
  } finally {
    net.restore();
  }
});
