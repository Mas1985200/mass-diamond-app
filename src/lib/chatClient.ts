import { supabase } from "./supabase";

export type ChatErrorCode =
  | "AUTH_REQUIRED"
  | "CONVERSATION_NOT_FOUND"
  | "AI_PROVIDER_ERROR"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

const KNOWN_ERROR_CODES: readonly string[] = [
  "AUTH_REQUIRED",
  "CONVERSATION_NOT_FOUND",
  "AI_PROVIDER_ERROR",
  "METHOD_NOT_ALLOWED",
  "INTERNAL_ERROR",
  "NETWORK_ERROR",
  "UNKNOWN_ERROR",
];

interface ChatClientErrorInit {
  readonly code: ChatErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly conversationId: string | null;
}

export class ChatClientError extends Error {
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly conversationId: string | null;

  constructor(init: ChatClientErrorInit) {
    super(init.message);
    this.name = "ChatClientError";
    this.code = init.code;
    this.retryable = init.retryable;
    this.conversationId = init.conversationId;
  }
}

export interface SendChatMessageInput {
  readonly message: string;
  readonly conversationId: string | null;
}

export interface SendChatMessageResult {
  readonly conversationId: string;
  readonly content: string;
  readonly provider: string | null;
  readonly model: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === "string" && KNOWN_ERROR_CODES.includes(value);
}

async function toChatClientError(error: unknown): Promise<ChatClientError> {
  const context = isRecord(error) ? error.context : undefined;

  if (context instanceof Response) {
    try {
      const payload: unknown = await context.json();

      if (isRecord(payload)) {
        const errorInfo = isRecord(payload.error) ? payload.error : null;

        const code: ChatErrorCode =
          errorInfo && isChatErrorCode(errorInfo.code)
            ? errorInfo.code
            : "UNKNOWN_ERROR";

        const message =
          errorInfo && typeof errorInfo.message === "string"
            ? errorInfo.message
            : "Request failed.";

        const retryable =
          errorInfo && typeof errorInfo.retryable === "boolean"
            ? errorInfo.retryable
            : true;

        const conversationId =
          typeof payload.conversationId === "string"
            ? payload.conversationId
            : null;

        return new ChatClientError({
          code,
          message,
          retryable,
          conversationId,
        });
      }
    } catch {
      // Fall through to the generic HTTP error below.
    }

    return new ChatClientError({
      code: "UNKNOWN_ERROR",
      message: `Request failed with status ${context.status}.`,
      retryable: context.status >= 500,
      conversationId: null,
    });
  }

  return new ChatClientError({
    code: "NETWORK_ERROR",
    message: error instanceof Error ? error.message : "Network error.",
    retryable: true,
    conversationId: null,
  });
}

export async function sendChatMessage(
  input: SendChatMessageInput,
): Promise<SendChatMessageResult> {
  const body: Record<string, string> = { message: input.message };

  if (input.conversationId) {
    body.conversationId = input.conversationId;
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "ai-chat",
    { body },
  );

  if (error) {
    throw await toChatClientError(error);
  }

  if (
    isRecord(data) &&
    data.success === true &&
    typeof data.conversationId === "string" &&
    isRecord(data.message) &&
    typeof data.message.content === "string"
  ) {
    return {
      conversationId: data.conversationId,
      content: data.message.content,
      provider: typeof data.provider === "string" ? data.provider : null,
      model: typeof data.model === "string" ? data.model : null,
    };
  }

  throw new ChatClientError({
    code: "UNKNOWN_ERROR",
    message: "The server returned an unexpected response.",
    retryable: true,
    conversationId: null,
  });
}
