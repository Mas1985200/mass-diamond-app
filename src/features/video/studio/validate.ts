// src/features/video/studio/validate.ts
// Cleans and limits a studio project that comes from outside: the person's own
// edits, a saved project, or the AI director. Anything may arrive (wrong types,
// missing fields, strange numbers, unsafe addresses); what leaves is always a
// project the rest of the studio can draw and record, plus a list of what had to
// be changed. A project with no usable scene is refused.
//
// Pure data rules: no browser, so every rule is tested.

import { isLoadableImageUrl } from "./loadImages.ts";
import { buildTimeline } from "./timeline.ts";
import {
  STUDIO_ASPECTS,
  STUDIO_LIMITS,
  STUDIO_MOTIONS,
  STUDIO_QUALITIES,
  STUDIO_TRANSITIONS,
  type StudioAspect,
  type StudioAudio,
  type StudioMotion,
  type StudioProject,
  type StudioQuality,
  type StudioScene,
  type StudioTransition,
} from "./types.ts";

export type StudioWarning =
  | { readonly code: "scene_dropped"; readonly index: number }
  | { readonly code: "scenes_truncated"; readonly kept: number }
  | { readonly code: "duration_truncated"; readonly kept: number };

export type ParseResult =
  | { readonly ok: true; readonly project: StudioProject; readonly warnings: StudioWarning[] }
  | { readonly ok: false; readonly code: "invalid_project" | "no_scenes" };

export const DEFAULT_SCENE_SECONDS = 5;
export const DEFAULT_TRANSITION_SECONDS = 1;
export const DEFAULT_MUSIC_VOLUME = 0.4;
export const DEFAULT_LANGUAGE = "en-US";

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// Text cut to a length by characters (never in the middle of a letter).
function cut(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  const letters = Array.from(text);
  return letters.length > max ? letters.slice(0, max).join("").trimEnd() : text;
}

function textOrNull(value: unknown, max: number): string | null {
  const text = cut(value, max);
  return text.length > 0 ? text : null;
}

function cleanScene(raw: unknown, id: string): StudioScene | null {
  if (!isBag(raw)) return null;
  const imageUrl = typeof raw.imageUrl === "string" ? raw.imageUrl.trim() : "";
  if (!isLoadableImageUrl(imageUrl)) return null;
  return {
    id,
    imageUrl,
    seconds: clamp(
      number(raw.seconds, DEFAULT_SCENE_SECONDS),
      STUDIO_LIMITS.minSceneSeconds,
      STUDIO_LIMITS.maxSceneSeconds,
    ),
    motion: oneOf<StudioMotion>(raw.motion, STUDIO_MOTIONS, "zoom-in"),
    transition: oneOf<StudioTransition>(raw.transition, STUDIO_TRANSITIONS, "fade"),
    transitionSeconds: clamp(
      number(raw.transitionSeconds, DEFAULT_TRANSITION_SECONDS),
      0,
      STUDIO_LIMITS.maxTransitionSeconds,
    ),
    caption: textOrNull(raw.caption, STUDIO_LIMITS.maxCaptionChars),
    narration: textOrNull(raw.narration, STUDIO_LIMITS.maxNarrationChars),
  };
}

// Music may only come from https or from the phone itself.
function musicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^https:\/\/[^\s/]+/i.test(text)) return text;
  if (/^blob:./i.test(text)) return text;
  return null;
}

const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function cleanAudio(raw: unknown): StudioAudio {
  const bag = isBag(raw) ? raw : {};
  const language = typeof bag.language === "string" ? bag.language.trim() : "";
  return {
    musicUrl: musicUrl(bag.musicUrl),
    musicVolume: clamp(number(bag.musicVolume, DEFAULT_MUSIC_VOLUME), 0, 1),
    narration: typeof bag.narration === "boolean" ? bag.narration : true,
    language: LANGUAGE_TAG.test(language) ? language : DEFAULT_LANGUAGE,
  };
}

function projectOf(
  title: string,
  aspectRatio: StudioAspect,
  quality: StudioQuality,
  scenes: StudioScene[],
  audio: StudioAudio,
): StudioProject {
  return { version: 1, title, aspectRatio, quality, scenes, audio };
}

export function parseStudioProject(input: unknown): ParseResult {
  if (!isBag(input) || !Array.isArray(input.scenes)) {
    return { ok: false, code: "invalid_project" };
  }
  const warnings: StudioWarning[] = [];

  const rawScenes: unknown[] = input.scenes;
  if (rawScenes.length > STUDIO_LIMITS.maxScenes) {
    warnings.push({ code: "scenes_truncated", kept: STUDIO_LIMITS.maxScenes });
  }

  const usedIds = new Set<string>();
  const scenes: StudioScene[] = [];
  rawScenes.slice(0, STUDIO_LIMITS.maxScenes).forEach((raw, index) => {
    const wanted = isBag(raw) && typeof raw.id === "string" ? raw.id.trim() : "";
    let id = wanted.length > 0 ? cut(wanted, 64) : `scene-${index + 1}`;
    while (usedIds.has(id)) id = `${id}-${index + 1}`;
    const scene = cleanScene(raw, id);
    if (!scene) {
      warnings.push({ code: "scene_dropped", index });
      return;
    }
    usedIds.add(id);
    scenes.push(scene);
  });
  if (scenes.length === 0) return { ok: false, code: "no_scenes" };

  const aspectRatio = oneOf<StudioAspect>(input.aspectRatio, STUDIO_ASPECTS, "16:9");
  const quality = oneOf<StudioQuality>(input.quality, STUDIO_QUALITIES, "standard");
  const title = cut(input.title, STUDIO_LIMITS.maxTitleChars);
  const audio = cleanAudio(input.audio);

  // Too long a film loses its last scenes, never its first.
  let project = projectOf(title, aspectRatio, quality, scenes, audio);
  if (buildTimeline(project).totalSeconds > STUDIO_LIMITS.maxSeconds) {
    let kept = scenes.length;
    while (kept > 1 && buildTimeline(projectOf(title, aspectRatio, quality, scenes.slice(0, kept), audio)).totalSeconds > STUDIO_LIMITS.maxSeconds) {
      kept -= 1;
    }
    project = projectOf(title, aspectRatio, quality, scenes.slice(0, kept), audio);
    warnings.push({ code: "duration_truncated", kept });
  }

  return { ok: true, project, warnings };
}
