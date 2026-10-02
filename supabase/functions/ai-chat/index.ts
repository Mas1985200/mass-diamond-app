// supabase/functions/ai-chat/index.ts

import {
  createClient,
  type SupabaseClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2";

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders: Record<string, string> = {
  ...baseHeaders,
  "Content-Type": "application/json",
};

const sseHeaders: Record<string, string> = {
  ...baseHeaders,
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const MAX_MESSAGE_LENGTH = 32_000;
const MAX_HISTORY_MESSAGES = 40;
const CONNECT_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 120_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChatRequestBody = {
  readonly conversationId?: string;
  readonly message?: string;
  readonly stream: boolean;
  readonly timeZone?: string;
};

type ChatMessageRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly created_at: string;
};

type AIMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
};

type AIProviderId = "groq" | "gemini";

type StreamOpenSuccess = {
  readonly success: true;
  readonly provider: AIProviderId;
  readonly model: string;
  readonly chunks: AsyncGenerator<string, void, void>;
};

type StreamOpenFailure = {
  readonly success: false;
  readonly provider: AIProviderId;
  readonly error: string;
  readonly retryable: boolean;
};

type StreamOpenResult = StreamOpenSuccess | StreamOpenFailure;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? null;
}

function parseRequestBody(value: unknown): ChatRequestBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  const conversationId =
    typeof value.conversationId === "string"
      ? value.conversationId.trim() || undefined
      : undefined;

  const message =
    typeof value.message === "string" ? value.message.trim() : undefined;

  const timeZone =
    typeof value.timeZone === "string"
      ? value.timeZone.trim().slice(0, 64) || undefined
      : undefined;

  return {
    conversationId,
    message,
    stream: value.stream === true,
    timeZone,
  };
}

function validateMessage(message: string | undefined): string {
  if (!message) {
    throw new Error("Message is required.");
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(
      `Message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }

  return message;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();

  return value || undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function resolveTimeZone(candidate: string | undefined): string | null {
  if (!candidate) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

function buildSystemPrompt(now: Date, timeZone: string | null): string {
  const zone = timeZone ?? "UTC";

  let gregorian = now.toISOString();
  let persian = "";

  try {
    gregorian = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
  } catch {
    // Keep the ISO fallback.
  }

  try {
    persian = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
      timeZone: zone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
  } catch {
    persian = "";
  }

  const lines: string[] = [
    "You are Mass Diamond, an intelligent, accurate and friendly AI assistant inside the Mass Diamond app.",
    "",
    `Current date and time: ${gregorian} (time zone: ${zone}).`,
  ];

  if (persian) {
    lines.push(`Persian (Solar Hijri) date: ${persian}.`);
  }

  if (!timeZone) {
    lines.push(
      "The user's local time zone is unknown, so when asked for the time, say it is in UTC and that the local time may differ.",
    );
  }

  lines.push(
    "Use this information whenever the user asks about today's date, the day of the week or the time. Never guess a different date.",
    "",
    "Language: always reply in the language of the user's latest message, and keep that language consistent through the whole reply.",
    "",
    "Style:",
    "- Be clear, warm and concise. Start with the answer, with no filler opening.",
    "- You may use Markdown: short paragraphs, lists only when they really help, bold sparingly, code blocks for code.",
    "- Write stories, essays and explanations as flowing paragraphs. Never put every sentence on its own line.",
    "- Do not invent facts. If you are not sure, say so.",
    "- You cannot browse the internet or check live information (news, prices, weather) yet. If asked, say so briefly and offer what you can do instead.",
  );

  return lines.join("\n");
}

function getConfiguredProviders(): AIProviderId[] {
  const providers: AIProviderId[] = [];

  if (getOptionalEnv("GROQ_API_KEY") && getOptionalEnv("GROQ_MODEL")) {
    providers.push("groq");
  }

  if (
    (getOptionalEnv("GOOGLE_AI_API_KEY") ?? getOptionalEnv("GEMINI_API_KEY")) &&
    getOptionalEnv("GEMINI_MODEL")
  ) {
    providers.push("gemini");
  }

  return providers;
}

function failure(
  provider: AIProviderId,
  error: string,
  retryable: boolean,
): StreamOpenFailure {
  return { success: false, provider, error, retryable };
}

function failureFromError(
  provider: AIProviderId,
  label: string,
  error: unknown,
): StreamOpenFailure {
  if (error instanceof DOMException && error.name === "AbortError") {
    return failure(provider, `${label} request was aborted.`, true);
  }

  return failure(
    provider,
    error instanceof Error ? error.message : `Unknown ${label} error.`,
    true,
  );
}

function createAttempt(master: AbortSignal): {
  readonly signal: AbortSignal;
  readonly clearConnectTimer: () => void;
} {
  const controller = new AbortController();

  if (master.aborted) {
    controller.abort();
  } else {
    master.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  return {
    signal: controller.signal,
    clearConnectTimer: () => clearTimeout(timer),
  };
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
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

      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    const rest = buffer.trim();

    if (rest.startsWith("data:")) {
      yield rest.slice(5).trim();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function extractGroqDelta(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const choices = payload.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const firstChoice: unknown = choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    return "";
  }

  const content = firstChoice.delta.content;

  return typeof content === "string" ? content : "";
}

async function* groqChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  for await (const data of readSseData(body)) {
    if (data === "[DONE]") {
      return;
    }

    if (!data) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    const text = extractGroqDelta(parsed);

    if (text) {
      yield text;
    }
  }
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  const candidates = payload.candidates;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const candidate: unknown = candidates[0];

  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    return "";
  }

  const parts = candidate.content.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

async function* geminiChunks(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  for await (const data of readSseData(body)) {
    if (!data) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    const text = extractGeminiText(parsed);

    if (text) {
      yield text;
    }
  }
}

async function openGroq(
  messages: readonly AIMessage[],
  masterSignal: AbortSignal,
): Promise<StreamOpenResult> {
  const apiKey = getOptionalEnv("GROQ_API_KEY");
  const model = getOptionalEnv("GROQ_MODEL");

  if (!apiKey || !model) {
    return failure("groq", "Groq provider is not configured.", false);
  }

  const attempt = createAttempt(masterSignal);

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          stream: true,
        }),
        signal: attempt.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      return failure(
        "groq",
        errorText || `Groq request failed with status ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    }

    if (!response.body) {
      return failure("groq", "Groq returned an empty stream.", true);
    }

    return {
      success: true,
      provider: "groq",
      model,
      chunks: groqChunks(response.body),
    };
  } catch (error) {
    return failureFromError("groq", "Groq", error);
  } finally {
    attempt.clearConnectTimer();
  }
}

