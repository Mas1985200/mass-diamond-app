// supabase/functions/ai-chat/retrieval/script.ts
// Which writing systems a language is written in, by its language tag. It lets
// the app see that a search is NOT in the language of the place it is about
// (a Latin-script search for a Persian-speaking country) without asking a
// model. Languages written in the Latin script are absent on purpose: a
// Spanish search and a German one cannot be told apart by script.

const SCRIPTS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  fa: ["arabic"],
  ar: ["arabic"],
  ur: ["arabic"],
  ps: ["arabic"],
  ku: ["arabic"],
  ru: ["cyrillic"],
  uk: ["cyrillic"],
  be: ["cyrillic"],
  bg: ["cyrillic"],
  sr: ["cyrillic", "latin"],
  kk: ["cyrillic"],
  hi: ["devanagari"],
  mr: ["devanagari"],
  ne: ["devanagari"],
  zh: ["han"],
  ja: ["kana", "han"],
  ko: ["hangul"],
};

// The scripts a language is written in, or null when they cannot tell the
// language from English or from another Latin-script language.
export function scriptsOfLanguage(tag: string | null): readonly string[] | null {
  if (!tag) {
    return null;
  }

  return SCRIPTS_BY_LANGUAGE[(tag.split("-")[0] ?? "").toLowerCase()] ?? null;
}
