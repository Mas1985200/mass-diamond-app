// supabase/functions/video-engine/download.ts
// Brings a finished video home from the engine's link. No Deno-only code, so
// it is tested with a faked network.
//
// Safety: only https links are followed; the project's Hugging Face token is
// sent only to Hugging Face hosts (never to any other site a link may point
// to); the download is stopped as soon as it is bigger than the largest file
// the storage accepts, so a huge or endless answer cannot fill the memory.

import type { DownloadedVideo, DownloadVideo } from "./store.ts";

export const DOWNLOAD_TIMEOUT_MS = 90_000;
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

// True for the hosts the Hugging Face token may be sent to.
export function isHuggingFaceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "hf.space" ||
    host.endsWith(".hf.space") ||
    host === "huggingface.co" ||
    host.endsWith(".huggingface.co") ||
    host === "hf.co" ||
    host.endsWith(".hf.co")
  );
}

export interface DownloadOptions {
  hfToken?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}

export function createDownloadVideo(options: DownloadOptions = {}): DownloadVideo {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return async (link: string): Promise<DownloadedVideo> => {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error("The video link is not valid.");
    }
    if (url.protocol !== "https:") {
      throw new Error("Only https video links are followed.");
    }

    const headers: Record<string, string> = {};
    if (options.hfToken && isHuggingFaceHost(url.hostname)) {
      headers.Authorization = `Bearer ${options.hfToken}`;
    }

    const response = await fetchImpl(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`The video download failed (${response.status}).`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("The video is larger than the storage accepts.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("The video download had no content.");

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The video is larger than the storage accepts.");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    return { bytes, contentType: contentType || "video/mp4" };
  };
}
