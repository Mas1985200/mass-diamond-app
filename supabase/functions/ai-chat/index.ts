// supabase/functions/ai-chat/index.ts

import {
  createClient,
  type SupabaseClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_MESSAGE_LENGTH = 32_000;
const MAX_HISTORY_MESSAGES = 40;

type ChatRequestBody = {
  readonly conversationId?: string;
  readonly message?: string;
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

type AIProviderResult =
  | {
      readonly success: true;
      readonly provider: AIProviderId;
      readonly model: string;
      readonly content: string;
    }
  | {
      readonly success: false;
      readonly provider: AIProviderId;
      readonly error: string;
      readonly retryable: boolean;
    };

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: corsHeaders,
    },
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function getBearerToken(
  request: Request,
): string | null {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i,
    );

  return match?.[1] ?? null;
}

function parseRequestBody(
  value: unknown,
): ChatRequestBody {
  if (!isRecord(value)) {
    throw new Error(
      "Request body must be a JSON object.",
    );
  }

  const conversationId =
    typeof value.conversationId === "string"
      ? value.conversationId.trim()
      : undefined;

  const message =
    typeof value.message === "string"
      ? value.message.trim()
      : undefined;

  return {
    conversationId,
    message,
  };
}

function validateMessage(
  message: string | undefined,
): string {
  if (!message) {
    throw new Error(
      "Message is required.",
    );
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

function getRequiredEnv(
  name: string,
): string {
  const value =
    Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(
      `${name} is not configured.`,
    );
  }

  return value;
}

function getOptionalEnv(
  name: string,
): string | undefined {
  const value =
    Deno.env.get(name)?.trim();

  return value || undefined;
}

function getConfiguredProviders(): AIProviderId[] {
  const providers: AIProviderId[] = [];

  if (
    getOptionalEnv("GROQ_API_KEY") &&
    getOptionalEnv("GROQ_MODEL")
  ) {
    providers.push("groq");
  }

  if (
    (
      getOptionalEnv("GOOGLE_AI_API_KEY") ??
      getOptionalEnv("GEMINI_API_KEY")
    ) &&
    getOptionalEnv("GEMINI_MODEL")
  ) {
    providers.push("gemini");
  }

  return providers;
}

async function callGroq(
  messages: readonly AIMessage[],
  signal: AbortSignal,
): Promise<AIProviderResult> {
  const apiKey =
    getOptionalEnv("GROQ_API_KEY");

  const model =
    getOptionalEnv("GROQ_MODEL");

  if (!apiKey || !model) {
    return {
      success: false,
      provider: "groq",
      error:
        "Groq provider is not configured.",
      retryable: false,
    };
  }

  try {
    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
          }),
          signal,
        },
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      return {
        success: false,
        provider: "groq",
        error:
          errorText ||
          `Groq request failed with status ${response.status}.`,
        retryable:
          response.status === 429 ||
          response.status >= 500,
      };
    }

    const data: unknown =
      await response.json();

    if (!isRecord(data)) {
      return {
        success: false,
        provider: "groq",
        error:
          "Groq returned an invalid response.",
        retryable: false,
      };
    }

    const choices = data.choices;

    if (
      !Array.isArray(choices) ||
      choices.length === 0 ||
      !isRecord(choices[0])
    ) {
      return {
        success: false,
        provider: "groq",
        error:
          "Groq response did not contain a completion.",
        retryable: false,
      };
    }

    const firstChoice =
      choices[0];

    const message =
      firstChoice.message;

    if (!isRecord(message)) {
      return {
        success: false,
        provider: "groq",
        error:
          "Groq response did not contain a valid message.",
        retryable: false,
      };
    }

    const content =
      typeof message.content === "string"
        ? message.content.trim()
        : "";

    if (!content) {
      return {
        success: false,
        provider: "groq",
        error:
          "Groq returned an empty response.",
        retryable: false,
      };
    }

    return {
      success: true,
      provider: "groq",
      model,
      content,
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return {
        success: false,
        provider: "groq",
        error:
          "Groq request was aborted.",
        retryable: true,
      };
    }

    return {
      success: false,
      provider: "groq",
      error:
        error instanceof Error
          ? error.message
          : "Unknown Groq error.",
      retryable: true,
    };
  }
}

