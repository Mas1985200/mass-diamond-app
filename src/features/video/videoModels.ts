// src/features/video/videoModels.ts
// Pure rules of the video model chooser (like the model list in ChatGPT):
// reading the list of models the video function sends, building the choices
// the person sees, keeping a saved choice only while it is still usable, and
// the price of a video in credits. No React, no DOM, no network, so every rule
// is tested.
//
// Nothing the server sends is trusted: words are cut to a safe length, numbers
// are clamped, unknown things are dropped.

import { asQuality, type AspectRatio, type Lang, type Quality } from "./videoCard.ts";

export const AUTO_MODEL_ID = "auto";
export const MAX_MODELS = 12;
const MAX_LABEL_CHARS = 40;
const MAX_ID_CHARS = 64;
const MAX_SECONDS = 60;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface VideoModel {
  readonly id: string;
  readonly label: string;
  // True when using the model costs the app no money (a free engine).
  readonly free: boolean;
  // False when the engine is not connected yet: shown greyed out, not pickable.
  readonly available: boolean;
  readonly textToVideo: boolean;
  readonly imageToVideo: boolean;
  readonly aspectRatios: readonly AspectRatio[];
  readonly maxDurationSeconds: number;
}

export type CreditsPerSecond = Readonly<Record<Quality, number>>;

export const DEFAULT_CREDITS_PER_SECOND: CreditsPerSecond = {
  draft: 1,
  standard: 2,
  high: 3,
};

export type ModelsAnswer =
  | {
      readonly ok: true;
      readonly models: readonly VideoModel[];
      readonly creditsPerSecond: CreditsPerSecond;
    }
  | { readonly ok: false };

export interface ModelChoice {
  readonly id: string;
  readonly label: string;
  readonly free: boolean;
  readonly available: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRatios(value: unknown): AspectRatio[] {
  if (!Array.isArray(value)) return [];
  const out: AspectRatio[] = [];
  for (const item of value) {
    if ((item === "16:9" || item === "9:16" || item === "1:1") && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

function asSeconds(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 5;
  return Math.min(MAX_SECONDS, Math.max(1, Math.floor(n)));
}

function readModel(value: unknown): VideoModel | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || id.length > MAX_ID_CHARS || !ID_PATTERN.test(id)) return null;
  if (id.toLowerCase() === AUTO_MODEL_ID) return null;
  const label =
    typeof value.label === "string" ? value.label.trim().slice(0, MAX_LABEL_CHARS) : "";
  const kinds = Array.isArray(value.kinds) ? value.kinds : [];
  return {
    id,
    label: label || id,
    free: value.free === true,
    available: value.available === true,
    textToVideo: kinds.includes("text_to_video"),
    imageToVideo: kinds.includes("image_to_video"),
    aspectRatios: asRatios(value.aspectRatios),
    maxDurationSeconds: asSeconds(value.maxDurationSeconds),
  };
}

function readPrices(value: unknown): CreditsPerSecond {
  if (!isRecord(value)) return DEFAULT_CREDITS_PER_SECOND;
  const price = (key: Quality): number => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 1000
      ? Math.ceil(n)
      : DEFAULT_CREDITS_PER_SECOND[key];
  };
  return { draft: price("draft"), standard: price("standard"), high: price("high") };
}

// The video function's answer to {"action":"models"}.
export function parseModelsAnswer(body: unknown): ModelsAnswer {
  if (!isRecord(body) || body.ok !== true || !Array.isArray(body.models)) {
    return { ok: false };
  }
  const models: VideoModel[] = [];
  const seen = new Set<string>();
  for (const item of body.models) {
    const model = readModel(item);
    if (!model) continue;
    const key = model.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(model);
    if (models.length >= MAX_MODELS) break;
  }
  return { ok: true, models, creditsPerSecond: readPrices(body.creditsPerSecond) };
}

export const MODEL_TEXT: Record<Lang, {
  readonly title: string;
  readonly auto: string;
  readonly autoHint: string;
  readonly free: string;
  readonly unavailable: string;
  readonly credits: (n: number) => string;
}> = {
  fa: {
    title: "مدل ویدیو",
    auto: "خودکار",
    autoHint: "بهترین مدل آماده انتخاب می‌شود",
    free: "رایگان",
    unavailable: "به‌زودی",
    credits: (n) => `${n} اعتبار`,
  },
  en: {
    title: "Video model",
    auto: "Auto",
    autoHint: "The best ready model is chosen",
    free: "Free",
    unavailable: "Coming soon",
    credits: (n) => `${n} credits`,
  },
};

// The choices the person sees: "Auto" first, then every model. A model that
// is not connected yet is listed but cannot be picked.
export function modelChoices(models: readonly VideoModel[], lang: Lang): ModelChoice[] {
  const text = MODEL_TEXT[lang];
  const choices: ModelChoice[] = [
    {
      id: AUTO_MODEL_ID,
      label: text.auto,
      free: false,
      available: models.some((m) => m.available),
    },
  ];
  for (const model of models) {
    choices.push({
      id: model.id,
      label: model.label,
      free: model.free,
      available: model.available,
    });
  }
  return choices;
}

// A saved choice is kept only while it is still usable. Anything else (the
// model is gone, not connected, or the word is unknown) falls back to Auto,
// so an old choice can never block making a video.
export function resolveChoice(saved: string | null | undefined, models: readonly VideoModel[]): string {
  const wanted = (saved ?? "").trim();
  if (!wanted || wanted.toLowerCase() === AUTO_MODEL_ID) return AUTO_MODEL_ID;
  const found = models.find((m) => m.id === wanted);
  return found && found.available ? found.id : AUTO_MODEL_ID;
}

// What is sent with a message: nothing for Auto, the model's id otherwise.
export function modelToSend(choice: string): string | null {
  const wanted = choice.trim();
  return !wanted || wanted.toLowerCase() === AUTO_MODEL_ID ? null : wanted;
}

// The price of one video, the same rule the server uses: whole seconds
// (at least 1) times the price per second of the quality.
export function creditsForVideo(
  seconds: number,
  quality: unknown,
  prices: CreditsPerSecond = DEFAULT_CREDITS_PER_SECOND,
): number {
  const whole = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 1;
  return whole * prices[asQuality(quality)];
}

// end of videoModels.ts
