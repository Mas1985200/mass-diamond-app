// supabase/functions/video-engine/api.ts
// The answers of the video function: which action was asked, what to answer
// and with which status. Pure code (no network, no Deno): the engine's
// functions are given in, so every answer is tested with simple stubs.
//
// Every answer is {"ok":true,...} or {"ok":false,"error":{code,message,
// retryable,...}}. The codes are stable; the app turns them into text.

import { CREDITS_PER_SECOND } from "./credits.ts";
import type { Job, PublicJob } from "./jobs.ts";
import { AUTO_MODEL, type ModelInfo } from "./providers/registry.ts";
import { parseVideoRequest, type VideoJobInput } from "./request.ts";
import type { SubmitOutcome } from "./engine.ts";

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  userId: string;
  submit(input: VideoJobInput): Promise<SubmitOutcome>;
  advance(jobId: string): Promise<Job | null>;
  cancel(jobId: string): Promise<Job | null>;
  list(limit: number, before?: string): Promise<Job[]>;
  present(job: Job): Promise<PublicJob>;
  models(): ModelInfo[];
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_LIST = 20;
export const MAX_LIST = 50;

function fail(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  extra: Record<string, unknown> = {},
): ApiResult {
  return {
    status,
    body: { ok: false, error: { code, message, retryable, ...extra } },
  };
}

const ok = (extra: Record<string, unknown>): ApiResult => ({
  status: 200,
  body: { ok: true, ...extra },
});

function submitFailure(outcome: Extract<SubmitOutcome, { ok: false }>): ApiResult {
  switch (outcome.code) {
    case "quota_exceeded":
      return fail(429, "VIDEO_QUOTA_EXCEEDED", "The video credits of this plan are used up.", false, {
        quota: outcome.quota,
      });
    case "no_engine":
      return fail(503, "VIDEO_ENGINE_UNAVAILABLE", "No video engine is available now.", true);
    case "unknown_model":
      return fail(400, "UNKNOWN_MODEL", "This video model does not exist.", false);
    case "unsupported_request":
      return fail(400, "UNSUPPORTED_REQUEST", "This model cannot make that video.", false);
    case "storage_unavailable":
      return fail(502, "STORAGE_UNAVAILABLE", "The pictures could not be read.", true);
    case "credits_unavailable":
      return fail(503, "CREDITS_UNAVAILABLE", "The credits could not be checked now.", true);
  }
}

function jobIdOf(body: Record<string, unknown>): string | null {
  const id = body.job_id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

export async function handleVideoApi(
  deps: ApiDeps,
  body: unknown,
): Promise<ApiResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "INVALID_REQUEST", "The request must be a JSON object.", false, { field: "body" });
  }
  const input = body as Record<string, unknown>;

  switch (input.action) {
    case "models":
      return ok({
        default: AUTO_MODEL,
        creditsPerSecond: CREDITS_PER_SECOND,
        models: deps.models().map((m) => ({
          id: m.id,
          label: m.label,
          free: m.free,
          available: m.available,
          kinds: m.kinds,
          aspectRatios: m.aspectRatios,
          maxDurationSeconds: m.maxDurationSeconds,
        })),
      });

    case "submit": {
      const parsed = parseVideoRequest(input, deps.userId);
      if (!parsed.ok) {
        return fail(400, "INVALID_REQUEST", parsed.message, false, { field: parsed.field });
      }
      const outcome = await deps.submit(parsed.value);
      if (!outcome.ok) return submitFailure(outcome);
      return ok({ existing: outcome.existing, job: await deps.present(outcome.job) });
    }

    case "status":
    case "cancel": {
      const id = jobIdOf(input);
      if (!id) return fail(400, "INVALID_REQUEST", "A job id is required.", false, { field: "job_id" });
      const job = input.action === "status" ? await deps.advance(id) : await deps.cancel(id);
      if (!job) return fail(404, "JOB_NOT_FOUND", "This video was not found.", false);
      return ok({ job: await deps.present(job) });
    }

    case "list": {
      let limit = DEFAULT_LIST;
      if (input.limit !== undefined && input.limit !== null) {
        if (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIST) {
          return fail(400, "INVALID_REQUEST", `The limit must be a whole number of 1-${MAX_LIST}.`, false, { field: "limit" });
        }
        limit = input.limit;
      }
      let before: string | undefined;
      if (input.before !== undefined && input.before !== null) {
        if (typeof input.before !== "string" || !Number.isFinite(Date.parse(input.before))) {
          return fail(400, "INVALID_REQUEST", "The before value must be a date.", false, { field: "before" });
        }
        before = new Date(input.before).toISOString();
      }
      const jobs = await deps.list(limit, before);
      return ok({ jobs: await Promise.all(jobs.map((job) => deps.present(job))) });
    }

    default:
      return fail(400, "INVALID_REQUEST", "Unknown action.", false, { field: "action" });
  }
}
