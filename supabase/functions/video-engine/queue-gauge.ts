// supabase/functions/video-engine/queue-gauge.ts
// Counts the videos that are queued or being made, for the doorman (see
// admission.ts). The database client is only used as a type here, so this file
// runs under plain Node and is tested with a small fake client.
//
// A video older than the time a job may live (JOB_DEADLINE_MS) is not counted:
// its person closed the app and it will never be finished, so it must not fill
// the queue or lock the person out for ever. A count that cannot be read is
// null: never a guessed number.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

import { parseCount } from "./admission.ts";
import { JOB_DEADLINE_MS } from "./jobs.ts";
import type { QueueGauge } from "./store.ts";

const TABLE = "video_jobs";

export function createQueueGauge(
  client: SupabaseClient,
  now: () => number = Date.now,
): QueueGauge {
  async function count(userId: string | null): Promise<number | null> {
    let query = client
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"])
      .gt("created_at", new Date(now() - JOB_DEADLINE_MS).toISOString());
    if (userId !== null) query = query.eq("user_id", userId);
    const { count: total, error } = await query;
    if (error) {
      console.error("count active videos failed:", error.message);
      return null;
    }
    return parseCount(total);
  }

  return {
    countActive: (userId) => count(userId),
    countAllActive: () => count(null),
  };
}

// end of queue-gauge.ts
