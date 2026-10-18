// tests/images/medical-filter.test.ts
// Medical photographs (filed under disease, patient or clinical categories on
// Commons) are never shown outside diagram mode, whatever tool asked; and the
// model is told when pictures are shown.

import test from "node:test";
import assert from "node:assert/strict";

import { parseCommonsImages } from "../../supabase/functions/ai-chat/images/commons.ts";
import { executeTool } from "../../supabase/functions/ai-chat/tools/registry.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

function page(title: string, categories: readonly string[]): Record<string, unknown> {
  const name = title.replace(/^File:/, "").replace(/ /g, "_");

  return {
    title,
    categories: categories.map((category) => ({ title: `Category:${category}` })),
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/640px-${name}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/${title.replace(/ /g, "_")}`,
        mime: "image/jpeg",
        extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "Ann" } },
      },
    ],
  };
}

const ANSWER = {
  query: {
    pages: [
      page("File:Hands.jpg", ["Hands", "Diseases of the endocrine system"]),
      page("File:Gland.jpg", ["Endocrine glands", "Human anatomy"]),
      page("File:Wound.jpg", ["Wounds and injuries"]),
      page("File:Dog.jpg", ["Dogs"]),
      page("File:Plain.jpg", []),
    ],
  },
};

test("parseCommonsImages: medical photographs are dropped by their categories", () => {
  assert.deepEqual(
    parseCommonsImages(ANSWER, []).map((item) => item.title).sort(),
    ["Dog", "Gland", "Plain"],
  );
});

test("parseCommonsImages: diagram mode keeps files in medical categories", () => {
  assert.equal(parseCommonsImages(ANSWER, [], { allowMedical: true }).length, 5);
});

test("executeTool: a result with pictures tells the model they are shown", async () => {
  const context: ToolContext = {
    now: new Date("2026-10-17T10:00:00Z"),
    timeZone: "UTC",
    location: null,
    lang: "en",
    tavilyKey: undefined,
    memory: null,
  };
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    if (url.includes("/page/media-list/")) {
      return new Response(JSON.stringify({ items: [{ type: "image", title: "File:Dog.jpg" }] }), { status: 200 });
    }

    if (url.includes("commons.wikimedia.org")) {
      return new Response(JSON.stringify({ query: { pages: [page("File:Dog.jpg", ["Dogs"])] } }), { status: 200 });
    }

    if (url.includes("prop=extracts")) {
      return new Response(
        JSON.stringify({ query: { pages: [{ title: "Dog", index: 1, extract: "The dog is a domesticated descendant of the wolf." }] } }),
        { status: 200 },
      );
    }

    if (url.includes("list=search")) {
      return new Response(JSON.stringify({ query: { search: [{ title: "Dog" }] } }), { status: 200 });
    }

    return new Response("x", { status: 404 });
  }) as typeof fetch;

  try {
    const outcome = await executeTool(
      "lookup_knowledge",
      JSON.stringify({ query: "dog" }),
      context,
      new AbortController().signal,
    );
    const data = outcome.data as { pictures?: string };

    assert.ok(outcome.cards?.some((card) => card.t === "photos"));
    assert.ok(data.pictures?.includes("already shown"));
  } finally {
    globalThis.fetch = original;
  }
});
