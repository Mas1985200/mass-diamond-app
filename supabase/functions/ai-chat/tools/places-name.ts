// supabase/functions/ai-chat/tools/places-name.ts
// Tells whether the name of the object found on the map is a different name
// from the one the user asked for. Names are compared only when both are
// written in the same script (Arabic/Persian or Latin); names in different
// scripts cannot be compared and are never treated as different.

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const LATIN_SCRIPT = /[A-Za-z]/;

function sameScript(a: string, b: string): boolean {
  return (
    (ARABIC_SCRIPT.test(a) && ARABIC_SCRIPT.test(b)) ||
    (LATIN_SCRIPT.test(a) && LATIN_SCRIPT.test(b))
  );
}

// Lower case, one spelling of the letters Persian and Arabic write
// differently, no accents; half-spaces and punctuation separate words.
function nameTokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u0629/g, "\u0647")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function covers(
  wanted: readonly string[],
  available: readonly string[],
): boolean {
  return wanted.every((word) =>
    available.some(
      (candidate) =>
        candidate === word ||
        (word.length >= 3 &&
          candidate.length >= 3 &&
          (candidate.includes(word) || word.includes(candidate))),
    ),
  );
}

// True when both names are in the same script and neither name's words are
// all found in the other name. "Eiffel Tower" and "Eiffel Tower, Paris" agree;
// "Mohammadiyeh Town" and "Mohammadiyeh Square Metro Station" disagree.
export function namesDisagree(asked: string, found: string): boolean {
  if (!asked.trim() || !found.trim() || !sameScript(asked, found)) {
    return false;
  }

  const wanted = nameTokens(asked);
  const available = nameTokens(found);

  if (wanted.length === 0 || available.length === 0) {
    return false;
  }

  return !(covers(wanted, available) || covers(available, wanted));
}
