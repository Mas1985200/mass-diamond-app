// supabase/functions/ai-chat/quota/gate.ts
// Counts one AI message for a user in the database, and gives it back when the
// assistant could not answer. The counting itself is one atomic database
// function (consume_ai_message), so it is the same for every running copy of
// this function.
//
// If the database cannot be asked (an outage, or the migration was not run
// yet) the user is let through and the problem is logged: the limit protects
// the AI quota, and it must never take the whole assistant down.

import { describeError } from "../lib/util.ts";
import { parseDecision, type Limits, type QuotaDecision } from "./limits.ts";

// The small part of the Supabase client that is used here.
export interface RpcClient {
  readonly rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    readonly data: unknown;
    readonly error: { readonly message: string } | null;
  }>;
}

// null = could not be checked (the caller lets the user through).
export async function takeMessage(
  client: RpcClient,
  userId: string,
  limits: Limits,
): Promise<QuotaDecision | null> {
  try {
    const { data, error } = await client.rpc("consume_ai_message", {
      p_user: userId,
      p_free_limit: limits.free,
      p_pro_limit: limits.pro,
    });

    if (error) {
      console.error(`quota: check failed: ${error.message.slice(0, 200)}`);

      return null;
    }

    const decision = parseDecision(data);

    if (!decision) {
      console.error("quota: the database answered in an unexpected shape.");
    }

    return decision;
  } catch (error) {
    console.error(`quota: check failed: ${describeError(error).slice(0, 200)}`);

    return null;
  }
}

// Never throws: a failed refund must not hide the real answer or error.
export async function giveBackMessage(
  client: RpcClient,
  userId: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("refund_ai_message", { p_user: userId });

    if (error) {
      console.error(`quota: refund failed: ${error.message.slice(0, 200)}`);
    }
  } catch (error) {
    console.error(`quota: refund failed: ${describeError(error).slice(0, 200)}`);
  }
}
