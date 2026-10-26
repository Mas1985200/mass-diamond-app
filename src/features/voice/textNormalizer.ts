// src/features/voice/textNormalizer.ts
// Cleans the text a speech recognizer returns, WITHOUT changing what was said.
//
// It only touches the surface of the text: invisible junk, spacing, and (for
// the languages that need it) letter forms, half-spaces and punctuation marks.
// It never translates, summarizes, removes words or changes numbers, names,
// brands, e-mail addresses or links, and it never touches text in a language
// whose rules it does not know: for those only the language-neutral cleaning
// is done. The raw recognizer text is the caller's to keep; this function
// returns a new string and never mutates anything.
//
// It is a pure function (no browser, no network), so it is tested directly.

const ZWNJ = "\u200C";

// Letters of the Arabic script used by Persian and Arabic (digits, which sit
// in the same block, are deliberately NOT included).
const LETTER = "\\u0620-\\u064A\\u0671-\\u06D3\\u06FA-\\u06FC\\u06FF";
const ANY_DIGIT = "0-9\\u0660-\\u0669\\u06F0-\\u06F9";

// Languages that get the Arabic-script punctuation and spacing rules.
const ARABIC_SCRIPT_PUNCTUATION: ReadonlySet<string> = new Set(["fa", "ar"]);

// Language-neutral junk: byte-order mark, soft hyphen, word joiner and control
// characters (tab and line breaks are handled as spaces below).
const INVISIBLE_JUNK = /[\uFEFF\u00AD\u2060\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const WHITESPACE_RUN = /\s+/g;

// "می" and "نمی" are written together with the verb by a half-space.
const VERB_PREFIX = new RegExp(`(^|\\s)(نمی|می)\\s+([${LETTER}])`, "g");

// The plural endings written together with the noun by a half-space.
const PLURAL_ENDING = new RegExp(
  `([${LETTER}])\\s+(هایی|های|ها)(?=\\s|$|[،؛؟!?.,;:])`,
  "g",
);

// A space in front of a punctuation mark is wrong (after a digit it is left
// alone, so a time or a number is never rewritten).
const SPACE_BEFORE_PUNCTUATION = new RegExp(
  `([^\\s${ANY_DIGIT}])\\s+([،؛؟!?.,;])`,
  "g",
);

const LATIN_QUESTION = new RegExp(`([${LETTER}])\\?(?=\\s|$)`, "g");
const LATIN_COMMA = new RegExp(`([${LETTER}]),(?=\\s|$)`, "g");
const LATIN_SEMICOLON = new RegExp(`([${LETTER}]);(?=\\s|$)`, "g");

// A letter or digit written right after an Arabic-script punctuation mark
// needs a space between them.
const NO_SPACE_AFTER_PUNCTUATION = /([،؛؟])([\p{L}\p{N}])/gu;

// "fa-IR" and "FA" both mean "fa". An empty or unknown value means "no
// language rules".
function primaryLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function collapseSpaces(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

// Half-spaces: never doubled, never next to a space, never at the ends.
function tidyHalfSpaces(text: string): string {
  return text
    .replace(/\u200C{2,}/g, ZWNJ)
    .replace(/\u200C+\s+|\s+\u200C+/g, " ")
    .replace(/^\u200C+|\u200C+$/g, "");
}

// `language` is the language the person spoke (ISO code such as "fa", "en").
export function normalizeTranscript(text: string, language: string): string {
  const lang = primaryLanguage(language);

  let result = collapseSpaces(text.normalize("NFC").replace(INVISIBLE_JUNK, ""));

  if (lang === "fa" || lang === "ar") {
    // The decorative stretching line is never a letter.
    result = result.replace(/\u0640/g, "");
  }

  if (lang === "fa") {
    // Arabic letter forms that the recognizer sometimes returns become the
    // Persian ones. (Never done for Arabic, where they are the right letters.)
    result = result
      .replace(/\u064A/g, "\u06CC")
      .replace(/\u0649/g, "\u06CC")
      .replace(/\u0643/g, "\u06A9");

    result = tidyHalfSpaces(result)
      .replace(VERB_PREFIX, `$1$2${ZWNJ}$3`)
      .replace(PLURAL_ENDING, `$1${ZWNJ}$2`);
  }

  if (ARABIC_SCRIPT_PUNCTUATION.has(lang)) {
    result = result
      .replace(SPACE_BEFORE_PUNCTUATION, "$1$2")
      .replace(LATIN_QUESTION, "$1؟")
      .replace(LATIN_COMMA, "$1،")
      .replace(LATIN_SEMICOLON, "$1؛")
      .replace(NO_SPACE_AFTER_PUNCTUATION, "$1 $2");
  }

  return collapseSpaces(result);
}
