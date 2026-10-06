// supabase/functions/ai-chat/history/store.ts
// Database access for conversations and messages.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_HISTORY_MESSAGES } from "../config.ts";
import type { AIMessage, ChatMessageRow } from "../types.ts";
import { stripMarkers } from "../cards/codec.ts";

export async function conversationExists(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await adminClient
    .from("chat_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }

  return data !== null;
}

export async function loadHistory(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<AIMessage[]> {
  const { data, error } = await adminClient
    .from("chat_messages")
    .select("id, conversation_id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  if (error) {
    throw new Error(`Failed to load chat history: ${error.message}`);
  }

  const rows = ((data ?? []) as ChatMessageRow[]).slice().reverse();

  return rows
    .map((row) => ({
      role: row.role,
      content: stripMarkers(row.content),
    }))
    .filter((message) => message.content.length > 0);
}

export async function createConversation(
  adminClient: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await adminClient
    .from("chat_conversations")
    .insert({
      user_id: userId,
      title: "New conversation",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create conversation: ${
        error?.message ?? "Unknown database error."
      }`,
    );
  }

  return data.id as string;
}

async function saveMessage(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const { error } = await adminClient.from("chat_messages").insert({
    user_id: userId,
    conversation_id: conversationId,
    role,
    content,
    status: "completed",
  });

  if (error) {
    throw new Error(`Failed to save ${role} message: ${error.message}`);
  }
}

// Saved only after a successful answer, so failed requests leave no orphan
// user messages in the conversation.
export async function saveExchange(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantContent: string,
): Promise<void> {
  await saveMessage(adminClient, userId, conversationId, "user", userMessage);
  await saveMessage(
    adminClient,
    userId,
    conversationId,
    "assistant",
    assistantContent,
  );
}

export async function touchConversation(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await adminClient
    .from("chat_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    console.error(`Failed to update conversation: ${error.message}`);
  }
}
