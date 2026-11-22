// src/features/video/studio/filmDraft.ts
// What the person builds on the film screen before pressing "make": a list of
// photos, each with its time, camera movement, change and caption, plus the shape
// and quality of the film. Pure rules (add, remove, move, edit, the project that
// is sent to the studio, the total length), so they are tested; the screen only
// shows this state and sends actions to it.

import { buildTimeline } from "./timeline.ts";
import {
  STUDIO_ASPECTS,
  STUDIO_LIMITS,
  STUDIO_MOTIONS,
  STUDIO_QUALITIES,
  STUDIO_TRANSITIONS,
  type StudioAspect,
  type StudioMotion,
  type StudioQuality,
  type StudioTransition,
} from "./types.ts";
import { DEFAULT_SCENE_SECONDS, parseStudioProject, type StudioWarning } from "./validate.ts";

export interface DraftPhoto {
  readonly id: string;
  // An address on the phone (blob:) from the photo intake.
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly motion: StudioMotion;
  readonly transition: StudioTransition;
  readonly caption: string;
}

export interface FilmDraft {
  readonly photos: readonly DraftPhoto[];
  readonly aspectRatio: StudioAspect;
  // True once the person chose the shape; until then it follows the first photo.
  readonly shapeChosen: boolean;
  readonly quality: StudioQuality;
  readonly title: string;
}

export const EMPTY_DRAFT: FilmDraft = {
  photos: [],
  aspectRatio: "16:9",
  shapeChosen: false,
  quality: "standard",
  title: "",
};

export type PhotoChanges = Partial<Pick<DraftPhoto, "seconds" | "motion" | "transition" | "caption">>;

export type DraftAction =
  | { readonly type: "add"; readonly id: string; readonly url: string; readonly width: number; readonly height: number }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "move"; readonly id: string; readonly direction: -1 | 1 }
  | { readonly type: "update"; readonly id: string; readonly changes: PhotoChanges }
  | { readonly type: "setShape"; readonly aspectRatio: StudioAspect }
  | { readonly type: "setQuality"; readonly quality: StudioQuality }
  | { readonly type: "setTitle"; readonly title: string }
  | { readonly type: "reset" };

// The camera moves in turn, so a film made of many photos never repeats itself.
const MOTION_CYCLE: readonly StudioMotion[] = ["zoom-in", "pan-right", "zoom-out", "pan-left"];

// A tall photo suits a tall film, a wide one a wide film.
export function shapeForPhoto(width: number, height: number): StudioAspect {
  if (!(width > 0) || !(height > 0)) return "16:9";
  if (width > height * 1.2) return "16:9";
  if (height > width * 1.2) return "9:16";
  return "1:1";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function cleanCaption(text: string): string {
  return Array.from(text).slice(0, STUDIO_LIMITS.maxCaptionChars).join("");
}

function cleanChanges(changes: PhotoChanges): PhotoChanges {
  const clean: { -readonly [K in keyof PhotoChanges]: PhotoChanges[K] } = {};
  if (typeof changes.seconds === "number" && Number.isFinite(changes.seconds)) {
    clean.seconds = clamp(changes.seconds, STUDIO_LIMITS.minSceneSeconds, STUDIO_LIMITS.maxSceneSeconds);
  }
  if (changes.motion !== undefined && STUDIO_MOTIONS.includes(changes.motion)) clean.motion = changes.motion;
  if (changes.transition !== undefined && STUDIO_TRANSITIONS.includes(changes.transition)) {
    clean.transition = changes.transition;
  }
  if (typeof changes.caption === "string") clean.caption = cleanCaption(changes.caption);
  return clean;
}

export function draftReducer(state: FilmDraft, action: DraftAction): FilmDraft {
  switch (action.type) {
    case "add": {
      if (state.photos.length >= STUDIO_LIMITS.maxScenes) return state;
      if (state.photos.some((photo) => photo.id === action.id)) return state;
      const photo: DraftPhoto = {
        id: action.id,
        url: action.url,
        width: action.width,
        height: action.height,
        seconds: DEFAULT_SCENE_SECONDS,
        motion: MOTION_CYCLE[state.photos.length % MOTION_CYCLE.length],
        transition: "fade",
        caption: "",
      };
      const first = state.photos.length === 0 && !state.shapeChosen;
      return {
        ...state,
        photos: [...state.photos, photo],
        aspectRatio: first ? shapeForPhoto(action.width, action.height) : state.aspectRatio,
      };
    }
    case "remove": {
      const photos = state.photos.filter((photo) => photo.id !== action.id);
      return photos.length === state.photos.length ? state : { ...state, photos };
    }
    case "move": {
      const from = state.photos.findIndex((photo) => photo.id === action.id);
      const to = from + action.direction;
      if (from < 0 || to < 0 || to >= state.photos.length) return state;
      const photos = [...state.photos];
      [photos[from], photos[to]] = [photos[to], photos[from]];
      return { ...state, photos };
    }
    case "update": {
      const index = state.photos.findIndex((photo) => photo.id === action.id);
      if (index < 0) return state;
      const photos = [...state.photos];
      photos[index] = { ...photos[index], ...cleanChanges(action.changes) };
      return { ...state, photos };
    }
    case "setShape":
      return STUDIO_ASPECTS.includes(action.aspectRatio)
        ? { ...state, aspectRatio: action.aspectRatio, shapeChosen: true }
        : state;
    case "setQuality":
      return STUDIO_QUALITIES.includes(action.quality) ? { ...state, quality: action.quality } : state;
    case "setTitle":
      return { ...state, title: Array.from(action.title).slice(0, STUDIO_LIMITS.maxTitleChars).join("") };
    case "reset":
      return EMPTY_DRAFT;
  }
}

// The project the studio makes the film from. The studio cleans it again, so
// this only has to be the right shape.
export function draftToProject(draft: FilmDraft): unknown {
  return {
    version: 1,
    title: draft.title,
    aspectRatio: draft.aspectRatio,
    quality: draft.quality,
    scenes: draft.photos.map((photo) => ({
      id: photo.id,
      imageUrl: photo.url,
      seconds: photo.seconds,
      motion: photo.motion,
      transition: photo.transition,
      transitionSeconds: 1,
      caption: photo.caption.trim() === "" ? null : photo.caption,
      narration: null,
    })),
    audio: { musicUrl: null, musicVolume: 0.4, narration: false, language: "en-US" },
  };
}

export interface DraftSummary {
  readonly photoCount: number;
  // The length of the film, in seconds.
  readonly seconds: number;
  readonly canMake: boolean;
  // What the studio will change (too long, too many photos), to tell the person.
  readonly warnings: StudioWarning[];
}

export function draftSummary(draft: FilmDraft): DraftSummary {
  const parsed = parseStudioProject(draftToProject(draft));
  if (!parsed.ok) return { photoCount: draft.photos.length, seconds: 0, canMake: false, warnings: [] };
  return {
    photoCount: parsed.project.scenes.length,
    seconds: buildTimeline(parsed.project).totalSeconds,
    canMake: true,
    warnings: parsed.warnings,
  };
}
