// supabase/functions/ai-chat/providers/types.ts
// Types shared by the provider layer.

import type { ToolDefinition } from "../types.ts";

export type ToolOptions = {
  readonly tools: readonly ToolDefinition[];
  readonly toolChoice: "auto" | "none" | "required";
} | null;

export type ParsedToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
};

export type ModelTurn = {
  readonly text: string;
  readonly toolCalls: readonly ParsedToolCall[];
  readonly model: string;
};

export type RoundSuccess = {
  readonly ok: true;
  readonly body: ReadableStream<Uint8Array>;
};

export type RoundFailure = {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly retryAfterMs: number | null;
};

export type RoundResult = RoundSuccess | RoundFailure;