async function callGemini(
  messages: readonly AIMessage[],
  signal: AbortSignal,
): Promise<AIProviderResult> {
  const apiKey =
    getOptionalEnv("GOOGLE_AI_API_KEY") ??
    getOptionalEnv("GEMINI_API_KEY");

  const model =
    getOptionalEnv("GEMINI_MODEL");

  if (!apiKey || !model) {
    return {
      success: false,
      provider: "gemini",
      error:
        "Gemini provider is not configured.",
      retryable: false,
    };
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents =
    messages
      .filter(
        (
          message,
        ) =>
          message.role !== "system",
      )
      .map(
        (
          message,
        ) => ({
          role:
            message.role === "assistant"
              ? "model"
              : "user",
          parts: [
            {
              text: message.content,
            },
          ],
        }),
      );

  const systemMessages =
    messages.filter(
      (
        message,
      ) =>
        message.role === "system",
    );

  const systemText =
    systemMessages
      .map(
        (
          message,
        ) => message.content,
      )
      .join("\n\n")
      .trim();

  const body: Record<
    string,
    unknown
  > = {
    contents,
    generationConfig: {
      temperature: 0.7,
    },
  };

  if (systemText) {
    body.systemInstruction = {
      parts: [
        {
          text: systemText,
        },
      ],
    };
  }

  try {
    const response =
      await fetch(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify(body),
          signal,
        },
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      return {
        success: false,
        provider: "gemini",
        error:
          errorText ||
          `Gemini request failed with status ${response.status}.`,
        retryable:
          response.status === 429 ||
          response.status >= 500,
      };
    }

    const data: unknown =
      await response.json();

    if (!isRecord(data)) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini returned an invalid response.",
        retryable: false,
      };
    }

    const candidates =
      data.candidates;

    if (
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      !isRecord(candidates[0])
    ) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini response did not contain a candidate.",
        retryable: false,
      };
    }

    const candidate =
      candidates[0];

    const content =
      candidate.content;

    if (!isRecord(content)) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini response did not contain valid content.",
        retryable: false,
      };
    }

    const parts =
      content.parts;

    if (!Array.isArray(parts)) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini response did not contain valid parts.",
        retryable: false,
      };
    }

    const text =
      parts
        .filter(isRecord)
        .map(
          (
            part,
          ) =>
            typeof part.text === "string"
              ? part.text
              : "",
        )
        .join("")
        .trim();

    if (!text) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini returned an empty response.",
        retryable: false,
      };
    }

    return {
      success: true,
      provider: "gemini",
      model,
      content: text,
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return {
        success: false,
        provider: "gemini",
        error:
          "Gemini request was aborted.",
        retryable: true,
      };
    }

    return {
      success: false,
      provider: "gemini",
      error:
        error instanceof Error
          ? error.message
          : "Unknown Gemini error.",
      retryable: true,
    };
  }
}

async function executeAI(
  messages: readonly AIMessage[],
  signal: AbortSignal,
): Promise<AIProviderResult> {
  const providers =
    getConfiguredProviders();

  if (providers.length === 0) {
    return {
      success: false,
      provider: "groq",
      error:
        "No AI provider is configured. Configure GROQ_API_KEY + GROQ_MODEL or GEMINI_API_KEY + GEMINI_MODEL.",
      retryable: false,
    };
  }

  let lastFailure:
    | AIProviderResult
    | null = null;

  for (const provider of providers) {
    const result =
      provider === "groq"
        ? await callGroq(
            messages,
            signal,
          )
        : await callGemini(
            messages,
            signal,
          );

    if (result.success) {
      return result;
    }

    lastFailure = result;

    if (!result.retryable) {
      continue;
    }
  }

  return (
    lastFailure ?? {
      success: false,
      provider: providers[0],
      error:
        "All configured AI providers failed.",
      retryable: true,
    }
  );
}

async function loadConversation(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const {
    data,
    error,
  } =
    await adminClient
      .from("chat_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load conversation: ${error.message}`,
    );
  }

  return data !== null;
}

