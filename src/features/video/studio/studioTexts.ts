// src/features/video/studio/studioTexts.ts
// Every word of the film-making screen, in Persian and English, in the same style
// as the other video texts: one table per language, the same keys in both, and
// small functions for the texts that carry a number. No React, so it is tested.

import { formatNumber, formatPercent, type Lang } from "../videoCard.ts";
import type { FilmStage } from "./makeFilm.ts";
import type {
  StudioAspect,
  StudioMotion,
  StudioQuality,
  StudioTransition,
} from "./types.ts";
import type { StudioWarning } from "./validate.ts";

// Everything that can go wrong while making a film or taking a photo.
export type StudioErrorCode =
  | "invalid"
  | "no_images"
  | "cancelled"
  | "unsupported"
  | "failed"
  | "not_image"
  | "too_large"
  | "too_small"
  | "unreadable";

interface StudioTexts {
  readonly title: string;
  readonly subtitle: string;
  readonly addPhoto: string;
  readonly photos: string;
  readonly noPhotos: string;
  readonly removePhoto: string;
  readonly moveEarlier: string;
  readonly moveLater: string;
  readonly secondsLabel: string;
  readonly motionLabel: string;
  readonly transitionLabel: string;
  readonly captionLabel: string;
  readonly captionPlaceholder: string;
  readonly shapeLabel: string;
  readonly qualityLabel: string;
  readonly make: string;
  readonly cancel: string;
  readonly download: string;
  readonly makeAnother: string;
  readonly keepOpen: string;
  readonly done: string;
  readonly total: string;
  readonly motions: Readonly<Record<StudioMotion, string>>;
  readonly transitions: Readonly<Record<StudioTransition, string>>;
  readonly shapes: Readonly<Record<StudioAspect, string>>;
  readonly qualities: Readonly<Record<StudioQuality, string>>;
  readonly stages: Readonly<Record<FilmStage, string>>;
  readonly errors: Readonly<Record<StudioErrorCode, string>>;
  readonly seconds: string;
  readonly scenesTruncated: (kept: number) => string;
  readonly scenesDropped: (count: number) => string;
  readonly durationTruncated: (kept: number) => string;
  readonly failedScenes: (count: number) => string;
}

