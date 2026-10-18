// tests/images/tools-photos.test.ts
// Credited pictures in the knowledge tool and (only on request) the medical tool.

import test from "node:test";
import assert from "node:assert/strict";

import { runKnowledgeLookup } from "../../supabase/functions/ai-chat/tools/knowledge.ts";
import {
  clearMedicalCache,
  runMedicalLookup,
} from "../../supabase/functions/ai-chat/tools/medical.ts";
import type { CardPayload, ToolContext } from "../../supabase/functions/ai-chat/types.ts";

const context: ToolContext = {
  now: new Date("2026-10-17T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: undefined,
  memory: null,
};

const signal = new AbortController().signal;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function fileInfo(title: string, license: string, artist: string): Record<string, unknown> {
  const name = title.replace(/^File:/, "").replace(/ /g, "_");

  return {
    title,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/640px-${name}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/${title.replace(/ /g, "_")}`,
        mime: "image/jpeg",
        extmetadata: { LicenseShortName: { value: license }, Artist: { value: artist } },
      },
    ],
  };
}

type Setup = {
  readonly commonsOk: boolean;
};

function network(setup: Setup): (url: string) => Response {
  return (url) => {
    if (url.includes("/page/media-list/")) {
      return json({
        items: [
          { type: "image", title: "File:Saturn from Cassini.jpg" },
          { type: "image", title: "File:Saturn diagram.svg" },
        ],
      });
    }

    if (url.includes("commons.wikimedia.org/w/api.php")) {
      // Like the real service, only the files that were asked for come back.
      const asked = (new URL(url).searchParams.get("titles") ?? "").split("|");
      const all = [
        fileInfo("File:Saturn from Cassini.jpg", "Public domain", ""),
        fileInfo("File:Saturn diagram.svg", "CC BY-SA 4.0", "Zed"),
      ];

      return setup.commonsOk
        ? json({ query: { pages: all.filter((page) => asked.includes(String(page.title))) } })
        : new Response("down", { status: 503 });
    }

    if (url.includes("prop=extracts") && url.includes("exintro")) {
      return json({
        query: {
          pages: [{ title: "Saturn", index: 1, extract: "Saturn is the sixth planet from the Sun." }],
        },
      });
    }

    if (url.includes("prop=extracts")) {
      return json({
        query: { pages: [{ title: "Saturn", extract: "Saturn is the sixth planet from the Sun and a gas giant with rings." }] },
      });
    }

    if (url.includes("list=search")) {
      return json({ query: { search: [{ title: "Migraine" }] } });
    }

    if (url.includes("wsearch.nlm.nih.gov")) {
      return new Response(
        '<nlmSearchResult><list><document rank="0" url="https://medlineplus.gov/migraine.html">' +
          '<content name="title">Migraine</content>' +
          '<content name="FullSummary">&lt;p&gt;A migraine is a headache that can cause severe throbbing pain.&lt;/p&gt;</content>' +
          "</document></list></nlmSearchResult>",
        { status: 200 },
      );
    }

    return new Response("unexpected", { status: 404 });
  };
}

function install(setup: Setup): { readonly urls: string[]; readonly restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const route = network(setup);

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    urls.push(url);

    return route(url);
  }) as typeof fetch;

  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function photoCard(cards: readonly CardPayload[] | undefined): Extract<CardPayload, { t: "photos" }> | null {
  const card = cards?.find((item) => item.t === "photos");

  return card && card.t === "photos" ? card : null;
}

test("lookup_knowledge: a photo card with author and license follows the answer data", async () => {
  const net = install({ commonsOk: true });

  try {
    const outcome = await runKnowledgeLookup({ query: "Saturn", focus: "rings" }, context, signal);
    const card = photoCard(outcome.cards);

    assert.ok(card);
    assert.equal(card.items.length, 1);
    assert.equal(card.items[0]?.license, "Public domain");
    assert.ok(card.items[0]?.page?.startsWith("https://commons.wikimedia.org/wiki/"));
    assert.ok(!JSON.stringify(outcome.data).includes("upload.wikimedia.org"));
  } finally {
    net.restore();
  }
});

test("lookup_knowledge: when Commons is down the answer still comes, without a card", async () => {
  const net = install({ commonsOk: false });

  try {
    const outcome = await runKnowledgeLookup({ query: "Saturn" }, context, signal);

    assert.equal(outcome.cards, undefined);
    assert.ok(JSON.stringify(outcome.data).includes("sixth planet"));
  } finally {
    net.restore();
  }
});

test("lookup_medical: no picture request, no picture lookup at all", async () => {
  clearMedicalCache();

  const net = install({ commonsOk: true });

  try {
    const outcome = await runMedicalLookup({ query: "migraine" }, context, signal);

    assert.equal(outcome.cards, undefined);
    assert.ok(net.urls.every((url) => !url.includes("commons.wikimedia.org") && !url.includes("media-list")));
  } finally {
    net.restore();
  }
});

test("lookup_medical: images=true gives credited diagrams only", async () => {
  clearMedicalCache();

  const net = install({ commonsOk: true });

  try {
    const outcome = await runMedicalLookup({ query: "migraine", images: true }, context, signal);
    const card = photoCard(outcome.cards);

    assert.ok(card);
    assert.equal(card.items.length, 1);
    assert.equal(card.items[0]?.title, "Saturn diagram");
    assert.equal(card.items[0]?.author, "Zed");

    const commons = net.urls.find((url) => url.includes("commons.wikimedia.org"));

    assert.ok(!commons?.includes("Cassini"));
  } finally {
    net.restore();
  }
});

test("lookup_medical: images=true but none free: the model is told to say so", async () => {
  clearMedicalCache();

  const net = install({ commonsOk: false });

  try {
    const outcome = await runMedicalLookup({ query: "migraine", images: true }, context, signal);
    const data = outcome.data as { note: string };

    assert.equal(outcome.cards, undefined);
    assert.ok(data.note.includes("No freely licensed diagram was found"));
  } finally {
    net.restore();
  }
});
