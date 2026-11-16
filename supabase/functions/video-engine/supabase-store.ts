// supabase/functions/video-engine/supabase-store.ts
// The real doors (see store.ts): the job table, the credit functions and the
// private "videos" storage bucket, reached with the server's service key.
// All of the rules live in engine.ts; this file only moves data.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.117.3";

import {
  buildCreditStatus,
  monthStartUtc,
  parseCreditDecision,
  type CreditStatus,
  type VideoLimits,
} from "./credits.ts";
import { rowToJob, type Job } from "./jobs.ts";
import { inputToRow, patchToRow } from "./rows.ts";
import type { JobStore, VideoFiles } from "./store.ts";

export const VIDEO_BUCKET = "videos";
const TABLE = "video_jobs";
// Postgres' "unique violation": the same request id came twice.
const UNIQUE_VIOLATION = "23505";

export function createServiceClient(
  url: string,
  serviceKey: string,
): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toJob(row: unknown): Job | null {
  return row === null || row === undefined ? null : rowToJob(row);
}

export function createSupabaseStore(
  client: SupabaseClient,
  limits: VideoLimits,
  now: () => number = Date.now,
): JobStore {
  const store: JobStore = {
    async findByRequest(userId, clientRequestId) {
      const { data, error } = await client
        .from(TABLE)
        .select("*")
        .eq("user_id", userId)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();
      if (error) throw new Error(`find job: ${error.message}`);
      return toJob(data);
    },

    async get(userId, jobId) {
      const { data, error } = await client
        .from(TABLE)
        .select("*")
        .eq("id", jobId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`get job: ${error.message}`);
      return toJob(data);
    },

    async insert(userId, input, creditsCharged) {
      const { data, error } = await client
        .from(TABLE)
        .insert(inputToRow(userId, input, creditsCharged))
        .select("*")
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          const existing = await store.findByRequest(userId, input.clientRequestId);
          if (existing) return { job: existing, created: false };
        }
        throw new Error(`insert job: ${error.message}`);
      }
      const job = toJob(data);
      if (!job) throw new Error("insert job: the saved row is not a valid job");
      return { job, created: true };
    },

    async update(jobId, patch) {
      const row = patchToRow(patch);
      if (Object.keys(row).length === 0) return null;
      const { data, error } = await client
        .from(TABLE)
        .update(row)
        .eq("id", jobId)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(`update job: ${error.message}`);
      return toJob(data);
    },

    // One database statement: it only changes a job that is still running and
    // not held by someone else, so two requests can never both get it.
    async claim(jobId, leaseMs) {
      const at = now();
      const { data, error } = await client
        .from(TABLE)
        .update({ locked_until: new Date(at + leaseMs).toISOString() })
        .eq("id", jobId)
        .in("status", ["queued", "processing"])
        .or(`locked_until.is.null,locked_until.lt.${new Date(at).toISOString()}`)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(`claim job: ${error.message}`);
      return toJob(data);
    },

    async list(userId, limit, beforeCreatedAt) {
      let query = client
        .from(TABLE)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(1, Math.floor(limit)), 100));
      if (beforeCreatedAt) query = query.lt("created_at", beforeCreatedAt);
      const { data, error } = await query;
      if (error) throw new Error(`list jobs: ${error.message}`);
      return (data ?? []).map(toJob).filter((job): job is Job => job !== null);
    },

    async consumeCredits(userId, cost) {
      const { data, error } = await client.rpc("consume_video_credits", {
        p_user: userId,
        p_cost: cost,
        p_free_limit: limits.free,
        p_pro_limit: limits.pro,
      });
      // An error or an unreadable answer is "unknown": a refusal, never free.
      if (error) {
        console.error("consume_video_credits failed:", error.message);
        return null;
      }
      return parseCreditDecision(data);
    },

    async refundCredits(userId, cost, chargedAt) {
      const { error } = await client.rpc("refund_video_credits", {
        p_user: userId,
        p_cost: cost,
        p_charged_at: chargedAt,
      });
      // The job is already ended; a failed refund is reported loudly so it
      // can be fixed by hand, and never hides the job's real state.
      if (error) {
        console.error(
          `refund_video_credits failed (user ${userId}, ${cost} credits):`,
          error.message,
        );
      }
    },
  };
  return store;
}

// Reads what is left of this month's credits without taking any. The plan and
// the month's use are read the same way the credit function in the database
// reads them. null when either cannot be read: never a guessed number.
export function createCreditReader(
  client: SupabaseClient,
  limits: VideoLimits,
  now: () => number = Date.now,
): (userId: string) => Promise<CreditStatus | null> {
  return async (userId) => {
    const at = now();

    const plans = await client
      .from("user_plans")
      .select("plan")
      .eq("user_id", userId)
      .eq("plan", "pro")
      .or(`expires_at.is.null,expires_at.gt.${new Date(at).toISOString()}`)
      .limit(1);
    if (plans.error) {
      console.error("read plan failed:", plans.error.message);
      return null;
    }

    const usage = await client
      .from("video_usage")
      .select("credits")
      .eq("user_id", userId)
      .eq("month", monthStartUtc(at))
      .maybeSingle();
    if (usage.error) {
      console.error("read video usage failed:", usage.error.message);
      return null;
    }

    const plan = (plans.data ?? []).length > 0 ? "pro" : "free";
    return buildCreditStatus(plan, usage.data?.credits ?? 0, limits, at);
  };
}

export function createSupabaseFiles(client: SupabaseClient): VideoFiles {
  return {
    async upload(path, bytes, contentType) {
      const { error } = await client.storage
        .from(VIDEO_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`upload: ${error.message}`);
    },

    async signedUrl(path, ttlSeconds) {
      const { data, error } = await client.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(path, ttlSeconds);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
  };
}

// end of supabase-store.ts
