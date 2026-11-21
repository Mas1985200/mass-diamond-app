// src/features/video/studio/types.ts
// The shapes of the on-device video studio: a project is a list of scenes (a
// picture, how long it stays, how the camera moves, how it changes to the next
// one, an optional caption and narration) and the sound (music, narration). The
// studio makes the video on the person's own phone, so it costs nothing and has
// no limit on how many people use it at the same time.
//
// Pure types and numbers: no browser code, nothing to install, so every rule
// built on them is tested.

export type StudioAspect = "16:9" | "9:16" | "1:1";
export type StudioQuality = "draft" | "standard" | "high";

// How the camera moves over a still picture while the scene is shown.
export type StudioMotion =
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "pan-down"
  | "still";

// How a scene changes into the next one.
export type StudioTransition = "cut" | "fade" | "slide-left" | "slide-right" | "zoom";

export interface StudioScene {
  readonly id: string;
  // Where the picture comes from: an https link or a link made on the phone
  // (blob: or data:) for the person's own picture.
  readonly imageUrl: string;
  // How long the scene is shown, in seconds (whole or half seconds are best).
  readonly seconds: number;
  readonly motion: StudioMotion;
  readonly transition: StudioTransition;
  // How long the change into the NEXT scene takes. Ignored on the last scene.
  readonly transitionSeconds: number;
  // Text drawn on the picture (a title or a subtitle), or null.
  readonly caption: string | null;
  // Text read aloud while the scene is shown, or null.
  readonly narration: string | null;
}

export interface StudioAudio {
  // Background music file (a link), or null for none.
  readonly musicUrl: string | null;
  // 0 (silent) to 1 (full).
  readonly musicVolume: number;
  // Whether the narration of the scenes is read aloud while the video plays.
  readonly narration: boolean;
  // Language of the narration, as a language tag ("fa-IR", "en-US").
  readonly language: string;
}

export interface StudioProject {
  readonly version: 1;
  readonly title: string;
  readonly aspectRatio: StudioAspect;
  readonly quality: StudioQuality;
  readonly scenes: readonly StudioScene[];
  readonly audio: StudioAudio;
}

export interface StudioSize {
  readonly width: number;
  readonly height: number;
}

export const STUDIO_ASPECTS: readonly StudioAspect[] = ["16:9", "9:16", "1:1"];
export const STUDIO_QUALITIES: readonly StudioQuality[] = ["draft", "standard", "high"];
export const STUDIO_MOTIONS: readonly StudioMotion[] = [
  "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "still",
];
export const STUDIO_TRANSITIONS: readonly StudioTransition[] = [
  "cut", "fade", "slide-left", "slide-right", "zoom",
];

// Frames per second of the video that is drawn and recorded.
export const STUDIO_FPS = 30;

export const STUDIO_LIMITS = {
  // A video of up to 10 minutes, like the AI video engine.
  maxSeconds: 600,
  minSceneSeconds: 1,
  maxSceneSeconds: 60,
  maxScenes: 200,
  maxTransitionSeconds: 3,
  maxCaptionChars: 200,
  maxNarrationChars: 1500,
  maxTitleChars: 100,
} as const;

// Every side is even, as the video encoders need. A bigger picture looks better
// and is slower to draw, so the person (or the phone) can choose.
const SIZES: Readonly<Record<StudioAspect, Readonly<Record<StudioQuality, StudioSize>>>> = {
  "16:9": {
    draft: { width: 640, height: 360 },
    standard: { width: 1280, height: 720 },
    high: { width: 1920, height: 1080 },
  },
  "9:16": {
    draft: { width: 360, height: 640 },
    standard: { width: 720, height: 1280 },
    high: { width: 1080, height: 1920 },
  },
  "1:1": {
    draft: { width: 480, height: 480 },
    standard: { width: 720, height: 720 },
    high: { width: 1080, height: 1080 },
  },
};

export function studioSize(aspect: StudioAspect, quality: StudioQuality): StudioSize {
  return SIZES[aspect][quality];
}
