// supabase/functions/ai-chat/images/photos.ts
// Credited pictures for a Wikipedia article: the article's own picture files,
// each checked on Wikimedia Commons for a free license and an author. If the
// license cannot be read, no picture is shown (never an uncredited one).

import type { PhotoItem } from "../types.ts";
import { createAttempt } from "../lib/http.ts";
import {
  fetchArticleFileTitles,
  fetchEnglishTitle,
  findArticleTitle,
} from "./article.ts";
import { fetchCommonsImages } from "./commons.ts";

export const PHOTO_DEADLINE_MS = 8_000;

export type PhotoOptions = {
  readonly max: number;
  readonly diagramsOnly?: boolean;
};

async function photosOfArticle(
  lang: string,
  title: string,
  master: AbortSignal,
  options: PhotoOptions,
): Promise<PhotoItem[]> {
  const files = await fetchArticleFileTitles(
    lang,
    title,
    { diagramsOnly: options.diagramsOnly === true },
    master,
  );
  const photos = await fetchCommonsImages(files, master);

  return photos.slice(0, Math.max(0, options.max));
}

// The article in the asked language first. Many articles there have few or no
// freely licensed pictures (some wikis keep their own non-free files), so when
// nothing usable is found the same article on English Wikipedia is tried.
export async function fetchLicensedPhotos(
  lang: string,
  title: string,
  master: AbortSignal,
  options: PhotoOptions,
): Promise<PhotoItem[]> {
  const deadline = createAttempt(master, PHOTO_DEADLINE_MS);

  try {
    let photos = await photosOfArticle(lang, title, deadline.signal, options);
    let tried = 1;

    if (photos.length === 0 && lang.toLowerCase() !== "en") {
      const english = await fetchEnglishTitle(lang, title, deadline.signal);

      if (english) {
        tried = 2;
        photos = await photosOfArticle("en", english, deadline.signal, options);
      }
    }

    // Counts only, never the topic text.
    console.log(
      JSON.stringify({
        event: "photos",
        lang,
        tried,
        shown: photos.length,
        diagrams: options.diagramsOnly === true,
      }),
    );

    return photos;
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
