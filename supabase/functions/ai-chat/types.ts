// supabase/functions/ai-chat/types.ts
// Shared types used across the ai-chat function.

export type Lang = "fa" | "en";

export type GeoPoint = {
  readonly lat: number;
  readonly lon: number;
};

export type ChatRequestBody = {
  readonly conversationId?: string;
  readonly message?: string;
  readonly stream: boolean;
  readonly timeZone?: string;
  readonly location: GeoPoint | null;
};

export type ChatMessageRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly created_at: string;
};

export type AIMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
};

export type ToolContext = {
  readonly now: Date;
  readonly timeZone: string | null;
  readonly location: GeoPoint | null;
  readonly lang: Lang;
  readonly tavilyKey: string | undefined;
};

export type PlaceItem = {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lon: number;
  readonly km?: number;
  readonly zoom?: number;
};

export type PlaceCandidate = {
  readonly item: PlaceItem;
  readonly category: string;
  readonly facts: Readonly<Record<string, string>>;
  readonly wikipedia: string;
  readonly importance: number;
};

export type PhotoItem = {
  readonly src: string;
  readonly title: string;
};

export type WebResult = {
  readonly title: string;
  readonly source: string;
  readonly snippet: string;
};

export type CardPayload =
  | {
      readonly t: "clock";
      readonly iso: string;
      readonly zone: string;
      readonly ref: string;
      readonly label?: string;
      readonly lang: Lang;
    }
  | {
      readonly t: "places";
      readonly lang: Lang;
      readonly items: readonly PlaceItem[];
    }
  | {
      readonly t: "photos";
      readonly lang: Lang;
      readonly items: readonly PhotoItem[];
    };

export type ToolOutcome = {
  readonly data: unknown;
  readonly cards?: readonly CardPayload[];
  readonly cardFirst?: boolean;
  readonly finalText?: string;
};

export type ToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

export type OAIToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

export type OAIMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: readonly OAIToolCall[];
    }
  | {
      readonly role: "tool";
      readonly tool_call_id: string;
      readonly content: string;
    };
