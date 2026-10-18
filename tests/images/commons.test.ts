// tests/images/commons.test.ts
// Wikimedia Commons answers, the article picture list and the whole chain, with
// a fake network. Fixtures follow the documented MediaWiki API shapes; they are
// NOT checked against the live service from this environment.

import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchArticleFileTitles,
  findArticleTitle,
  isRelatedTitle,
  isUsableFile,
  parseMediaList,
} from "../../supabase/functions/ai-chat/images/article.ts";
import {
  buildCommonsUrl,
  normalizeFileTitle,
  parseCommonsImages,
} from "../../supabase/functions/ai-chat/images/commons.ts";
import {
  fetchLicensedPhotos,
  fetchLicensedPhotosForTopic,
} from "../../supabase/functions/ai-chat/images/photos.ts";

type FakeCall = { readonly url: string };

function fakeFetch(respond: (call: FakeCall) => Response): {
  readonly calls: FakeCall[];
  readonly restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FakeCall[] = [];

  globalThis.fetch = (async (input: unknown) => {
    const call = { url: String(input) };

    calls.push(call);

    return respond(call);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const signal = new AbortController().signal;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function info(options: {
  readonly title: string;
  readonly license?: string;
  readonly artist?: string;
  readonly extra?: Readonly<Record<string, string>>;
  readonly mime?: string;
  readonly thumb?: string;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const values: Record<string, string> = {
    ...(options.license ? { LicenseShortName: options.license } : {}),
    ...(options.artist ? { Artist: options.artist } : {}),
    ...(options.extra ?? {}),
  };

  for (const [key, value] of Object.entries(values)) {
    meta[key] = { value };
  }

  const name = options.title.replace(/^File:/, "").replace(/ /g, "_");

  return {
    title: options.title,
    imageinfo: [
      {
        thumburl:
          options.thumb ?? `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/640px-${name}`,
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/${options.title.replace(/ /g, "_")}`,
        mime: options.mime ?? "image/jpeg",
        extmetadata: meta,
      },
    ],
  };
}

const MEDIA_LIST = {
  items: [
    { type: "image", title: "File:Flag of Peru.svg" },
    { type: "image", title: "File:Machu Picchu 2.jpg" },
    { type: "image", title: "File:Machu_Picchu_2.jpg" },
    { type: "image", title: "File:Heart diagram.svg" },
    { type: "video", title: "File:Clip.webm" },
    { type: "image", title: "File:Commons-logo.svg" },
    { type: "image", title: "File:Llama.jpg" },
  ],
};

test("isUsableFile: logos and flags never; vector files only as diagrams", () => {
  assert.equal(isUsableFile("File:Flag of Peru.jpg", { diagramsOnly: false }), false);
  assert.equal(isUsableFile("File:Heart diagram.svg", { diagramsOnly: false }), false);
  assert.equal(isUsableFile("File:Llama.jpg", { diagramsOnly: false }), true);
  assert.equal(isUsableFile("File:Heart diagram.svg", { diagramsOnly: true }), true);
  assert.equal(isUsableFile("File:Heart anatomy.png", { diagramsOnly: true }), true);
  assert.equal(isUsableFile("File:Rash on arm.jpg", { diagramsOnly: true }), false);
});

test("parseMediaList: images only, no duplicates, skipped patterns removed", () => {
  assert.deepEqual(parseMediaList(MEDIA_LIST, { diagramsOnly: false }), [
    "File:Machu Picchu 2.jpg",
    "File:Machu_Picchu_2.jpg",
    "File:Llama.jpg",
  ]);
  assert.deepEqual(parseMediaList(MEDIA_LIST, { diagramsOnly: true }), [
    "File:Heart diagram.svg",
  ]);
  assert.deepEqual(parseMediaList(null, { diagramsOnly: false }), []);
});

test("normalizeFileTitle and buildCommonsUrl: one request for all files", () => {
  assert.equal(normalizeFileTitle("File:Foo_bar  baz.jpg"), "File:Foo bar baz.jpg");

  const url = buildCommonsUrl(["File:A_b.jpg", "File:C.png"]);

  assert.ok(url.startsWith("https://commons.wikimedia.org/w/api.php?"));
  assert.ok(url.includes("prop=imageinfo"));
  assert.ok(url.includes("iiprop=url%7Cmime%7Cextmetadata"));
  assert.ok(url.includes("iiurlwidth=640"));
  assert.ok(url.includes("titles=File%3AA+b.jpg%7CFile%3AC.png"));
});

test("parseCommonsImages: credited free files in the asked order, the rest dropped", () => {
  const answer = {
    query: {
      pages: [
        info({ title: "File:Llama.jpg", license: "CC BY 2.0", artist: "<a>Ann</a>" }),
        info({ title: "File:Machu Picchu 2.jpg", license: "CC BY-SA 4.0", artist: "Bob" }),
        info({ title: "File:Nonfree.jpg", license: "CC BY 4.0", artist: "C", extra: { NonFree: "true" } }),
        info({ title: "File:Nc.jpg", license: "CC BY-NC 4.0", artist: "D" }),
        info({ title: "File:Nolicense.jpg", artist: "E" }),
        info({ title: "File:Movie.ogv", license: "CC0", mime: "video/ogg" }),
        info({ title: "File:Elsewhere.jpg", license: "CC0", thumb: "https://evil.example/x.jpg" }),
        { title: "File:Gone.jpg", missing: true },
      ],
    },
  };
  const items = parseCommonsImages(answer, ["File:Machu_Picchu_2.jpg", "File:Llama.jpg"]);

  assert.deepEqual(
    items.map((item) => item.title),
    ["Machu Picchu 2", "Llama"],
  );
  assert.equal(items[0]?.author, "Bob");
  assert.equal(items[0]?.license, "CC BY-SA 4.0");
  assert.equal(items[0]?.page, "https://commons.wikimedia.org/wiki/File:Machu_Picchu_2.jpg");
  assert.ok(items.every((item) => item.src.startsWith("https://upload.wikimedia.org/")));
});

test("parseCommonsImages: garbage gives nothing", () => {
  assert.deepEqual(parseCommonsImages(null, []), []);
  assert.deepEqual(parseCommonsImages({ query: {} }, []), []);
  assert.deepEqual(parseCommonsImages({ query: { pages: [null, 5, {}] } }, []), []);
});

test("isRelatedTitle: the search hit must share a word with the topic", () => {
  assert.equal(isRelatedTitle("type 2 diabetes", "Diabetes"), true);
  assert.equal(isRelatedTitle("diabetes", "Diabetes"), true);
  assert.equal(isRelatedTitle("migraine", "Migraine"), true);
  assert.equal(isRelatedTitle("migraine", "Cooking"), false);
});

function routed(options: {
  readonly mediaList?: unknown;
  readonly commons?: unknown;
  readonly search?: unknown;
  readonly commonsStatus?: number;
}): (call: FakeCall) => Response {
  return (call) => {
    if (call.url.includes("/page/media-list/")) {
      return json(options.mediaList ?? { items: [] });
    }

    if (call.url.includes("commons.wikimedia.org")) {
      return options.commonsStatus
        ? new Response("x", { status: options.commonsStatus })
        : json(options.commons ?? { query: { pages: [] } });
    }

    if (call.url.includes("list=search")) {
      return json(options.search ?? { query: { search: [] } });
    }

    return new Response("unexpected", { status: 404 });
  };
}

const COMMONS_OK = {
  query: {
    pages: [
      info({ title: "File:Machu Picchu 2.jpg", license: "CC BY-SA 4.0", artist: "Bob" }),
      info({ title: "File:Llama.jpg", license: "Public domain" }),
    ],
  },
};

test("fetchLicensedPhotos: article files become credited pictures", async () => {
  const fake = fakeFetch(routed({ mediaList: MEDIA_LIST, commons: COMMONS_OK }));

  try {
    const photos = await fetchLicensedPhotos("en", "Machu Picchu", signal, { max: 5 });

    assert.deepEqual(
      photos.map((photo) => photo.title),
      ["Machu Picchu 2", "Llama"],
    );
    assert.equal(fake.calls.length, 2);
    assert.ok(fake.calls[0]?.url.includes("en.wikipedia.org/api/rest_v1/page/media-list/Machu_Picchu"));
    assert.ok(photos.every((photo) => photo.license));
  } finally {
    fake.restore();
  }
});

test("fetchLicensedPhotos: the limit is respected", async () => {
  const fake = fakeFetch(routed({ mediaList: MEDIA_LIST, commons: COMMONS_OK }));

  try {
    assert.equal((await fetchLicensedPhotos("en", "X", signal, { max: 1 })).length, 1);
  } finally {
    fake.restore();
  }
});

test("fetchLicensedPhotos: if Commons cannot be read, no picture (never an uncredited one)", async () => {
  const fake = fakeFetch(routed({ mediaList: MEDIA_LIST, commonsStatus: 503 }));

  try {
    assert.deepEqual(await fetchLicensedPhotos("en", "X", signal, { max: 5 }), []);
  } finally {
    fake.restore();
  }
});

test("fetchLicensedPhotos: an article without pictures makes no Commons request", async () => {
  const fake = fakeFetch(routed({ mediaList: { items: [] } }));

  try {
    assert.deepEqual(await fetchLicensedPhotos("en", "X", signal, { max: 5 }), []);
    assert.equal(fake.calls.length, 1);
  } finally {
    fake.restore();
  }
});

test("fetchArticleFileTitles: a bad language code makes no request", async () => {
  const fake = fakeFetch(routed({}));

  try {
    assert.deepEqual(
      await fetchArticleFileTitles("not a lang!", "X", { diagramsOnly: false }, signal),
      [],
    );
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("fetchLicensedPhotosForTopic: topic -> article -> diagrams only", async () => {
  const fake = fakeFetch(
    routed({
      search: { query: { search: [{ title: "Heart" }] } },
      mediaList: { items: [{ type: "image", title: "File:Heart anatomy.png" }, { type: "image", title: "File:Surgery photo.jpg" }] },
      commons: { query: { pages: [info({ title: "File:Heart anatomy.png", license: "CC BY-SA 3.0", artist: "Eve", mime: "image/png" })] } },
    }),
  );

  try {
    const photos = await fetchLicensedPhotosForTopic("heart", "en", signal, {
      max: 3,
      diagramsOnly: true,
    });

    assert.equal(photos.length, 1);
    assert.equal(photos[0]?.author, "Eve");

    const commonsCall = fake.calls.find((call) => call.url.includes("commons.wikimedia.org"));

    assert.ok(commonsCall?.url.includes("Heart+anatomy.png"));
    assert.ok(!commonsCall?.url.includes("Surgery"));
  } finally {
    fake.restore();
  }
});

test("findArticleTitle: an unrelated first hit is not used", async () => {
  const fake = fakeFetch(routed({ search: { query: { search: [{ title: "Cooking" }] } } }));

  try {
    assert.equal(await findArticleTitle("migraine", "en", signal), "");
  } finally {
    fake.restore();
  }
});
