// supabase/functions/ai-chat/video/catalog/lookup.ts
// Finds rows of the catalog from whatever the model or the person wrote, and
// writes the short text the film director reads. Pure code (no network, no
// Deno), so every rule is tested directly.

import { PHOTO_ACTIONS } from "./actions.ts";
import { STYLES } from "./styles.ts";
import type { PhotoAction, VideoStyle } from "./types.ts";

// The one spelling a word is compared in. Persian is typed in many ways: Arabic
// keyboards give ي and ك, people drop the long alef (آ), add vowel marks or
// stretch letters, and phones insert a zero-width non-joiner. Spaces, dashes,
// dots and quotes are ignored too, so "Pixel Art", "pixel-art" and "pixel_art"
// are the same word.
export function normalizeKey(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\u0622/g, "\u0627")
    .replace(/[\s\u200B-\u200D_\-.'"\u2019]/g, "");
}

// Every key one row answers to: its id, its English name and its aliases.
export function keysOf(row: {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}): string[] {
  return [row.id, row.name, ...row.aliases]
    .map(normalizeKey)
    .filter((key) => key.length > 0);
}

function indexOf<T extends { id: string; name: string; aliases: readonly string[] }>(
  rows: readonly T[],
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();

  for (const row of rows) {
    for (const key of keysOf(row)) {
      if (!map.has(key)) {
        map.set(key, row);
      }
    }
  }

  return map;
}

const STYLE_INDEX = indexOf(STYLES);
const ACTION_INDEX = indexOf(PHOTO_ACTIONS);

// The style the text means, or null. Anything that is not a known word (and
// "auto", and anything that is not a string) is null: the caller decides.
export function findStyle(input: unknown): VideoStyle | null {
  if (typeof input !== "string") {
    return null;
  }

  return STYLE_INDEX.get(normalizeKey(input)) ?? null;
}

// The id the video request carries: the catalog id of a known style, "auto"
// for nothing or for a word that is not a style.
export function resolveStyleId(input: unknown): string {
  return findStyle(input)?.id ?? "auto";
}

export function styleIds(): readonly string[] {
  return STYLES.map((style) => style.id);
}

// The look of a style as one English phrase for an engine prompt, or null.
export function styleRecipe(input: unknown): string | null {
  return findStyle(input)?.recipe ?? null;
}

export function findPhotoAction(input: unknown): PhotoAction | null {
  if (typeof input !== "string") {
    return null;
  }

  return ACTION_INDEX.get(normalizeKey(input)) ?? null;
}

// Only what is connected today. Planned actions are never offered.
export function liveActions(
  actions: readonly PhotoAction[] = PHOTO_ACTIONS,
): readonly PhotoAction[] {
  return actions.filter((action) => action.status === "live");
}

// The text the film director reads: every look it may offer (with the id to put
// in the create_video "style") and every photo ability that works today.
export function directorCatalogText(
  styles: readonly VideoStyle[] = STYLES,
  actions: readonly PhotoAction[] = PHOTO_ACTIONS,
): string {
  const looks = styles.map((style) => `${style.id} (${style.name})`).join(", ");
  const abilities = liveActions(actions);
  const lines = [
    `Looks you may offer, written as id (name); use the id as the style: ${looks}.`,
  ];

  if (abilities.length > 0) {
    lines.push(
      "What can be done with the person's own photo today: " +
        abilities.map((action) => `${action.name}, ${action.description}`).join("; ") +
        ".",
    );
  }

  if (abilities.some((action) => action.usesFace)) {
    lines.push(
      "Abilities that use a face are only for the person's own photo or a photo of someone who agreed: ask once if it is not clear, and never use a famous person's photo.",
    );
  }

  lines.push(
    "Offer only the looks and abilities listed here; never promise one that is not listed.",
  );

  return lines.join(" ");
}
