// supabase/functions/transcribe/index.ts
// Speech to text: a short voice recording in, its text out.
// Self-contained on purpose (no imports from other functions).
//
// Request: POST multipart/form-data
//   audio    the recording (webm, mp4/m4a, ogg, mp3, wav)
//   language optional ISO code such as "fa" or "en"; empty = auto-detect
// Answer: { success: true, text, requestId }
//      or { success: false, error: { code, message, retryable }, requestId }
//
// Uses the same secret as the chat (GROQ_API_KEY). The model can be changed
// with the optional secret GROQ_STT_MODEL.

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MIN_AUDIO_BYTES = 800;
const AUTH_TIMEOUT_MS = 6_000;
const TRANSCRIBE_TIMEOUT_MS = 25_000;
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/;
const MAX_TEXT_CHARS = 4_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "AUTH_REQUIRED"
  | "METHOD_NOT_ALLOWED"
  | "BAD_REQUEST"
  | "AUDIO_TOO_LARGE"
  | "AUDIO_TOO_SHORT"
  | "UNSUPPORTED_AUDIO"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    },
  });
}

function fail(
  requestId: string,
  status: number,
  code: ErrorCode,
  message: string,
  retryable: boolean,
  extra: Record<string, string> = {},
): Response {
  return json(
    { success: false, error: { code, message, retryable }, requestId },
    status,
    extra,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The user must be signed in: the token is checked by the auth service.
async function isSignedIn(request: Request): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!token || !url || !anonKey) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The provider decides the format from the file name, so it must end with the
// right extension for what the browser recorded.
function fileNameFor(mime: string): string | null {
  const type = mime.toLowerCase().split(";")[0]?.trim() ?? "";

  if (type === "audio/webm" || type === "video/webm") return "audio.webm";
  if (type === "audio/mp4" || type === "video/mp4" || type === "audio/x-m4a" || type === "audio/m4a") return "audio.m4a";
  if (type === "audio/ogg" || type === "application/ogg") return "audio.ogg";
  if (type === "audio/mpeg" || type === "audio/mp3") return "audio.mp3";
  if (type === "audio/wav" || type === "audio/x-wav" || type === "audio/wave") return "audio.wav";

  return null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return fail(requestId, 405, "METHOD_NOT_ALLOWED", "Only POST is allowed.", false);
  }

  try {
    if (!(await isSignedIn(request))) {
      return fail(requestId, 401, "AUTH_REQUIRED", "Sign in is required.", false);
    }

    const apiKey = Deno.env.get("GROQ_API_KEY")?.trim();

    if (!apiKey) {
      console.error(`transcribe ${requestId}: GROQ_API_KEY is missing`);

      return fail(requestId, 500, "INTERNAL_ERROR", "Speech service is not configured.", false);
    }

    const declared = Number(request.headers.get("Content-Length") ?? "0");

    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + 64 * 1024) {
      return fail(requestId, 413, "AUDIO_TOO_LARGE", "The recording is too long.", false);
    }

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      return fail(requestId, 400, "BAD_REQUEST", "Send the recording as form data.", false);
    }

    const audio = form.get("audio");

    if (!(audio instanceof File)) {
      return fail(requestId, 400, "BAD_REQUEST", "The recording is missing.", false);
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return fail(requestId, 413, "AUDIO_TOO_LARGE", "The recording is too long.", false);
    }

    if (audio.size < MIN_AUDIO_BYTES) {
      return fail(requestId, 422, "AUDIO_TOO_SHORT", "The recording is too short.", false);
    }

    const name = fileNameFor(audio.type);

    if (!name) {
      return fail(requestId, 415, "UNSUPPORTED_AUDIO", "This audio format is not supported.", false);
    }

    const rawLanguage = form.get("language");
    const language =
      typeof rawLanguage === "string" &&
      LANGUAGE_PATTERN.test(rawLanguage.trim().toLowerCase())
        ? rawLanguage.trim().toLowerCase()
        : "";

    const model = Deno.env.get("GROQ_STT_MODEL")?.trim() || DEFAULT_MODEL;

    const upstream = new FormData();
    upstream.append("file", new File([audio], name, { type: audio.type }));
    upstream.append("model", model);
    upstream.append("response_format", "json");
    upstream.append("temperature", "0");

    if (language) {
      upstream.append("language", language);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(GROQ_TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;

      console.error(`transcribe ${requestId}: request failed: ${describeError(error).slice(0, 200)}`);

      return timedOut
        ? fail(requestId, 504, "TIMEOUT", "The speech service took too long.", true)
        : fail(requestId, 502, "PROVIDER_ERROR", "The speech service could not be reached.", true);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "");
      const seconds = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 10;

      console.error(`transcribe ${requestId}: rate limited, retry in ${seconds}s`);

      return fail(requestId, 429, "RATE_LIMITED", "Too many voice requests. Try again shortly.", true, {
        "Retry-After": String(seconds),
      });
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);

      console.error(`transcribe ${requestId}: provider status ${response.status}: ${detail}`);

      const badInput = response.status === 400 || response.status === 413 || response.status === 415;

      return badInput
        ? fail(requestId, 422, "UNSUPPORTED_AUDIO", "The recording could not be read.", false)
        : fail(requestId, 502, "PROVIDER_ERROR", "The speech service failed.", true);
    }

    const result: unknown = await response.json().catch(() => null);
    const text =
      typeof result === "object" &&
      result !== null &&
      typeof (result as { text?: unknown }).text === "string"
        ? (result as { text: string }).text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS)
        : "";

    // Sizes only, never the words that were said.
    console.log(
      JSON.stringify({
        event: "transcribe",
        requestId,
        model,
        bytes: audio.size,
        language: language || "auto",
        chars: text.length,
      }),
    );

    return json({ success: true, text, requestId });
  } catch (error) {
    console.error(`transcribe ${requestId}: failed: ${describeError(error).slice(0, 300)}`);

    return fail(requestId, 500, "INTERNAL_ERROR", "Something went wrong.", true);
  }
});
