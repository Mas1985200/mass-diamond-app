// tests/video/video-download.test.ts
// Bringing a finished video home: only https, the token only to Hugging Face,
// and a hard stop for files that are too big. Faked network, nothing real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDownloadVideo,
  isHuggingFaceHost,
} from "../../supabase/functions/video-engine/download.ts";

function fakeFetch(body: Uint8Array | null, init: ResponseInit = { status: 200 }) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (url: URL, options: RequestInit) => {
    seen.push({ url: String(url), headers: (options.headers ?? {}) as Record<string, string> });
    return new Response(body, init);
  }) as unknown as typeof fetch;
  return { impl, seen };
}

test("the token goes to Hugging Face hosts only", () => {
  for (const host of ["a-b.hf.space", "hf.space", "huggingface.co", "cdn-lfs.huggingface.co", "hf.co", "HF.SPACE"]) {
    assert.equal(isHuggingFaceHost(host), true, host);
  }
  for (const host of ["evil.com", "hf.space.evil.com", "nothf.space", "huggingface.co.evil.com", "example.org"]) {
    assert.equal(isHuggingFaceHost(host), false, host);
  }
});

test("a video is downloaded with the token for a Space and its type is kept", async () => {
  const { impl, seen } = fakeFetch(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "Video/WebM; codecs=vp9" },
  });
  const download = createDownloadVideo({ hfToken: "secret", fetchImpl: impl });
  const result = await download("https://x.hf.space/file/v.webm");
  assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
  assert.equal(result.contentType, "video/webm");
  assert.equal(seen[0].headers.Authorization, "Bearer secret");
});

test("another site never gets the token, and a missing type means mp4", async () => {
  const { impl, seen } = fakeFetch(new Uint8Array([9]));
  const download = createDownloadVideo({ hfToken: "secret", fetchImpl: impl });
  const result = await download("https://cdn.example.com/v.mp4");
  assert.equal(result.contentType, "video/mp4");
  assert.equal("Authorization" in seen[0].headers, false);
});

test("a link that is not https or not a link is refused before any request", async () => {
  const { impl, seen } = fakeFetch(new Uint8Array([1]));
  const download = createDownloadVideo({ fetchImpl: impl });
  await assert.rejects(() => download("http://x.hf.space/v.mp4"), /https/);
  await assert.rejects(() => download("file:///etc/passwd"), /https/);
  await assert.rejects(() => download("not a link"), /valid/);
  assert.equal(seen.length, 0);
});

test("an error answer is an error", async () => {
  const { impl } = fakeFetch(null, { status: 404 });
  await assert.rejects(() => createDownloadVideo({ fetchImpl: impl })("https://x.hf.space/v"), /404/);
});

test("a file over the limit is stopped, whether it says so or not", async () => {
  const declared = fakeFetch(new Uint8Array(10), { status: 200, headers: { "content-length": "999" } });
  await assert.rejects(
    () => createDownloadVideo({ fetchImpl: declared.impl, maxBytes: 100 })("https://x.hf.space/v"),
    /larger/,
  );
  const silent = fakeFetch(new Uint8Array(500));
  await assert.rejects(
    () => createDownloadVideo({ fetchImpl: silent.impl, maxBytes: 100 })("https://x.hf.space/v"),
    /larger/,
  );
  const fits = fakeFetch(new Uint8Array(100));
  const ok = await createDownloadVideo({ fetchImpl: fits.impl, maxBytes: 100 })("https://x.hf.space/v");
  assert.equal(ok.bytes.length, 100);
});
