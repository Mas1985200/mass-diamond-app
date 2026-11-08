// supabase/functions/ai-chat/video/args.ts
// Reads what the model wrote when it asks for a video (the arguments of the
// create_video tool) and turns it into a request the video function accepts.
// Pure code (no network, no Deno), so it is tested directly.
//
// The model is allowed to be a little sloppy about the settings (a wrong word,
// a number out of range): those fall back to safe values, so a good idea is
// never lost over a typo. The idea and the engine prompt are required: without
// them there is nothing to make.

export const MAX_IDEA_CHARS = 1_000;
export const MAX_ENGINE_PROMPT_CHARS = 1_200;
// The longest video any connected engine can make today. Raised here when a
// longer engine is added.
export const MAX_VIDEO_SECONDS = 5;
export const DEFAULT_VIDEO_SECONDS = 5;

export type VideoStyleName =
  | "auto"
  | "realistic"
  | "cinematic"
  | "animation"
  | "advertising"
  | "educational";
export type VideoAspect = "16:9" | "9:16" | "1:1";
export type VideoQualityName = "draft" | "standard" | "high";

export interface CreateVideoArgs {
  idea: string;
  enginePrompt: string;
  style: VideoStyleName;
  aspectRatio: VideoAspect;
  durationSeconds: number;
  quality: VideoQualityName;
  // "auto" unless the person asked for one specific model.
  model: string;
}

export type ParsedArgs =
  | { ok: true; value: CreateVideoArgs }
  | { ok: false; hint: string };

const STYLES: readonly VideoStyleName[] = [
  "auto",
  "realistic",
  "cinematic",
  "animation",
  "advertising",
  "educational",
];
const ASPECTS: readonly VideoAspect[] = ["16:9", "9:16", "1:1"];
const QUALITIES: readonly VideoQualityName[] = ["draft", "standard", "high"];

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max).trim() : "";
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const wanted = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.find((item) => item === wanted) ?? fallback;
}

// "16:9", "16/9", "16x9", "9 : 16" and the words people use for the same
// shapes all mean the same thing.
function aspect(value: unknown): VideoAspect {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const compact = raw.replace(/\s+/g, "").replace(/[/x×]/g, ":");
  if (compact === "16:9" || raw === "landscape" || raw === "horizontal" || raw === "wide") {
    return "16:9";
  }
  if (compact === "9:16" || raw === "portrait" || raw === "vertical") {
    return "9:16";
  }
  if (compact === "1:1" || raw === "square") return "1:1";
  return "16:9";
}

function seconds(value: unknown): number {
  // Absent or blank means "not said": the usual length, not one second.
  if (value === null || value === undefined || value === "") {
    return DEFAULT_VIDEO_SECONDS;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VIDEO_SECONDS;
  return Math.min(MAX_VIDEO_SECONDS, Math.max(1, Math.round(n)));
}

function modelName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name) ? name : "auto";
}

export function parseCreateVideoArgs(args: Record<string, unknown>): ParsedArgs {
  const idea = text(args.idea, MAX_IDEA_CHARS);
  const enginePrompt = text(args.engine_prompt, MAX_ENGINE_PROMPT_CHARS);

  if (!idea) {
    return { ok: false, hint: "idea is required: what the user asked for, in their words." };
  }
  if (!enginePrompt) {
    return { ok: false, hint: "engine_prompt is required: the full professional English prompt for the video." };
  }

  return {
    ok: true,
    value: {
      idea,
      enginePrompt,
      style: oneOf(args.style, STYLES, "auto"),
      aspectRatio: aspect(args.aspect_ratio),
      durationSeconds: seconds(args.duration_seconds),
      quality: oneOf(args.quality, QUALITIES, "standard"),
      model: modelName(args.model),
    },
  };
}