async function openGemini(
  messages: readonly AIMessage[],
  masterSignal: AbortSignal,
): Promise<StreamOpenResult> {
  const apiKey =
    getOptionalEnv("GOOGLE_AI_API_KEY") ?? getOptionalEnv("GEMINI_API_KEY");
  const model = getOptionalEnv("GEMINI_MODEL");

  if (!apiKey || !model) {
    return failure("gemini", "Gemini provider is not configured.", false);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature: 0.7 },
  };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const attempt = createAttempt(masterSignal);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: attempt.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();

      return failure(
        "gemini",
        errorText || `Gemini request failed with status ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    }

    if (!response.body) {
      return failure("gemini", "Gemini returned an empty stream.", true);
    }

    return {
      success: true,
      provider: "gemini",
      model,
      chunks: geminiChunks(response.body),
    };
  } catch (error) {
    return failureFromError("gemini", "Gemini", error);
  } finally {
    attempt.clearConnectTimer();
  }
}

async function openStream(
  messages: readonly AIMessage[],
  masterSignal: AbortSignal,
): Promise<StreamOpenResult> {
  const providers = getConfiguredProviders();

  if (providers.length === 0) {
    return failure(
      "groq",
      "No AI provider is configured. Configure GROQ_API_KEY + GROQ_MODEL or GEMINI_API_KEY + GEMINI_MODEL.",
      false,
    );
  }

  let lastFailure: StreamOpenFailure | null = null;

  for (const provider of providers) {
    const result =
      provider === "groq"
        ? await openGroq(messages, masterSignal)
        : await openGemini(messages, masterSignal);

    if (result.success) {
      return result;
    }

    lastFailure = result;
  }

  return (
    lastFailure ??
    failure(providers[0], "All configured AI providers failed.", true)
  );
}

async function collectChunks(
  chunks: AsyncGenerator<string, void, void>,
): Promise<string> {
  let content = "";

  for await (const chunk of chunks) {
    content += chunk;
  }

  return content;
}

async function loadConversation(
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

async function loadHistory(
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

  return rows.map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

async function createConversation(
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

async function saveUserMessage(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  message: string,
): Promise<void> {
  const { error } = await adminClient.from("chat_messages").insert({
    user_id: userId,
    conversation_id: conversationId,
    role: "user",
    content: message,
    status: "completed",
  });

  if (error) {
    throw new Error(`Failed to save user message: ${error.message}`);
  }
}

async function saveAssistantMessage(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  content: string,
): Promise<void> {
  const { error } = await adminClient.from("chat_messages").insert({
    user_id: userId,
    conversation_id: conversationId,
    role: "assistant",
    content,
    status: "completed",
  });

  if (error) {
    throw new Error(`Failed to save assistant message: ${error.message}`);
  }
}

async function touchConversation(
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

async function authenticateUser(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<User> {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error("Authentication is required.");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Authentication is invalid or expired.");
  }

  return data.user;
}

type SseResponseInput = {
  readonly chunks: AsyncGenerator<string, void, void>;
  readonly provider: AIProviderId;
  readonly model: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly adminClient: SupabaseClient;
  readonly master: AbortController;
  readonly totalTimer: number;
};

function createSseResponse(input: SseResponseInput): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The client disconnected; nothing more to send.
        }
      };

      send("meta", {
        requestId: input.requestId,
        conversationId: input.conversationId,
        provider: input.provider,
        model: input.model,
      });

      let content = "";

      try {
        for await (const chunk of input.chunks) {
          content += chunk;
          send("delta", { text: chunk });
        }

        const finalContent = content.trim();

        if (!finalContent) {
          send("error", {
            error: {
              code: "AI_PROVIDER_ERROR",
              message: "The AI provider returned an empty response.",
              retryable: true,
            },
            requestId: input.requestId,
            conversationId: input.conversationId,
          });

          return;
        }

        await saveAssistantMessage(
          input.adminClient,
          input.userId,
          input.conversationId,
          finalContent,
        );

        await touchConversation(
          input.adminClient,
          input.userId,
          input.conversationId,
        );

        send("done", {
          requestId: input.requestId,
          conversationId: input.conversationId,
          provider: input.provider,
          model: input.model,
          content: finalContent,
        });
      } catch (error) {
        send("error", {
          error: {
            code: "AI_PROVIDER_ERROR",
            message: describeError(error),
            retryable: true,
          },
          requestId: input.requestId,
          conversationId: input.conversationId,
        });
      } finally {
        clearTimeout(input.totalTimer);

        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      clearTimeout(input.totalTimer);
      input.master.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders,
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = createRequestId();

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: baseHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only POST requests are allowed.",
          retryable: false,
        },
        requestId,
      },
      405,
    );
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const user = await authenticateUser(request, supabaseUrl, supabaseAnonKey);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const rawBody: unknown = await request.json();
    const body = parseRequestBody(rawBody);
    const message = validateMessage(body.message);

    let conversationId = body.conversationId;

    if (conversationId) {
      const exists =
        UUID_PATTERN.test(conversationId) &&
        (await loadConversation(adminClient, user.id, conversationId));

      if (!exists) {
        return jsonResponse(
          {
            success: false,
            error: {
              code: "CONVERSATION_NOT_FOUND",
              message:
                "The requested conversation does not exist or does not belong to the current user.",
              retryable: false,
            },
            requestId,
          },
          404,
        );
      }
    } else {
      conversationId = await createConversation(adminClient, user.id);
    }

    const history = await loadHistory(adminClient, user.id, conversationId);

    await saveUserMessage(adminClient, user.id, conversationId, message);

    const timeZone = resolveTimeZone(body.timeZone);

    const aiMessages: AIMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(new Date(), timeZone),
      },
      ...history,
      {
        role: "user",
        content: message,
      },
    ];

    const master = new AbortController();
    const totalTimer = setTimeout(() => master.abort(), TOTAL_TIMEOUT_MS);

    let opened: StreamOpenResult;

    try {
      opened = await openStream(aiMessages, master.signal);
    } catch (error) {
      clearTimeout(totalTimer);
      throw error;
    }

    if (!opened.success) {
      clearTimeout(totalTimer);

      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: opened.error,
            retryable: opened.retryable,
          },
          requestId,
          conversationId,
        },
        502,
      );
    }

    if (body.stream) {
      return createSseResponse({
        chunks: opened.chunks,
        provider: opened.provider,
        model: opened.model,
        requestId,
        conversationId,
        userId: user.id,
        adminClient,
        master,
        totalTimer,
      });
    }

    let content: string;

    try {
      content = (await collectChunks(opened.chunks)).trim();
    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: describeError(error),
            retryable: true,
          },
          requestId,
          conversationId,
        },
        502,
      );
    } finally {
      clearTimeout(totalTimer);
    }

    if (!content) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: "The AI provider returned an empty response.",
            retryable: true,
          },
          requestId,
          conversationId,
        },
        502,
      );
    }

    await saveAssistantMessage(adminClient, user.id, conversationId, content);

    await touchConversation(adminClient, user.id, conversationId);

    return jsonResponse({
      success: true,
      requestId,
      conversationId,
      message: {
        role: "assistant",
        content,
      },
      provider: opened.provider,
      model: opened.model,
    });
  } catch (error) {
    const message = describeError(error);

    const isAuthError =
      message === "Authentication is required." ||
      message === "Authentication is invalid or expired.";

    return jsonResponse(
      {
        success: false,
        error: {
          code: isAuthError ? "AUTH_REQUIRED" : "INTERNAL_ERROR",
          message,
          retryable: !isAuthError,
        },
        requestId,
      },
      isAuthError ? 401 : 500,
    );
  }
});