async function loadHistory(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<AIMessage[]> {
  const {
    data,
    error,
  } =
    await adminClient
      .from("chat_messages")
      .select(
        "id, conversation_id, role, content, created_at",
      )
      .eq(
        "conversation_id",
        conversationId,
      )
      .eq("user_id", userId)
      .order(
        "created_at",
        {
          ascending: true,
        },
      )
      .limit(MAX_HISTORY_MESSAGES);

  if (error) {
    throw new Error(
      `Failed to load chat history: ${error.message}`,
    );
  }

  const rows =
    (data ?? []) as ChatMessageRow[];

  return rows.map(
    (
      row,
    ) => ({
      role: row.role,
      content: row.content,
    }),
  );
}

async function createConversation(
  adminClient: SupabaseClient,
  userId: string,
): Promise<string> {
  const {
    data,
    error,
  } =
    await adminClient
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
        error?.message ??
        "Unknown database error."
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
  const {
    error,
  } =
    await adminClient
      .from("chat_messages")
      .insert({
        user_id: userId,
        conversation_id:
          conversationId,
        role: "user",
        content: message,
        status: "completed",
      });

  if (error) {
    throw new Error(
      `Failed to save user message: ${error.message}`,
    );
  }
}

async function saveAssistantMessage(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  content: string,
): Promise<void> {
  const {
    error,
  } =
    await adminClient
      .from("chat_messages")
      .insert({
        user_id: userId,
        conversation_id:
          conversationId,
        role: "assistant",
        content,
        status: "completed",
      });

  if (error) {
    throw new Error(
      `Failed to save assistant message: ${error.message}`,
    );
  }
}

async function touchConversation(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const {
    error,
  } =
    await adminClient
      .from("chat_conversations")
      .update({
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("user_id", userId);

  if (error) {
    throw new Error(
      `Failed to update conversation: ${error.message}`,
    );
  }
}

async function authenticateUser(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<User> {
  const token =
    getBearerToken(request);

  if (!token) {
    throw new Error(
      "Authentication is required.",
    );
  }

  const authClient =
    createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      },
    );

  const {
    data,
    error,
  } =
    await authClient.auth.getUser(
      token,
    );

  if (error || !data.user) {
    throw new Error(
      "Authentication is invalid or expired.",
    );
  }

  return data.user;
}

Deno.serve(
  async (
    request: Request,
  ): Promise<Response> => {
    const requestId =
      createRequestId();

    if (
      request.method === "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders,
        },
      );
    }

    if (
      request.method !== "POST"
    ) {
      return jsonResponse(
        {
          success: false,
          error: {
            code:
              "METHOD_NOT_ALLOWED",
            message:
              "Only POST requests are allowed.",
            retryable: false,
          },
          requestId,
        },
        405,
      );
    }

    try {
      const supabaseUrl =
        getRequiredEnv(
          "SUPABASE_URL",
        );

      const supabaseAnonKey =
        getRequiredEnv(
          "SUPABASE_ANON_KEY",
        );

      const serviceRoleKey =
        getRequiredEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
        );

      const user =
        await authenticateUser(
          request,
          supabaseUrl,
          supabaseAnonKey,
        );

      const adminClient =
        createClient(
          supabaseUrl,
          serviceRoleKey,
          {
            auth: {
              autoRefreshToken:
                false,
              persistSession:
                false,
            },
          },
        );

      const rawBody: unknown =
        await request.json();

      const body =
        parseRequestBody(
          rawBody,
        );

      const message =
        validateMessage(
          body.message,
        );

      let conversationId =
        body.conversationId;

      if (conversationId) {
        const exists =
          await loadConversation(
            adminClient,
            user.id,
            conversationId,
          );

        if (!exists) {
          return jsonResponse(
            {
              success: false,
              error: {
                code:
                  "CONVERSATION_NOT_FOUND",
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
        conversationId =
          await createConversation(
            adminClient,
            user.id,
          );
      }

      const history =
        await loadHistory(
          adminClient,
          user.id,
          conversationId,
        );

      await saveUserMessage(
        adminClient,
        user.id,
        conversationId,
        message,
      );

      const aiMessages: AIMessage[] = [
        {
          role: "system",
          content:
            "You are Mass Diamond, a helpful, accurate, concise and professional AI assistant.",
        },
        ...history,
        {
          role: "user",
          content: message,
        },
      ];

      const controller =
        new AbortController();

      const timeoutId =
        setTimeout(
          () => {
            controller.abort();
          },
          30_000,
        );

      let aiResult:
        AIProviderResult;

      try {
        aiResult =
          await executeAI(
            aiMessages,
            controller.signal,
          );
      } finally {
        clearTimeout(
          timeoutId,
        );
      }

      if (!aiResult.success) {
        return jsonResponse(
          {
            success: false,
            error: {
              code:
                "AI_PROVIDER_ERROR",
              message:
                aiResult.error,
              retryable:
                aiResult.retryable,
            },
            requestId,
            conversationId,
          },
          502,
        );
      }

      await saveAssistantMessage(
        adminClient,
        user.id,
        conversationId,
        aiResult.content,
      );

      await touchConversation(
        adminClient,
        user.id,
        conversationId,
      );

      return jsonResponse(
        {
          success: true,
          requestId,
          conversationId,
          message: {
            role: "assistant",
            content:
              aiResult.content,
          },
          provider:
            aiResult.provider,
          model:
            aiResult.model,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";

      const isAuthError =
        message ===
        "Authentication is required." ||
        message ===
        "Authentication is invalid or expired.";

      return jsonResponse(
        {
          success: false,
          error: {
            code: isAuthError
              ? "AUTH_REQUIRED"
              : "INTERNAL_ERROR",
            message,
            retryable:
              !isAuthError,
          },
          requestId,
        },
        isAuthError
          ? 401
          : 500,
      );
    }
  },
);
