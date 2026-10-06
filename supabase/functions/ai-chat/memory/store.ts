// supabase/functions/ai-chat/memory/store.ts
// Database access for long-term memory: user facts and conversation summaries.
// The server uses the service role, so every query filters by user_id itself.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeError } from "../lib/util.ts";

const FACTS_CHAR_BUDGET = 1_500;
const MAX_FACTS = 40;
const FACT_MAX_CHARS = 300;
const SUMMARIES_LIMIT = 3;
const SUMMARY_MAX_CHARS = 600;
const SUMMARY_STORE_MAX_CHARS = 1_200;

export type AddFactResult = "saved" | "duplicate" | "full" | "invalid" | "error";

function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\s]+/g, "");
}

// Newest facts first inside the character budget, returned oldest to newest.
export async function loadFacts(
  adminClient: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await adminClient
    .from("user_memory_facts")
    .select("content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_FACTS);

  if (error) {
    console.error(`memory: failed to load facts: ${error.message}`);

    return [];
  }

  const facts: string[] = [];
  let used = 0;

  for (const row of data ?? []) {
    const content =
      typeof row.content === "string" ? row.content.trim() : "";

    if (!content) {
      continue;
    }

    if (used + content.length > FACTS_CHAR_BUDGET) {
      break;
    }

    used += content.length;
    facts.push(content);
  }

  return facts.reverse();
}

export async function addFact(
  adminClient: SupabaseClient,
  userId: string,
  raw: string,
): Promise<AddFactResult> {
  const content = raw.replace(/\s+/g, " ").trim().slice(0, FACT_MAX_CHARS);

  if (content.length < 2) {
    return "invalid";
  }

  try {
    const { data, error } = await adminClient
      .from("user_memory_facts")
      .select("content")
      .eq("user_id", userId)
      .limit(MAX_FACTS + 1);

    if (error) {
      console.error(`memory: failed to check facts: ${error.message}`);

      return "error";
    }

    const existing = (data ?? []).map((row) =>
      typeof row.content === "string" ? normalizeFact(row.content) : "",
    );

    if (existing.includes(normalizeFact(content))) {
      return "duplicate";
    }

    if (existing.length >= MAX_FACTS) {
      return "full";
    }

    const { error: insertError } = await adminClient
      .from("user_memory_facts")
      .insert({ user_id: userId, content });

    if (insertError) {
      console.error(`memory: failed to save fact: ${insertError.message}`);

      return "error";
    }

    return "saved";
  } catch (error) {
    console.error(`memory: addFact threw: ${describeError(error)}`);

    return "error";
  }
}

// Summaries of the user's most recent other conversations, newest first.
export async function loadRecentSummaries(
  adminClient: SupabaseClient,
  userId: string,
  excludeConversationId: string,
): Promise<string[]> {
  const { data, error } = await adminClient
    .from("conversation_summaries")
    .select("summary")
    .eq("user_id", userId)
    .neq("conversation_id", excludeConversationId)
    .order("updated_at", { ascending: false })
    .limit(SUMMARIES_LIMIT);

  if (error) {
    console.error(`memory: failed to load summaries: ${error.message}`);

    return [];
  }

  const summaries: string[] = [];

  for (const row of data ?? []) {
    const summary =
      typeof row.summary === "string" ? row.summary.trim() : "";

    if (summary) {
      summaries.push(summary.slice(0, SUMMARY_MAX_CHARS));
    }
  }

  return summaries;
}

export async function saveSummary(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  summary: string,
): Promise<void> {
  const clean = summary.replace(/\s+/g, " ").trim().slice(0, SUMMARY_STORE_MAX_CHARS);

  if (!clean) {
    return;
  }

  const { error } = await adminClient.from("conversation_summaries").upsert(
    {
      conversation_id: conversationId,
      user_id: userId,
      summary: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" },
  );

  if (error) {
    console.error(`memory: failed to save summary: ${error.message}`);
  }
}
