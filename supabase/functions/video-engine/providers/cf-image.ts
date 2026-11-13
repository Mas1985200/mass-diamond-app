// supabase/functions/video-engine/providers/cf-image.ts
// The first half of "video from a text": a still picture made from the text by
// Cloudflare Workers AI (free daily allowance). The video engine then brings
// that picture to life, so the look of the scene comes from an image model and
// the motion from the video model.
//
// The picture is returned as a data link (data:image/...;base64,...), so no
// storage is needed in between. Every failure is reported with a clear code;
// nothing here ever invents a picture.
//
// Secrets: CF_ACCOUNT_ID and CF_AI_TOKEN (required). Optional: CF_IMAGE_MODEL
// (default below). A model whose name contains "flux-1" takes no size, so the
// picture is square; every other model gets the width and height.

import { ProviderError, type AspectRatio } from "./types.ts";

export const DEFAULT_IMAGE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const MAX_PROMPT_CHARS = 1000;
const IMAGE_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Multiples of 8, large enough for the video model, small enough to be fast.
export const IMAGE_SIZES: Readonly<Record<AspectRatio, readonly [number, number]>> = {
  "16:9": [1024, 576],
  "9:16": [576, 1024],
  "1:1": [768, 768],
};

export interface ImageConfig {
  accountId: string;
  token: string;
  model: string;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  seed?: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readImageConfig(env: Env): ImageConfig | null {
  const accountId = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_AI_TOKEN?.trim();
  if (!accountId || !token) return null;
  const model = env.CF_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  return { accountId, token, model };
}

// The JSON body for the model. The same rules for every request.
export function buildImageBody(
  model: string,
  request: ImageRequest,
): Record<string, unknown> {
  const prompt = request.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  const seed =
    request.seed !== undefined && Number.isFinite(request.seed)
      ? Math.abs(Math.floor(request.seed)) % 2_147_483_647
      : undefined;

  if (model.includes("flux-1")) {
    return { prompt, steps: 4, ...(seed !== undefined ? { seed } : {}) };
  }
  const [width, height] = IMAGE_SIZES[request.aspectRatio];
  return {
    prompt,
    width,
    height,
    num_steps: 8,
    ...(seed !== undefined ? { seed } : {}),
  };
}

// The picture type, found from the first bytes of the base64 text.
export function mimeOfBase64(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function errorText(body: unknown): string {
  if (body && typeof body === "object") {
    const errors = (body as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      return errors
        .map((e) =>
          e && typeof e === "object"
            ? String((e as { message?: unknown }).message ?? "")
            : String(e),
        )
        .filter(Boolean)
        .join("; ");
    }
  }
  return "";
}

// A short, safe description of why a call failed (never the token or the body).
function reasonOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return String(error).slice(0, 160);
}

// Sorts a failed answer into a clear, honest error.
export function imageError(status: number, text: string): ProviderError {
  const lower = text.toLowerCase();
  if (/daily free allocation|neurons|4006|quota/.test(lower)) {
    return new ProviderError("quota_exhausted", "image: the daily free allowance is used up", false);
  }
  if (/nsfw|safety|policy|moderation|not allowed/.test(lower)) {
    return new ProviderError("content_rejected", "image: the request was refused by the safety filter", false);
  }
  if (status === 401 || status === 403) {
    return new ProviderError("engine_error", `image: access refused (${status})`, false);
  }
  if (status === 429) {
    return new ProviderError("rate_limited", "image: too many requests", true);
  }
  if (status >= 500) {
    return new ProviderError("engine_busy", `image: engine unavailable (${status})`, true);
  }
  return new ProviderError("engine_error", `image: unexpected status ${status}`, false);
}

// Makes the picture and returns it as a data link.
export async function generateImage(
  config: ImageConfig,
  request: ImageRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  // One controller for both reasons to stop: the caller gave up, or we waited
  // too long. (No AbortSignal.any, so it works in every runtime.)
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, IMAGE_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `${API_BASE}/${encodeURIComponent(config.accountId)}/ai/run/${config.model}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(buildImageBody(config.model, request)),
        signal: controller.signal,
      },
    );
  } catch (error) {
    throw new ProviderError(
      "timeout",
      `image: no answer from the image engine (${timedOut ? "waited too long" : reasonOf(error)})`,
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  const type = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw imageError(response.status, errorText(body));
  }

  // Some models answer with the picture itself.
  if (type.startsWith("image/")) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderError("bad_response", "image: the picture has a wrong size", true);
    }
    return `data:${type.split(";")[0]};base64,${bytesToBase64(bytes)}`;
  }

  // Others answer with JSON: {"result": {"image": "<base64>"}, "success": true}.
  const body = (await response.json().catch(() => null)) as
    | { success?: unknown; result?: unknown }
    | null;
  if (body?.success === false) {
    throw imageError(response.status, errorText(body));
  }
  const result = body?.result;
  const image =
    typeof result === "string"
      ? result
      : result && typeof result === "object"
        ? (result as { image?: unknown }).image
        : undefined;
  if (typeof image !== "string" || image.length < 100) {
    throw new ProviderError("bad_response", "image: the answer had no picture", true);
  }
  if (image.startsWith("data:image/")) return image;
  return `data:${mimeOfBase64(image)};base64,${image}`;
}

// end of cf-image.ts
