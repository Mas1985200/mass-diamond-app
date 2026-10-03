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
const TOOL_TIMEOUT_MS = 9_000;
const TOTAL_TIMEOUT_MS = 120_000;
const MAX_TOOL_ROUNDS = 3;
const MAX_CARDS = 4;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const NOMINATIM_USER_AGENT =
  "MassDiamond/1.0 (https://mass-diamond.netlify.app)";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLOCK_MARKER_PATTERN =
  /:::md-clock~[^~\s]+~[A-Za-z0-9_\/+-]+~(?:fa|en):::/g;
const CARD_MARKER_PATTERN = /:::md-card~[A-Za-z0-9_-]+:::/g;
const LOCATION_TAG_PATTERN =
  /\s*:::md-loc~(-?\d{1,3}(?:\.\d+)?)~(-?\d{1,3}(?:\.\d+)?):::\s*$/;

type Lang = "fa" | "en";

type GeoPoint = {
  readonly lat: number;
  readonly lon: number;
};

type ChatRequestBody = {
  readonly conversationId?: string;
  readonly message?: string;
  readonly stream: boolean;
  readonly timeZone?: string;
  readonly location: GeoPoint | null;
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

type ToolContext = {
  readonly now: Date;
  readonly timeZone: string | null;
  readonly location: GeoPoint | null;
  readonly lang: Lang;
  readonly tavilyKey: string | undefined;
};

type PlaceItem = {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lon: number;
  readonly km?: number;
};

type SourceItem = {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
};

type CardPayload =
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
      readonly t: "sources";
      readonly lang: Lang;
      readonly items: readonly SourceItem[];
    };

type ToolOutcome = {
  readonly data: unknown;
  readonly card?: CardPayload;
};

type ToolDefinition = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
};

type OAIToolCall = {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
};

type OAIMessage =
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

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round5(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function isValidGeo(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function parseGeoPoint(value: unknown): GeoPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.lat !== "number" || typeof value.lon !== "number") {
    return null;
  }

  return isValidGeo(value.lat, value.lon)
    ? { lat: round4(value.lat), lon: round4(value.lon) }
    : null;
}

function extractLocationTag(message: string): {
  readonly text: string;
  readonly location: GeoPoint | null;
} {
  const match = LOCATION_TAG_PATTERN.exec(message);

  if (!match) {
    return { text: message, location: null };
  }

  const lat = Number(match[1]);
  const lon = Number(match[2]);

  return {
    text: message.slice(0, match.index).trim(),
    location: isValidGeo(lat, lon) ? { lat: round4(lat), lon: round4(lon) } : null,
  };
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
    location: parseGeoPoint(value.location),
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

function safeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  date: Date,
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return "";
  }
}

function persianDateText(now: Date, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(now);

    const pick = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? "";

    const weekday = pick("weekday");
    const core = [pick("day"), pick("month"), pick("year")]
      .filter(Boolean)
      .join(" ");

    if (!core) {
      return "";
    }

    return weekday ? `${weekday}، ${core}` : core;
  } catch {
    return "";
  }
}

function zoneOffsetMinutes(zone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );

  const truncated = Math.floor(date.getTime() / 1000) * 1000;

  return Math.round((asUtc - truncated) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const rest = String(abs % 60).padStart(2, "0");

  return `${sign}${hours}:${rest}`;
}

function dateKey(zone: string, date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function haversineKm(a: GeoPoint, lat: number, lon: number): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(lat - a.lat);
  const dLon = toRad(lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function encodeCard(card: CardPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(card));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const body = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `:::md-card~${body}:::`;
}

function stripMarkers(content: string): string {
  return content
    .replace(CLOCK_MARKER_PATTERN, "")
    .replace(CARD_MARKER_PATTERN, "")
    .trim();
}

const GET_DATETIME_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_datetime",
    description:
      "Get the exact current date, weekday and time, for the user's own time zone or for any other place. Always use this for questions about today's date, the weekday, the current time, or the time in another city or country.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "IANA time zone id of the place, for example Asia/Tokyo, Europe/London, America/New_York, Asia/Tehran. Omit it to use the user's own time zone.",
        },
        place_label: {
          type: "string",
          description:
            "Name of the place as 'City, Country' in the user's language (for example 'توکیو، ژاپن'). Only when timezone is given.",
        },
        show_clock: {
          type: "boolean",
          description:
            "true when the user asks for the time of day (here or elsewhere), which shows a clock card; false when they only ask about the date or the weekday.",
        },
      },
      required: ["show_clock"],
    },
  },
};

