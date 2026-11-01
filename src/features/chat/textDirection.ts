// src/features/chat/textDirection.ts
// Which way a piece of chat text runs, and which digits it uses. Nothing here
// depends on one language: the first letter of the text decides the direction,
// and only text with no Arabic-script letter in it is given western digits.

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const ANY_LETTER = /\p{L}/u;
const EASTERN_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/g;

export type TextDirection = "rtl" | "ltr";

// The first letter decides: Hebrew, Arabic, Persian and the other right-to-left
// scripts run right to left; every other script (Latin, Cyrillic, Greek,
// Devanagari, Chinese, Japanese, Korean, Thai ...) runs left to right. Digits
// and punctuation never decide. Text with no letter at all keeps the app's
// default, right to left.
export function detectDirection(texts: readonly string[]): TextDirection {
  for (const text of texts) {
    for (const char of text) {
      if (!ANY_LETTER.test(char)) {
        continue;
      }

      return RTL_LETTER.test(char) ? "rtl" : "ltr";
    }
  }

  return "rtl";
}

// A reply in Chinese, Hindi, Spanish and so on must never show Persian or
// Arabic digits (they leak in from a Persian conversation). When the text has
// letters and none of them is Arabic-script, those digits become 0-9.
export function westernDigitsForForeignText(text: string): string {
  let hasLetter = false;

  for (const char of text) {
    if (!ANY_LETTER.test(char)) {
      continue;
    }

    if (RTL_LETTER.test(char)) {
      return text;
    }

    hasLetter = true;
  }

  if (!hasLetter) {
    return text;
  }

  return text.replace(EASTERN_DIGIT, (digit) => {
    const code = digit.charCodeAt(0);

    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