export const STUDIO_TEXT: Readonly<Record<Lang, StudioTexts>> = {
  fa: {
    title: "ساخت فیلم",
    subtitle: "از عکس‌هایت فیلم بساز؛ روی خود گوشی، رایگان و بدون محدودیت",
    addPhoto: "گرفتن عکس یا انتخاب از گالری",
    photos: "عکس‌ها",
    noPhotos: "هنوز عکسی اضافه نکرده‌ای",
    removePhoto: "حذف عکس",
    moveEarlier: "جلوتر",
    moveLater: "عقب‌تر",
    secondsLabel: "مدت نمایش",
    motionLabel: "حرکت دوربین",
    transitionLabel: "انتقال به عکس بعدی",
    captionLabel: "زیرنویس",
    captionPlaceholder: "یک جمله روی عکس (اختیاری)",
    shapeLabel: "شکل فیلم",
    qualityLabel: "کیفیت",
    make: "ساخت فیلم",
    cancel: "لغو",
    download: "دانلود فیلم",
    makeAnother: "ساخت فیلم تازه",
    keepOpen: "تا پایان ساخت، این صفحه را باز نگه دار",
    done: "فیلمت آماده است",
    total: "طول فیلم",
    motions: {
      "zoom-in": "نزدیک شدن",
      "zoom-out": "دور شدن",
      "pan-left": "حرکت به چپ",
      "pan-right": "حرکت به راست",
      "pan-up": "حرکت به بالا",
      "pan-down": "حرکت به پایین",
      still: "ثابت",
    },
    transitions: {
      cut: "برش مستقیم",
      fade: "محو شدن",
      "slide-left": "لغزش به چپ",
      "slide-right": "لغزش به راست",
      zoom: "زوم",
    },
    shapes: { "16:9": "افقی", "9:16": "عمودی", "1:1": "مربع" },
    qualities: { draft: "پیش‌نویس", standard: "استاندارد", high: "بالا" },
    stages: { loading: "در حال آماده‌سازی عکس‌ها", recording: "در حال ساخت فیلم" },
    errors: {
      invalid: "پروژهٔ فیلم درست نیست. عکس‌ها را دوباره اضافه کن.",
      no_images: "هیچ‌کدام از عکس‌ها باز نشد. دوباره امتحان کن.",
      cancelled: "ساخت فیلم لغو شد.",
      unsupported: "این مرورگر نمی‌تواند فیلم بسازد. Chrome یا Safari تازه را امتحان کن.",
      failed: "ساخت فیلم نشد. دوباره امتحان کن.",
      not_image: "این فایل عکس نیست.",
      too_large: "این عکس خیلی بزرگ است.",
      too_small: "این عکس خیلی کوچک است.",
      unreadable: "این عکس باز نشد.",
    },
    seconds: "ثانیه",
    scenesTruncated: (kept) => `فقط ${formatNumber(kept, "fa")} عکس اول استفاده شد.`,
    scenesDropped: (count) => `${formatNumber(count, "fa")} عکس قابل استفاده نبود و کنار گذاشته شد.`,
    durationTruncated: (kept) => `فیلم از ۱۰ دقیقه بیشتر می‌شد؛ فقط ${formatNumber(kept, "fa")} عکس اول آمد.`,
    failedScenes: (count) => `${formatNumber(count, "fa")} عکس باز نشد و در فیلم سیاه ماند.`,
  },
  en: {
    title: "Make a film",
    subtitle: "Turn your photos into a film, on your own phone: free and unlimited",
    addPhoto: "Take a photo or choose from the gallery",
    photos: "Photos",
    noPhotos: "No photos added yet",
    removePhoto: "Remove photo",
    moveEarlier: "Earlier",
    moveLater: "Later",
    secondsLabel: "How long it shows",
    motionLabel: "Camera movement",
    transitionLabel: "Change to the next photo",
    captionLabel: "Caption",
    captionPlaceholder: "One sentence on the photo (optional)",
    shapeLabel: "Film shape",
    qualityLabel: "Quality",
    make: "Make the film",
    cancel: "Cancel",
    download: "Download the film",
    makeAnother: "Make a new film",
    keepOpen: "Keep this page open until the film is made",
    done: "Your film is ready",
    total: "Film length",
    motions: {
      "zoom-in": "Move closer",
      "zoom-out": "Move away",
      "pan-left": "Pan left",
      "pan-right": "Pan right",
      "pan-up": "Pan up",
      "pan-down": "Pan down",
      still: "Still",
    },
    transitions: {
      cut: "Straight cut",
      fade: "Fade",
      "slide-left": "Slide left",
      "slide-right": "Slide right",
      zoom: "Zoom",
    },
    shapes: { "16:9": "Wide", "9:16": "Tall", "1:1": "Square" },
    qualities: { draft: "Draft", standard: "Standard", high: "High" },
    stages: { loading: "Getting the photos ready", recording: "Making the film" },
    errors: {
      invalid: "The film project is not valid. Add the photos again.",
      no_images: "None of the photos could be opened. Try again.",
      cancelled: "The film was cancelled.",
      unsupported: "This browser cannot make films. Try a recent Chrome or Safari.",
      failed: "The film could not be made. Try again.",
      not_image: "This file is not a photo.",
      too_large: "This photo is too large.",
      too_small: "This photo is too small.",
      unreadable: "This photo could not be opened.",
    },
    seconds: "s",
    scenesTruncated: (kept) => `Only the first ${formatNumber(kept, "en")} photos were used.`,
    scenesDropped: (count) => `${formatNumber(count, "en")} photo(s) could not be used and were left out.`,
    durationTruncated: (kept) => `The film would be over 10 minutes; only the first ${formatNumber(kept, "en")} photos were used.`,
    failedScenes: (count) => `${formatNumber(count, "en")} photo(s) could not be opened and stay black in the film.`,
  },
};

// The text of an error; anything unknown reads as a general failure.
export function errorText(lang: Lang, code: string): string {
  const errors = STUDIO_TEXT[lang].errors as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(errors, code) ? errors[code] : STUDIO_TEXT[lang].errors.failed;
}

// What the person is told about changes made to the project, one line each.
export function warningText(lang: Lang, warning: StudioWarning): string {
  const text = STUDIO_TEXT[lang];
  switch (warning.code) {
    case "scene_dropped":
      return text.scenesDropped(1);
    case "scenes_truncated":
      return text.scenesTruncated(warning.kept);
    case "duration_truncated":
      return text.durationTruncated(warning.kept);
  }
}

// "Making the film 42%" for the progress line (progress is 0 to 1).
export function progressText(lang: Lang, stage: FilmStage, progress: number): string {
  const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return `${STUDIO_TEXT[lang].stages[stage]} ${formatPercent(safe * 100, lang)}`;
}

// A length as minutes and seconds: 150 -> "2:30" (Persian digits in Persian).
export function clockText(seconds: number, lang: Lang): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${formatNumber(minutes, lang)}:${formatNumber(Math.floor(rest / 10), lang)}${formatNumber(rest % 10, lang)}`;
}