const FIND_PLACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "find_place",
    description:
      "Look up a place, business, landmark or address on the map and show a map card to the user. Use it when the user asks where something is, asks for an address or location, or wants places near them.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, as specific as possible, for example 'برج میلاد تهران' or 'داروخانه'.",
        },
        near_user: {
          type: "boolean",
          description:
            "true only when the user wants places near their own position. Requires that the user has shared their location.",
        },
      },
      required: ["query"],
    },
  },
};

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current or recent information such as news, prices, weather, sports results, or anything that may have changed after your training.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A short, specific search query.",
        },
      },
      required: ["query"],
    },
  },
};

function buildToolDefinitions(ctx: ToolContext): ToolDefinition[] {
  const tools: ToolDefinition[] = [GET_DATETIME_TOOL, FIND_PLACE_TOOL];

  if (ctx.tavilyKey) {
    tools.push(WEB_SEARCH_TOOL);
  }

  return tools;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function runGetDatetime(
  args: Record<string, unknown>,
  ctx: ToolContext,
): ToolOutcome {
  const userZone = ctx.timeZone ?? "UTC";
  const requested =
    typeof args.timezone === "string" ? args.timezone.trim() : "";
  const zone = requested ? resolveTimeZone(requested) : userZone;

  if (!zone) {
    return {
      data: {
        error: `Unknown IANA time zone "${requested}". Retry with a valid IANA id such as Asia/Tokyo.`,
      },
    };
  }

  const now = ctx.now;
  const label =
    typeof args.place_label === "string"
      ? args.place_label.trim().slice(0, 80)
      : "";
  const showClock = args.show_clock === true;

  const offset = zoneOffsetMinutes(zone, now);
  const diff = offset - zoneOffsetMinutes(userZone, now);
  const zoneKey = dateKey(zone, now);
  const userKey = dateKey(userZone, now);

  const dayRelation =
    zoneKey === userKey
      ? "same_day"
      : zoneKey > userKey
        ? "tomorrow"
        : "yesterday";

  const data = {
    time_24h: safeFormat(
      "en-GB",
      { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      now,
    ),
    date_gregorian: safeFormat(
      "en-US",
      {
        timeZone: zone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      },
      now,
    ),
    date_persian: persianDateText(now, zone),
    time_zone: zone,
    utc_offset: formatOffset(offset),
    is_user_time_zone: zone === userZone,
    hours_ahead_of_user: diff / 60,
    day_relative_to_user: dayRelation,
    user_time_zone_known: ctx.timeZone !== null,
  };

  if (!showClock) {
    return { data };
  }

  return {
    data,
    card: {
      t: "clock",
      iso: now.toISOString(),
      zone,
      ref: userZone,
      ...(label ? { label } : {}),
      lang: ctx.lang,
    },
  };
}

type NominatimAttempt = {
  readonly delta: number;
  readonly bounded: boolean;
} | null;

async function searchNominatim(
  query: string,
  ctx: ToolContext,
  attempt: NominatimAttempt,
  masterSignal: AbortSignal,
): Promise<PlaceItem[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    "accept-language": ctx.lang === "fa" ? "fa,en" : "en",
  });

  if (attempt && ctx.location) {
    const { lat, lon } = ctx.location;
    const d = attempt.delta;

    params.set(
      "viewbox",
      [lon - d, lat + d, lon + d, lat - d].map((n) => n.toFixed(5)).join(","),
    );

    if (attempt.bounded) {
      params.set("bounded", "1");
    }
  }

  const timed = createAttempt(masterSignal, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Map search failed with status ${response.status}.`);
    }

    const json: unknown = await response.json();

    if (!Array.isArray(json)) {
      return [];
    }

    const items: PlaceItem[] = [];

    for (const raw of json) {
      if (!isRecord(raw)) {
        continue;
      }

      const lat = Number(raw.lat);
      const lon = Number(raw.lon);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const displayName =
        typeof raw.display_name === "string" ? raw.display_name : "";
      const name =
        typeof raw.name === "string" && raw.name
          ? raw.name
          : displayName.split(",")[0]?.trim() || query;

      const km = ctx.location
        ? Math.round(haversineKm(ctx.location, lat, lon) * 10) / 10
        : undefined;

      items.push({
        name: name.slice(0, 80),
        address: displayName.slice(0, 160),
        lat: round5(lat),
        lon: round5(lon),
        ...(km !== undefined ? { km } : {}),
      });
    }

    return items;
  } finally {
    timed.clearConnectTimer();
  }
}

async function runFindPlace(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";

  if (!query) {
    return { data: { error: "query is required." } };
  }

  const nearUser = args.near_user === true;

  if (nearUser && !ctx.location) {
    return {
      data: {
        error: "user_location_not_shared",
        hint: "Tell the user to tap the location pin button at the top of the chat to share their position, then ask again.",
      },
    };
  }

  const attempts: NominatimAttempt[] =
    nearUser && ctx.location
      ? [
          { delta: 0.06, bounded: true },
          { delta: 0.3, bounded: true },
          { delta: 0.3, bounded: false },
        ]
      : [null];

  for (const attempt of attempts) {
    const items = await searchNominatim(query, ctx, attempt, signal);

    if (items.length > 0) {
      const top = items.slice(0, 3);

      return {
        data: {
          results: top.map((item) => ({
            name: item.name,
            address: item.address,
            lat: item.lat,
            lon: item.lon,
            distance_km: item.km,
          })),
        },
        card: { t: "places", lang: ctx.lang, items: top },
      };
    }
  }

  return { data: { results: [], note: "No places were found." } };
}

async function runWebSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const query =
    typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";

  if (!query) {
    return { data: { error: "query is required." } };
  }

  if (!ctx.tavilyKey) {
    return { data: { error: "Web search is not available." } };
  }

  const timed = createAttempt(signal, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.tavilyKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      return {
        data: { error: `Web search failed with status ${response.status}.` },
      };
    }

    const json: unknown = await response.json();
    const rawResults =
      isRecord(json) && Array.isArray(json.results) ? json.results : [];

    const results: Array<{
      readonly title: string;
      readonly url: string;
      readonly snippet: string;
    }> = [];
    const sources: SourceItem[] = [];

    for (const raw of rawResults) {
      if (!isRecord(raw)) {
        continue;
      }

      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const rawUrl = typeof raw.url === "string" ? raw.url : "";
      const content = typeof raw.content === "string" ? raw.content : "";

      let host = "";

      try {
        const parsed = new URL(rawUrl);

        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          continue;
        }

        host = parsed.hostname.replace(/^www\./, "");
      } catch {
        continue;
      }

      if (!title) {
        continue;
      }

      results.push({
        title: title.slice(0, 140),
        url: rawUrl,
        snippet: content.slice(0, 500),
      });
      sources.push({
        title: title.slice(0, 140),
        url: rawUrl,
        domain: host.slice(0, 80),
      });
    }

    if (results.length === 0) {
      return { data: { results: [], note: "No web results were found." } };
    }

    return {
      data: { results },
      card: { t: "sources", lang: ctx.lang, items: sources },
    };
  } finally {
    timed.clearConnectTimer();
  }
}

async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const args = parseToolArguments(rawArguments);

  try {
    switch (name) {
      case "get_datetime":
        return runGetDatetime(args, ctx);
      case "find_place":
        return await runFindPlace(args, ctx, signal);
      case "web_search":
        return await runWebSearch(args, ctx, signal);
      default:
        return { data: { error: `Unknown tool: ${name}` } };
    }
  } catch (error) {
    return { data: { error: describeError(error) } };
  }
}

function buildSystemPrompt(ctx: ToolContext): string {
  const now = ctx.now;
  const zone = ctx.timeZone ?? "UTC";

  const gregorian =
    safeFormat(
      "en-US",
      {
        timeZone: zone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      },
      now,
    ) || now.toISOString();

  const persian = persianDateText(now, zone);

  const time =
    safeFormat(
      "en-GB",
      { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      now,
    ) || now.toISOString();

  const lines: string[] = [
    "You are Mass Diamond, an intelligent, accurate and friendly AI assistant inside the Mass Diamond app.",
    "",
    "Reference data (authoritative and already converted; never recompute, convert or reformat it yourself):",
    `- Gregorian date: ${gregorian}`,
  ];

  if (persian) {
    lines.push(`- Persian (Solar Hijri) date: ${persian}`);
  }

  lines.push(`- Local time: ${time} (time zone: ${zone})`);

  if (!ctx.timeZone) {
    lines.push(
      "- The user's real time zone is unknown, so if the time is requested, say it is UTC and may differ locally.",
    );
  }

  if (ctx.location) {
    lines.push(
      `- The user chose to share their location: ${ctx.location.lat}, ${ctx.location.lon}. Use find_place with near_user=true for nearby places.`,
    );
  } else {
    lines.push(
      "- The user has NOT shared their location. If an answer needs it (nearby places), ask them to tap the location pin button at the top of the chat.",
    );
  }

  lines.push(
    "Rules for date and time: mention the date or time ONLY when the user explicitly asks, or when the task truly needs it (an age, a deadline, a countdown). Never mention them in greetings or small talk.",
    "",
    "Tools:",
    "- get_datetime: use it for ANY question about today's date, the weekday, the current time, or the time in another city or country. Never answer these from memory. Set show_clock=true only when the user asks for the time of day; use false for date or weekday questions. Use correct IANA time zone ids.",
    "- find_place: use it when the user asks where something is, wants an address or a location on the map, or wants places near them.",
    ctx.tavilyKey
      ? "- web_search: use it for current or recent facts (news, prices, weather, sports results, anything that may have changed). Mention site names only, never raw URLs."
      : "- You cannot browse the internet or check live information (news, prices, weather). If asked, say so briefly and offer what you can do instead.",
    "- Never mention tools, function names, JSON or internal data to the user. After a tool returns, answer briefly in the user's language and copy values exactly as given. The app already shows a card for clocks, maps and sources, so do not repeat full addresses, coordinates or links at length.",
    "",
    "Language: always reply in the language of the user's latest message, and keep that language consistent through the whole reply.",
    "",
    "Personality and tone:",
    "- You are warm, friendly and lively, like a smart friend who is genuinely happy to help. You are not a stiff, form-filling bot.",
    "- In Persian, write natural, conversational but polite Persian that matches the user's own register. Avoid stiff bureaucratic phrasing such as 'لطفاً اطلاعات زیر را در اختیار بگذارید'.",
    "- Use emojis naturally: usually 1 to 3 per reply, where they add warmth (a greeting, the start of a section, a closing line). Never put emojis inside code blocks. Skip them for serious topics such as illness, grief, legal or financial risk, errors and complaints.",
    "- When greeted, greet back briefly and warmly, then invite the user to continue. Do not add facts nobody asked for.",
    "- Be proactive. When asked to create something (an ad, a text, a plan, name ideas), write a concrete, good first draft IMMEDIATELY using sensible assumptions and clear placeholders. Only after the draft, ask at most 2 short questions to refine it, in one or two lines. Never respond with a list of questions before delivering something useful, and never ask more than 2 questions.",
    "- Start with the answer or the draft itself, with no filler opening.",
    "- When it genuinely helps, end with one short, natural follow-up offer or question. Not in every reply.",
    "",
    "Templates and examples: when you write ads, texts or samples, never invent facts such as ratings, prices, discount codes, phone numbers, addresses or statistics. Put every unknown specific in [square brackets] as a placeholder.",
    "",
    "Formatting:",
    "- Be clear and concise. You may use Markdown: short paragraphs, lists only when they really help, bold sparingly, code blocks for code.",
    "- Write stories, essays and explanations as flowing paragraphs. Never put every sentence on its own line.",
    "",
    "Honesty:",
    "- Do not invent facts. If you are not sure, say so.",
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

function createAttempt(
  master: AbortSignal,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): {
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

  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

type GroqToolOptions = {
  readonly tools: readonly ToolDefinition[];
  readonly toolChoice: "auto" | "none";
} | null;

type GroqRound =
  | { readonly ok: true; readonly body: ReadableStream<Uint8Array> }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
      readonly retryable: boolean;
    };

type ParsedToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
};

type GroqTurn = {
  readonly text: string;
  readonly toolCalls: readonly ParsedToolCall[];
};

async function requestGroqRound(
  apiKey: string,
  model: string,
  messages: readonly OAIMessage[],
  toolOptions: GroqToolOptions,
  masterSignal: AbortSignal,
): Promise<GroqRound> {
  const attempt = createAttempt(masterSignal);

  try {
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.7,
      stream: true,
    };

    if (toolOptions) {
      payload.tools = toolOptions.tools;
      payload.tool_choice = toolOptions.toolChoice;
    }

    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: attempt.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();

      return {
        ok: false,
        status: response.status,
        error:
          errorText || `Groq request failed with status ${response.status}.`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    if (!response.body) {
      return {
        ok: false,
        status: 502,
        error: "Groq returned an empty stream.",
        retryable: true,
      };
    }

    return { ok: true, body: response.body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown Groq error.",
      retryable: true,
    };
  } finally {
    attempt.clearConnectTimer();
  }
}

function extractGroqDelta(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice: unknown = choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    return null;
  }

  return firstChoice.delta;
}

async function* readGroqTurn(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, GroqTurn, void> {
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();

  for await (const data of readSseData(body)) {
    if (data === "[DONE]") {
      break;
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

    const delta = extractGroqDelta(parsed);

    if (!delta) {
      continue;
    }

    const content = delta.content;

    if (typeof content === "string" && content) {
      text += content;
      yield content;
    }

    const toolDeltas = delta.tool_calls;

    if (Array.isArray(toolDeltas)) {
      for (const item of toolDeltas) {
        if (!isRecord(item)) {
          continue;
        }

        const index = typeof item.index === "number" ? item.index : 0;
        const fn = isRecord(item.function) ? item.function : {};
        const current = calls.get(index) ?? { id: "", name: "", args: "" };

        if (typeof item.id === "string" && item.id) {
          current.id = item.id;
        }

        if (typeof fn.name === "string" && fn.name && !current.name) {
          current.name = fn.name;
        }

        if (typeof fn.arguments === "string") {
          current.args += fn.arguments;
        }

        calls.set(index, current);
      }
    }
  }

  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.args,
    }))
    .filter((call) => call.name);

  return { text, toolCalls };
}

function toOAIMessage(message: AIMessage): OAIMessage {
  return message.role === "assistant"
    ? { role: "assistant", content: message.content }
    : { role: message.role, content: message.content };
}

type AgentParams = {
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly AIMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly withTools: boolean;
  readonly firstBody: ReadableStream<Uint8Array>;
  readonly ctx: ToolContext;
  readonly signal: AbortSignal;
};

async function* groqAgentChunks(
  params: AgentParams,
): AsyncGenerator<string, void, void> {
  const convo: OAIMessage[] = params.messages.map(toOAIMessage);
  const cards: string[] = [];
  let body = params.firstBody;

  for (let round = 0; ; round += 1) {
    const turn = yield* readGroqTurn(body);

    if (
      !params.withTools ||
      turn.toolCalls.length === 0 ||
      round >= MAX_TOOL_ROUNDS
    ) {
      break;
    }

    if (turn.text.trim()) {
      yield "\n\n";
    }

    convo.push({
      role: "assistant",
      content: turn.text ? turn.text : null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments || "{}" },
      })),
    });

    for (const call of turn.toolCalls) {
      const outcome = await executeTool(
        call.name,
        call.arguments,
        params.ctx,
        params.signal,
      );

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.data).slice(0, 12_000),
      });

      if (outcome.card) {
        const marker = encodeCard(outcome.card);

        if (!cards.includes(marker) && cards.length < MAX_CARDS) {
          cards.push(marker);
        }
      }
    }

    const next = await requestGroqRound(
      params.apiKey,
      params.model,
      convo,
      {
        tools: params.tools,
        toolChoice: round + 1 >= MAX_TOOL_ROUNDS ? "none" : "auto",
      },
      params.signal,
    );

    if (!next.ok) {
      throw new Error(next.error);
    }

    body = next.body;
  }

  for (const marker of cards) {
    yield `\n\n${marker}`;
  }
}

async function openGroqAgent(
  messages: readonly AIMessage[],
  ctx: ToolContext,
  masterSignal: AbortSignal,
): Promise<StreamOpenResult> {
  const apiKey = getOptionalEnv("GROQ_API_KEY");
  const model = getOptionalEnv("GROQ_MODEL");

  if (!apiKey || !model) {
    return failure("groq", "Groq provider is not configured.", false);
  }

  const tools = buildToolDefinitions(ctx);
  const oaiMessages = messages.map(toOAIMessage);

  let withTools = true;
  let round = await requestGroqRound(
    apiKey,
    model,
    oaiMessages,
    { tools, toolChoice: "auto" },
    masterSignal,
  );

  if (!round.ok && round.status === 400) {
    withTools = false;
    round = await requestGroqRound(
      apiKey,
      model,
      oaiMessages,
      null,
      masterSignal,
    );
  }

  if (!round.ok) {
    return failure("groq", round.error, round.retryable);
  }

  return {
    success: true,
    provider: "groq",
    model,
    chunks: groqAgentChunks({
      apiKey,
      model,
      messages,
      tools,
      withTools,
      firstBody: round.body,
      ctx,
      signal: masterSignal,
    }),
  };
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
  ctx: ToolContext,
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
        ? await openGroqAgent(messages, ctx, masterSignal)
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
    content: stripMarkers(row.content),
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
    const extracted = extractLocationTag(body.message ?? "");
    const message = validateMessage(extracted.text);
    const location = body.location ?? extracted.location;

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

    const ctx: ToolContext = {
      now: new Date(),
      timeZone: resolveTimeZone(body.timeZone),
      location,
      lang: /[\u0600-\u06FF]/.test(message) ? "fa" : "en",
      tavilyKey: getOptionalEnv("TAVILY_API_KEY"),
    };

    const aiMessages: AIMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(ctx),
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
      opened = await openStream(aiMessages, ctx, master.signal);
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
