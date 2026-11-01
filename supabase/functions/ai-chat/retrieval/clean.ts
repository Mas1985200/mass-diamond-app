// supabase/functions/ai-chat/retrieval/clean.ts
// A result's title or text often carries the name of its own website, such as
// "Iran wins the tournament - SomeSite.com" or "(SomeSite.com)". The model must
// never name a site, so the app removes every web address and site name written
// like one before the model reads the result. Nothing here depends on a
// language or a topic.

const SITE_NAME =
  /\b(?:https?:\/\/)?(?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|net|org|info|io|tv|fm|co|ir|ru|de|es|fr|it|uk|cn|jp|in|tr|ae|sa|eu|me|app|news)\b(?:\/\S*)?/giu;

export function withoutSiteNames(text: string): string {
  return text
    .replace(SITE_NAME, "")
    .replace(/\(\s*\)|\[\s*\]|«\s*»|“\s*”|„\s*“/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, "")
    .trim();
}
