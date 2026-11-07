// supabase/functions/video-engine/request.ts
// Checks the body of a "make a video" request before anything is charged or
// stored. Pure code (no network, no Deno), so it is tested directly. The same
// rules for every language and every kind of video; nothing is guessed: a
// value that is present but wrong is refused, a value that is absent gets the
// default.

import type {
  AspectRatio,
  VideoKind,
  VideoQuality,
  VideoStyle,
} from "./providers/types.ts";

export const MAX_PROMPT_CHARS = 8_000;
export const MAX_DURATION_SECONDS = 60;
export const MAX_IMAGES = 10;
const MAX_PATH_CHARS = 512;
const MAX_MODEL_CHARS = 64;

const KINDS: readonly VideoKind[] = [
  "text_to_video",
  "image_to_video",
  "multi_image_to_video",
];
const STYLES: readonly VideoStyle[] = [
  "auto",
  "realistic",
  "cinematic",
  "animation",
  "advertising",
  "educational",
];
const ASPECTS: readonly AspectRatio[] = ["16:9", "9:16", "1:1"];
const QUALITIES: readonly VideoQuality[] = ["draft", "standard", "high"];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VideoJobInput {
  clientRequestId: string;
  conversationId: string | null;
  parentJobId: string | null;
  kind: VideoKind;
  userPrompt: string;
  // The professional prompt written by the AI step; null when not given yet.
  enginePrompt: string | null;
  style: VideoStyle;
  aspectRatio: AspectRatio;
  durationSeconds: number;
  quality: VideoQuality;
  model: string;
  seed: number | null;
  // Storage paths in the "videos" bucket, all inside the owner's own folder.
  imagePaths: string[];
}

export type ParseResult =
  | { ok: true; value: VideoJobInput }
  | { ok: false; field: string; message: string };

const fail = (field: string, message: string): ParseResult => ({
  ok: false,
  field,
  message,
});

function pick<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T | null {
  if (raw === undefined || raw === null) return fallback;
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : null;
}

function optionalUuid(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : undefined;
}

// A path is acceptable only inside the owner's folder, with no way out of it.
function isOwnPath(path: unknown, userId: string): path is string {
  return (
    typeof path === "string" &&
    path.length <= MAX_PATH_CHARS &&
    path.startsWith(`${userId}/`) &&
    path.length > userId.length + 1 &&
    !path.split("/").some((part) => part === ".." || part === "." || part === "") &&
    !path.includes("\\")
  );
}

export function parseVideoRequest(body: unknown, userId: string): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("body", "The request must be a JSON object.");
  }
  const input = body as Record<string, unknown>;

  if (typeof input.client_request_id !== "string" || !UUID.test(input.client_request_id)) {
    return fail("client_request_id", "A request id (uuid) is required.");
  }

  if (typeof input.prompt !== "string") {
    return fail("prompt", "The video idea is required.");
  }
  const userPrompt = input.prompt.trim();
  if (userPrompt.length < 1 || userPrompt.length > MAX_PROMPT_CHARS) {
    return fail("prompt", `The idea must be 1-${MAX_PROMPT_CHARS} characters.`);
  }

  let enginePrompt: string | null = null;
  if (input.engine_prompt !== undefined && input.engine_prompt !== null) {
    if (typeof input.engine_prompt !== "string") {
      return fail("engine_prompt", "The engine prompt must be text.");
    }
    const trimmed = input.engine_prompt.trim();
    if (trimmed.length > MAX_PROMPT_CHARS) {
      return fail("engine_prompt", `The engine prompt is over ${MAX_PROMPT_CHARS} characters.`);
    }
    enginePrompt = trimmed || null;
  }

  const rawImages = input.image_paths ?? [];
  if (!Array.isArray(rawImages) || rawImages.length > MAX_IMAGES) {
    return fail("image_paths", `At most ${MAX_IMAGES} pictures.`);
  }
  const imagePaths: string[] = [];
  for (const path of rawImages) {
    if (!isOwnPath(path, userId)) {
      return fail("image_paths", "A picture is not in your own folder.");
    }
    imagePaths.push(path);
  }
  if (new Set(imagePaths).size !== imagePaths.length) {
    return fail("image_paths", "The same picture is listed twice.");
  }

  // The kind follows the pictures; a kind that disagrees with them is refused.
  const impliedKind: VideoKind =
    imagePaths.length === 0
      ? "text_to_video"
      : imagePaths.length === 1
        ? "image_to_video"
        : "multi_image_to_video";
  const kind = pick(input.kind, KINDS, impliedKind);
  if (kind === null || kind !== impliedKind) {
    return fail("kind", "The kind does not match the pictures given.");
  }

  const style = pick(input.style, STYLES, "auto");
  if (style === null) return fail("style", "Unknown style.");
  const aspectRatio = pick(input.aspect_ratio, ASPECTS, "16:9");
  if (aspectRatio === null) return fail("aspect_ratio", "Unknown aspect ratio.");
  const quality = pick(input.quality, QUALITIES, "standard");
  if (quality === null) return fail("quality", "Unknown quality.");

  let durationSeconds = 5;
  if (input.duration_seconds !== undefined && input.duration_seconds !== null) {
    const value = input.duration_seconds;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_DURATION_SECONDS
    ) {
      return fail("duration_seconds", `The length must be a whole number of 1-${MAX_DURATION_SECONDS} seconds.`);
    }
    durationSeconds = value;
  }

  let model = "auto";
  if (input.model !== undefined && input.model !== null) {
    if (
      typeof input.model !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*$/i.test(input.model) ||
      input.model.length > MAX_MODEL_CHARS
    ) {
      return fail("model", "Unknown model.");
    }
    model = input.model;
  }

  let seed: number | null = null;
  if (input.seed !== undefined && input.seed !== null) {
    if (
      typeof input.seed !== "number" ||
      !Number.isInteger(input.seed) ||
      input.seed < 0 ||
      input.seed > 2_147_483_647
    ) {
      return fail("seed", "The seed must be a whole number from 0 to 2147483647.");
    }
    seed = input.seed;
  }

  const conversationId = optionalUuid(input.conversation_id);
  if (conversationId === undefined) return fail("conversation_id", "Not a valid id.");
  const parentJobId = optionalUuid(input.parent_job_id);
  if (parentJobId === undefined) return fail("parent_job_id", "Not a valid id.");

  return {
    ok: true,
    value: {
      clientRequestId: input.client_request_id.toLowerCase(),
      conversationId,
      parentJobId,
      kind,
      userPrompt,
      enginePrompt,
      style,
      aspectRatio,
      durationSeconds,
      quality,
      model,
      seed,
      imagePaths,
    },
  };
}
