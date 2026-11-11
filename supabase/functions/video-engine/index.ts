// supabase/functions/video-engine/index.ts
// The video function: makes videos, follows them to the end, cancels them and
// lists the person's videos. Every rule lives in the other files of this
// folder; this file only does what needs the real world: the CORS answer, the
// sign-in check, reading the secrets and wiring the real database, storage
// and engines together.
//
// Request: POST application/json {"action": "models" | "submit" | "status" |
//   "cancel" | "list", ...}  (see api.ts for the fields)
// Answer: {"ok":true,...} or {"ok":false,"error":{code,message,retryable}}
//
// Secrets: HF_TOKEN (the free Wan engine; optional HF_VIDEO_SPACE_URL and
// HF_VIDEO_API_NAME), CF_ACCOUNT_ID and CF_AI_TOKEN (the picture maker that
// turns a text into the first picture; optional CF_IMAGE_MODEL),
// VIDEO_FREE_MONTHLY_CREDITS and VIDEO_PRO_MONTHLY_CREDITS (optional plan
// sizes). SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase.

import { handleVideoApi, type ApiDeps } from "./api.ts";
import { readVideoLimits } from "./credits.ts";
import { createDownloadVideo } from "./download.ts";
import {
  advanceVideo,
  cancelVideo,
  presentJob,
  submitVideo,
  type EngineDeps,
} from "./engine.ts";
import { describeModels } from "./providers/registry.ts";
import { createWanSpaceProvider } from "./providers/wan-space.ts";
import {
  createServiceClient,
  createSupabaseFiles,
  createSupabaseStore,
} from "./supabase-store.ts";

const MAX_BODY_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 6_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorBody(code: string, message: string, retryable: boolean) {
  return { ok: false, error: { code, message, retryable } };
}

// The person must be signed in: the token is checked by the auth service.
async function signedInUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anonKey) return null;

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const user: unknown = await response.json().catch(() => null);
    const id =
      typeof user === "object" && user !== null
        ? (user as { id?: unknown }).id
        : null;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

async function readJson(request: Request): Promise<unknown | undefined> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function buildEngine(): EngineDeps | null {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;

  // Only the secrets the engines need are handed to them.
  const env: Record<string, string | undefined> = {
    HF_TOKEN: Deno.env.get("HF_TOKEN"),
    HF_VIDEO_SPACE_URL: Deno.env.get("HF_VIDEO_SPACE_URL"),
    HF_VIDEO_API_NAME: Deno.env.get("HF_VIDEO_API_NAME"),
    CF_ACCOUNT_ID: Deno.env.get("CF_ACCOUNT_ID"),
    CF_AI_TOKEN: Deno.env.get("CF_AI_TOKEN"),
    CF_IMAGE_MODEL: Deno.env.get("CF_IMAGE_MODEL"),
  };
  const client = createServiceClient(url, serviceKey);

  return {
    store: createSupabaseStore(client, readVideoLimits((n) => Deno.env.get(n))),
    files: createSupabaseFiles(client),
    download: createDownloadVideo({ hfToken: env.HF_TOKEN }),
    // Best engine first. More engines are added to this list.
    providers: [createWanSpaceProvider(env)],
    env,
    now: Date.now,
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return respond(405, errorBody("METHOD_NOT_ALLOWED", "Only POST is allowed.", false));
  }

  try {
    const userId = await signedInUserId(request);
    if (!userId) {
      return respond(401, errorBody("AUTH_REQUIRED", "Sign in is required.", false));
    }

    const body = await readJson(request);
    if (body === undefined) {
      return respond(400, errorBody("INVALID_REQUEST", "The request body is not valid JSON or is too large.", false));
    }

    const engine = buildEngine();
    if (!engine) {
      console.error("video-engine: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
      return respond(500, errorBody("INTERNAL_ERROR", "The video service is not set up.", true));
    }

    const api: ApiDeps = {
      userId,
      submit: (input) => submitVideo(engine, userId, input),
      advance: (jobId) => advanceVideo(engine, userId, jobId),
      cancel: (jobId) => cancelVideo(engine, userId, jobId),
      list: (limit, before) => engine.store.list(userId, limit, before),
      present: (job) => presentJob(engine, job),
      models: () => describeModels(engine.providers, engine.env),
    };

    const result = await handleVideoApi(api, body);
    return respond(result.status, result.body);
  } catch (error) {
    console.error("video-engine failed:", error);
    return respond(500, errorBody("INTERNAL_ERROR", "The video service failed. Try again.", true));
  }
});
