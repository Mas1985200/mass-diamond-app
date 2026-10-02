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

export interface StreamMeta {
  readonly conversationId: string;
  readonly provider: string | null;
  readonly model: string | null;
}

export interface StreamChatMessageInput {
  readonly message: string;
  readonly conversationId: string | null;
  readonly signal?: AbortSignal;
  readonly onMeta?: (meta: StreamMeta) => void;
  readonly onDelta: (text: string) => void;
}

export interface StreamChatMessageResult {
  readonly conversationId: string;
  readonly content: string;
  readonly provider: string | null;
  readonly model: string | null;
}

interface ClientConfig {
  readonly url: string;
  readonly anonKey: string | null;
}

interface SseBlock {
  readonly event: string;
  readonly data: string;
}

interface StreamState {
  conversationId: string | null;
  provider: string | null;
  model: string | null;
  content: string;
  finalContent: string | null;
  finished: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === "string" && KNOWN_ERROR_CODES.includes(value);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return typeof zone === "string" && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readClientConfig(): ClientConfig | null {
  const internals = supabase as unknown as Record<string, unknown>;
  const env = import.meta.env as unknown as Record<string, unknown>;

  const url =
    pickString(internals.supabaseUrl) ?? pickString(env.VITE_SUPABASE_URL);

  if (url === null) {
    return null;
  }

  const anonKey =
    pickString(internals.supabaseKey) ??
    pickString(env.VITE_SUPABASE_ANON_KEY);

  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
  };
}

function errorFromPayload(
  payload: unknown,
  status: number,
  conversationId: string | null,
): ChatClientError {
  const errorInfo =
    isRecord(payload) && isRecord(payload.error) ? payload.error : null;

  const code: ChatErrorCode =
    errorInfo !== null && isChatErrorCode(errorInfo.code)
      ? errorInfo.code
      : status === 401
        ? "AUTH_REQUIRED"
        : "UNKNOWN_ERROR";

  const message =
    errorInfo !== null && typeof errorInfo.message === "string"
      ? errorInfo.message
      : `Request failed with status ${status}.`;

  const retryable =
    errorInfo !== null && typeof errorInfo.retryable === "boolean"
      ? errorInfo.retryable
      : status >= 500 || status === 429;

  const payloadConversationId =
    isRecord(payload) && typeof payload.conversationId === "string"
      ? payload.conversationId
      : conversationId;

  return new ChatClientError({
    code,
    message,
    retryable,
    conversationId: payloadConversationId,
  });
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

  const timeZone = getTimeZone();

  if (timeZone) {
    body.timeZone = timeZone;
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

function parseSseBlock(raw: string): SseBlock | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { event, data: dataLines.join("\n") };
}

async function readEventStream(
  response: Response,
  input: StreamChatMessageInput,
): Promise<StreamChatMessageResult> {
  const body = response.body;

  if (body === null) {
    throw new ChatClientError({
      code: "NETWORK_ERROR",
      message: "The response stream is empty.",
      retryable: true,
      conversationId: input.conversationId,
    });
  }

  const state: StreamState = {
    conversationId: input.conversationId,
    provider: null,
    model: null,
    content: "",
    finalContent: null,
    finished: false,
  };

  const handleBlock = (raw: string): void => {
    const block = parseSseBlock(raw);

    if (block === null) {
      return;
    }

    const payload = parseJson(block.data);

    if (block.event === "meta") {
      if (isRecord(payload) && typeof payload.conversationId === "string") {
        state.conversationId = payload.conversationId;
        state.provider =
          typeof payload.provider === "string" ? payload.provider : null;
        state.model = typeof payload.model === "string" ? payload.model : null;

        input.onMeta?.({
          conversationId: payload.conversationId,
          provider: state.provider,
          model: state.model,
        });
      }

      return;
    }

    if (block.event === "delta") {
      const text =
        isRecord(payload) && typeof payload.text === "string"
          ? payload.text
          : "";

      if (text) {
        state.content += text;
        input.onDelta(text);
      }

      return;
    }

    if (block.event === "done") {
      state.finished = true;

      if (isRecord(payload) && typeof payload.content === "string") {
        state.finalContent = payload.content;
      }

      return;
    }

    if (block.event === "error") {
      throw errorFromPayload(payload, 200, state.conversationId);
    }
  };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");

      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      handleBlock(buffer.replace(/\r\n/g, "\n"));
    }
  } catch (error) {
    if (error instanceof ChatClientError || isAbortError(error)) {
      throw error;
    }

    throw new ChatClientError({
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Network error.",
      retryable: true,
      conversationId: state.conversationId,
    });
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  if (!state.finished) {
    throw new ChatClientError({
      code: "NETWORK_ERROR",
      message: "The response stream ended unexpectedly.",
      retryable: true,
      conversationId: state.conversationId,
    });
  }

  const finalContent = (state.finalContent ?? state.content).trim();

  if (!finalContent || state.conversationId === null) {
    throw new ChatClientError({
      code: "UNKNOWN_ERROR",
      message: "The server returned an unexpected response.",
      retryable: true,
      conversationId: state.conversationId,
    });
  }

  return {
    conversationId: state.conversationId,
    content: finalContent,
    provider: state.provider,
    model: state.model,
  };
}

export async function streamChatMessage(
  input: StreamChatMessageInput,
): Promise<StreamChatMessageResult> {
  const config = readClientConfig();

  if (config === null) {
    throw new ChatClientError({
      code: "UNKNOWN_ERROR",
      message: "The Supabase configuration is missing.",
      retryable: false,
      conversationId: input.conversationId,
    });
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    throw new ChatClientError({
      code: "AUTH_REQUIRED",
      message: "There is no active session.",
      retryable: false,
      conversationId: input.conversationId,
    });
  }

  const body: Record<string, string | boolean> = {
    message: input.message,
    stream: true,
  };

  if (input.conversationId) {
    body.conversationId = input.conversationId;
  }

  const timeZone = getTimeZone();

  if (timeZone) {
    body.timeZone = timeZone;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };

  if (config.anonKey) {
    headers.apikey = config.anonKey;
  }

  let response: Response;

  try {
    response = await fetch(`${config.url}/functions/v1/ai-chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ChatClientError({
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Network error.",
      retryable: true,
      conversationId: input.conversationId,
    });
  }

  if (!response.ok) {
    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    throw errorFromPayload(payload, response.status, input.conversationId);
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream")) {
    return readEventStream(response, input);
  }

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (
    isRecord(payload) &&
    payload.success === true &&
    typeof payload.conversationId === "string" &&
    isRecord(payload.message) &&
    typeof payload.message.content === "string"
  ) {
    const content = payload.message.content;
    const conversationId = payload.conversationId;
    const provider =
      typeof payload.provider === "string" ? payload.provider : null;
    const model = typeof payload.model === "string" ? payload.model : null;

    input.onMeta?.({ conversationId, provider, model });
    input.onDelta(content);

    return { conversationId, content, provider, model };
  }

  throw errorFromPayload(payload, response.status, input.conversationId);
}
