// supabase/functions/ai-chat/images/photos.ts
// Credited pictures for a Wikipedia article: the article's own picture files,
// each checked on Wikimedia Commons for a free license and an author. If the
// license cannot be read, no picture is shown (never an uncredited one).

import type { PhotoItem } from "../types.ts";
import { createAttempt } from "../lib/http.ts";
import { fetchArticleFileTitles, findArticleTitle } from "./article.ts";
import { fetchCommonsImages } from "./commons.ts";

export const PHOTO_DEADLINE_MS = 6_000;

export type PhotoOptions = {
  readonly max: number;
  readonly diagramsOnly?: boolean;
};

export async function fetchLicensedPhotos(
  lang: string,
  title: string,
  master: AbortSignal,
  options: PhotoOptions,
): Promise<PhotoItem[]> {
  const deadline = createAttempt(master, PHOTO_DEADLINE_MS);

  try {
    const files = await fetchArticleFileTitles(
      lang,
      title,
      { diagramsOnly: options.diagramsOnly === true },
      deadline.signal,
    );
    const photos = await fetchCommonsImages(files, deadline.signal);

    return photos.slice(0, Math.max(0, options.max));
  } finally {
    deadline.clearConnectTimer();
  }
}

// For a topic given only as words (a health topic, say): the matching article is
// found first, then its pictures.
export async function fetchLicensedPhotosForTopic(
  topic: string,
  lang: string,
  master: AbortSignal,
  options: PhotoOptions,
): Promise<PhotoItem[]> {
  const deadline = createAttempt(master, PHOTO_DEADLINE_MS);

  try {
    const title = await findArticleTitle(topic, lang, deadline.signal);

    if (!title) {
      return [];
    }

    return await fetchLicensedPhotos(lang, title, deadline.signal, options);
  } finally {
    deadline.clearConnectTimer();
  }
}
