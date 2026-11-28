// supabase/functions/ai-chat/video/catalog/engine-style.ts
// The video function and its database only know six style words ("auto",
// "realistic", "cinematic", "animation", "advertising", "educational"), and
// they refuse anything else. The catalog has many more looks, so two things
// carry a look to the engine without touching it:
//
//  1. the look is written into the engine prompt (withStyleRecipe), which is
//     what really changes the picture, and
//  2. the technical style field gets the nearest of the six old words
//     (engineStyleOf), so a request is never refused over a new look.
//
// Pure code (no network, no Deno), so every rule is tested directly.

import { findStyle, styleRecipe } from "./lookup.ts";

export type EngineStyle =
  | "auto"
  | "realistic"
  | "cinematic"
  | "animation"
  | "advertising"
  | "educational";

export const ENGINE_STYLES: readonly EngineStyle[] = [
  "auto",
  "realistic",
  "cinematic",
  "animation",
  "advertising",
  "educational",
];

// Four catalog ids are the old words themselves.
const SAME_NAME: ReadonlySet<string> = new Set([
  "realistic",
  "cinematic",
  "advertising",
  "educational",
]);

// The technical style word for any catalog id (or old word); "auto" when the
// look is unknown, absent or has no close old word.
export function engineStyleOf(input: unknown): EngineStyle {
  const style = findStyle(input);

  if (!style) {
    return "auto";
  }

  if (SAME_NAME.has(style.id)) {
    return style.id as EngineStyle;
  }

  switch (style.group) {
    case "anime":
    case "animation":
    case "illustration":
    case "stylized":
      return "animation";
    case "realistic":
      return "realistic";
    case "retro":
    case "purpose":
      return "auto";
  }
}

// The most characters an engine prompt may have after the look is added.
export const MAX_STYLED_PROMPT_CHARS = 1_500;

// The engine prompt with the look of the chosen style added at its end. The
// model's own prompt is shortened if it must be, never the look; a look that is
// already inside the prompt is not added twice; an unknown look or "auto" leaves
// the prompt as it is.
export function withStyleRecipe(
  enginePrompt: string,
  styleId: unknown,
  maxChars: number = MAX_STYLED_PROMPT_CHARS,
): string {
  const base = enginePrompt.trim();
  const recipe = styleRecipe(styleId);

  if (!recipe || base.includes(recipe)) {
    return base;
  }

  const suffix = ` Visual style: ${recipe}.`;
  const room = Math.max(0, maxChars - suffix.length);

  return `${base.slice(0, room).trimEnd()}${suffix}`;
}
