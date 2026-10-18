// tests/images/fallback.test.ts
// When the article in the asked language has no usable free pictures, the same
// article on English Wikipedia is tried. Fake network; fixtures follow the
// documented API shapes and are NOT checked against the live service.

import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchEnglishTitle,
  parseEnglishTitle,
} from "../../supabase/functions/ai-chat/images/article.ts";
import { fetchLicensedPhotos } from "../../supabase/functions/ai-chat/images/photos.ts";

const signal = new AbortController().signal;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function install(respond: (url: string) => Response): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);

    urls.push(url);

    return respond(url);
  }) as typeof fetch;

  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const COMMONS = {
  query: {
    pages: [
      {
        title: "File:Pelargonium.jpg",
        imageinfo: [
          {
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/P.jpg/640px-P.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Pelargonium.jpg",
            mime: "image/jpeg",
            extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "Ann" } },
          },
        ],
      },
    ],
  },
};

test("parseEnglishTitle: reads the langlink, tolerates garbage", () => {
  assert.equal(
    parseEnglishTitle({ query: { pages: [{ langlinks: [{ lang: "en", title: "Pelargonium" }] }] } }),
    "Pelargonium",
  );
  assert.equal(parseEnglishTitle(null), "");
  assert.equal(parseEnglishTitle({ query: { pages: [{}] } }), "");
});

test("fetchEnglishTitle: English and bad codes make no request", async () => {
  const net = install(() => json({}));

  try {
    assert.equal(await fetchEnglishTitle("en", "X", signal), "");
    assert.equal(await fetchEnglishTitle("bad lang!", "X", signal), "");
    assert.equal(net.urls.length, 0);
  } finally {
    net.restore();
  }
});

test("fetchLicensedPhotos: no free picture in the local article, the English one is used", async () => {
  const net = install((url) => {
    if (url.includes("fa.wikipedia.org/api/rest_v1/page/media-list/")) {
      return json({ items: [{ type: "image", title: "File:Local only.jpg" }] });
    }

    if (url.includes("fa.wikipedia.org/w/api.php") && url.includes("langlinks")) {
      return json({ query: { pages: [{ langlinks: [{ lang: "en", title: "Pelargonium" }] }] } });
    }

    if (url.includes("en.wikipedia.org/api/rest_v1/page/media-list/Pelargonium")) {
      return json({ items: [{ type: "image", title: "File:Pelargonium.jpg" }] });
    }

    if (url.includes("commons.wikimedia.org")) {
      return url.includes("Local+only") ? json({ query: { pages: [{ title: "File:Local only.jpg", missing: true }] } }) : json(COMMONS);
    }

    return new Response("unexpected", { status: 404 });
  });

  try {
    const photos = await fetchLicensedPhotos("fa", "شمعدانی", signal, { max: 3 });

    assert.equal(photos.length, 1);
    assert.equal(photos[0]?.author, "Ann");
  } finally {
    net.restore();
  }
});

test("fetchLicensedPhotos: when the local article has pictures, English is not asked", async () => {
  const net = install((url) => {
    if (url.includes("/page/media-list/")) {
      return json({ items: [{ type: "image", title: "File:Pelargonium.jpg" }] });
    }

    return url.includes("commons.wikimedia.org") ? json(COMMONS) : new Response("x", { status: 404 });
  });

  try {
    assert.equal((await fetchLicensedPhotos("fa", "X", signal, { max: 3 })).length, 1);
    assert.ok(net.urls.every((url) => !url.includes("langlinks")));
  } finally {
    net.restore();
  }
});
