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
const HISTORY_CHAR_BUDGET = 9_000;
const HISTORY_MESSAGE_CAP = 1_500;
const CONNECT_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 9_000;
const WIKI_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 900;
const WEB_CACHE_TTL_MS = 300_000;
const WEB_CACHE_MAX_ENTRIES = 40;
const MAX_TOOL_ROUNDS = 3;
const MAX_CARDS = 4;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TEMPERATURE = 0.4;
const NOMINATIM_USER_AGENT =
  "MassDiamond/1.0 (https://mass-diamond.netlify.app)";

const FACT_KEYS: readonly string[] = [
  "website",
  "phone",
  "opening_hours",
  "population",
  "description",
  "height",
  "start_date",
  "operator",
];

const PHOTO_SKIP_PATTERN =
  /(flag|logo|icon|locator|map|coat[_ ]of[_ ]arms|symbol|seal|emblem|edit-clear|question[_ ]book|wiktionary|disambig)/i;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLOCK_MARKER_PATTERN =
  /:::md-clock~[^~\s]+~[A-Za-z0-9_\/+-]+~(?:fa|en):::/g;
const CARD_MARKER_PATTERN = /:::md-card~([A-Za-z0-9_-]+):::/g;
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
  readonly zoom?: number;
};

type PlaceCandidate = {
  readonly item: PlaceItem;
  readonly category: string;
  readonly facts: Readonly<Record<string, string>>;
  readonly wikipedia: string;
  readonly importance: number;
};

type PhotoItem = {
  readonly src: string;
  readonly title: string;
};

type WebResult = {
  readonly title: string;
  readonly source: string;
  readonly snippet: string;
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
      readonly t: "photos";
      readonly lang: Lang;
      readonly items: readonly PhotoItem[];
    };

type ToolOutcome = {
  readonly data: unknown;
  readonly cards?: readonly CardPayload[];
  readonly cardFirst?: boolean;
  readonly finalText?: string;
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

function pickString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === "string" ? value : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    location: isValidGeo(lat, lon)
      ? { lat: round4(lat), lon: round4(lon) }
      : null,
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

function getTavilyKey(): string | undefined {
  return (
    getOptionalEnv("TAVILY_API_KEY") ??
    getOptionalEnv("TAVILY_KEY") ??
    getOptionalEnv("TAVILY_API")
  );
}

function groqModelCandidates(): string[] {
  const unique: string[] = [];

  for (const candidate of [
    getOptionalEnv("GROQ_MODEL_PREFERRED"),
    getOptionalEnv("GROQ_MODEL"),
  ]) {
    if (candidate && !unique.includes(candidate)) {
      unique.push(candidate);
    }
  }

  return unique;
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

function cityFromZone(zone: string): string {
  const last = zone.split("/").pop() ?? zone;

  return last.replace(/_/g, " ");
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

function distanceBetween(a: PlaceItem, b: PlaceItem): number {
  return haversineKm({ lat: a.lat, lon: a.lon }, b.lat, b.lon);
}

function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\s\-_.,'"«»()]/g, "");
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

function decodeCardBody(body: string): unknown {
  try {
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function describeCardForHistory(body: string): string {
  const decoded = decodeCardBody(body);

  if (!isRecord(decoded)) {
    return "";
  }

  if (decoded.t === "places" && Array.isArray(decoded.items)) {
    const entries = decoded.items
      .filter(isRecord)
      .slice(0, 3)
      .map((item) => {
        const name = typeof item.name === "string" ? item.name : "";
        const address = typeof item.address === "string" ? item.address : "";
        const km =
          typeof item.km === "number" ? `, ${item.km} km from the user` : "";

        return `${name}${address ? ` (${address})` : ""}${km}`;
      })
      .filter(Boolean);

    return entries.length > 0 ? `[map card shown: ${entries.join("; ")}]` : "";
  }

  if (decoded.t === "clock") {
    const zone = typeof decoded.zone === "string" ? decoded.zone : "";

    return zone ? `[clock card shown for ${zone}]` : "";
  }

  if (decoded.t === "photos") {
    return "[photo strip shown]";
  }

  return "";
}

function stripMarkers(content: string): string {
  return content
    .replace(CLOCK_MARKER_PATTERN, "")
    .replace(CARD_MARKER_PATTERN, (_match: string, body: string) =>
      describeCardForHistory(body),
    )
    .trim();
}

function trimHistory(history: readonly AIMessage[]): AIMessage[] {
  const kept: AIMessage[] = [];
  let used = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];

    if (!item) {
      continue;
    }

    const content =
      item.content.length > HISTORY_MESSAGE_CAP
        ? `${item.content.slice(0, HISTORY_MESSAGE_CAP)}…`
        : item.content;

    if (used + content.length > HISTORY_CHAR_BUDGET && kept.length > 0) {
      break;
    }

    used += content.length;
    kept.unshift({ role: item.role, content });
  }

  while (kept.length > 0 && kept[0]?.role !== "user") {
    kept.shift();
  }

  return kept;
}

const GET_DATETIME_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_datetime",
    description:
      "Get the exact current date, weekday and time, for the user's own place or for any other place. Always use this for questions about today's date, the weekday, the current time, or the time in another city or country. Never use web_search for these.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            'IANA time zone id of the place the user asks about (for example Asia/Tokyo, Europe/Nicosia, America/New_York). If the user names ANY city, country or region you MUST pass its IANA id. Pass the exact string "local" ONLY when the user mentions no other place.',
        },
        place_label: {
          type: "string",
          description:
            "Name of the place as 'City, Country' or just the country, in the user's language (for example 'قبرس' or 'توکیو، ژاپن'). Required whenever timezone is not \"local\".",
        },
        show_clock: {
          type: "boolean",
          description:
            "true when the user asks for the time of day (here or elsewhere), which shows a clock card; false when they only ask about the date or the weekday.",
        },
      },
      required: ["timezone", "show_clock"],
    },
  },
};

const FIND_PLACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "find_place",
    description:
      "Look up a place on the map. Use it whenever the user asks where something is, asks for an address or location, or wants places near them. The app shows the map card (and photos when available) first and you then write general information about the place.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "For intent specific_place: the full name plus city, region or country when you know it, for example 'برج میلاد تهران'. For intent nearby_search: the English category word such as 'pharmacy' or 'restaurant'.",
        },
        intent: {
          type: "string",
          enum: ["specific_place", "nearby_search"],
          description:
            "specific_place for one named place, landmark, business or address. nearby_search for 'near me' or 'nearest' questions about a category.",
        },
      },
      required: ["query", "intent"],
    },
  },
};

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current or recent information such as news, prices and exchange rates, weather, sports results, facts about a place, or anything that may have changed after your training. Never use it for the date, the time or where a place is.",
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

function buildReadyAnswer(
  lang: Lang,
  showClock: boolean,
  placeName: string,
  now: Date,
  zone: string,
  unknownUserZone: boolean,
): string {
  const emoji = showClock ? "🕐" : "📅";
  let text: string;

  if (lang === "fa") {
    const timeFa = safeFormat(
      "fa-IR",
      { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      now,
    );

    if (showClock) {
      text = placeName
        ? `در ${placeName} ساعت ${timeFa} است`
        : `ساعت ${timeFa} است`;
    } else {
      const persian = persianDateText(now, zone);
      const gregorian = safeFormat(
        "fa-IR-u-ca-gregory",
        { timeZone: zone, day: "numeric", month: "long", year: "numeric" },
        now,
      );

      const base = persian
        ? `**${persian}**${gregorian ? ` (${gregorian})` : ""}`
        : gregorian;

      text = placeName
        ? `در ${placeName} امروز ${base} است`
        : `امروز ${base} است`;
    }

    if (unknownUserZone) {
      text += " (به وقت UTC؛ ساعت محلی شما ممکن است فرق کند)";
    }

    return `${text} ${emoji}`;
  }

  if (showClock) {
    const timeEn = safeFormat(
      "en-GB",
      { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      now,
    );

    text = placeName ? `It's ${timeEn} in ${placeName}` : `It's ${timeEn}`;
  } else {
    const dateEn = safeFormat(
      "en-US",
      {
        timeZone: zone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      },
      now,
    );

    text = placeName
      ? `Today in ${placeName} is **${dateEn}**`
      : `Today is **${dateEn}**`;
  }

  if (unknownUserZone) {
    text += " (UTC; your local time may differ)";
  }

  return `${text} ${emoji}`;
}

function runGetDatetime(
  args: Record<string, unknown>,
  ctx: ToolContext,
): ToolOutcome {
  const userZone = ctx.timeZone ?? "UTC";
  const requested =
    typeof args.timezone === "string" ? args.timezone.trim() : "";
  const isLocalRequest = requested === "" || requested.toLowerCase() === "local";
  const zone = isLocalRequest ? userZone : resolveTimeZone(requested);

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

  const isUserZone = zone === userZone;
  const placeName = isLocalRequest
    ? ""
    : label || (isUserZone ? "" : cityFromZone(zone));

  const readyAnswer = buildReadyAnswer(
    ctx.lang,
    showClock,
    placeName,
    now,
    zone,
    isUserZone && ctx.timeZone === null,
  );

  const data = {
    ready_answer: readyAnswer,
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
    is_user_time_zone: isUserZone,
    hours_ahead_of_user: diff / 60,
    day_relative_to_user: dayRelation,
  };

  if (!showClock) {
    return { data, finalText: readyAnswer };
  }

  return {
    data,
    finalText: readyAnswer,
    cards: [
      {
        t: "clock",
        iso: now.toISOString(),
        zone,
        ref: userZone,
        ...(placeName ? { label: placeName } : {}),
        lang: ctx.lang,
      },
    ],
  };
}

type NominatimOptions = {
  readonly limit: number;
  readonly viewbox: {
    readonly delta: number;
    readonly bounded: boolean;
  } | null;
};

function zoomFromRank(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) {
    return 15;
  }

  if (rank <= 4) {
    return 5;
  }

  if (rank <= 8) {
    return 7;
  }

  if (rank <= 12) {
    return 9;
  }

  if (rank <= 16) {
    return 11;
  }

  if (rank <= 18) {
    return 12;
  }

  if (rank <= 20) {
    return 13;
  }

  if (rank <= 22) {
    return 14;
  }

  if (rank <= 25) {
    return 15;
  }

  return 16;
}

function zoomFromPhotonType(type: string): number {
  if (type === "country") {
    return 5;
  }

  if (type === "state") {
    return 7;
  }

  if (type === "county") {
    return 9;
  }

  if (type === "city") {
    return 11;
  }

  if (type === "district" || type === "locality") {
    return 13;
  }

  return 16;
}

function withDistance(
  ctx: ToolContext,
  name: string,
  address: string,
  lat: number,
  lon: number,
  zoom?: number,
): PlaceItem {
  const km = ctx.location
    ? Math.round(haversineKm(ctx.location, lat, lon) * 10) / 10
    : undefined;

  return {
    name: name.slice(0, 80),
    address: address.slice(0, 160),
    lat: round5(lat),
    lon: round5(lon),
    ...(km !== undefined ? { km } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

async function searchNominatim(
  query: string,
  ctx: ToolContext,
  options: NominatimOptions,
  masterSignal: AbortSignal,
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(options.limit),
    addressdetails: "1",
    extratags: "1",
    "accept-language": ctx.lang === "fa" ? "fa,en" : "en",
  });

  if (options.viewbox && ctx.location) {
    const { lat, lon } = ctx.location;
    const d = options.viewbox.delta;

    params.set(
      "viewbox",
      [lon - d, lat + d, lon + d, lat - d].map((n) => n.toFixed(5)).join(","),
    );

    if (options.viewbox.bounded) {
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
      throw new Error(`Nominatim failed with status ${response.status}.`);
    }

    const json: unknown = await response.json();

    if (!Array.isArray(json)) {
      return [];
    }

    const candidates: PlaceCandidate[] = [];

    for (const raw of json) {
      if (!isRecord(raw)) {
        continue;
      }

      const lat = Number(raw.lat);
      const lon = Number(raw.lon);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const address = isRecord(raw.address) ? raw.address : {};
      const extratags = isRecord(raw.extratags) ? raw.extratags : {};
      const displayName = pickString(raw, "display_name");
      const rank = Number(raw.place_rank);
      const importance = Number(raw.importance);

      const name =
        pickString(raw, "name") ||
        displayName.split(",")[0]?.trim() ||
        query;

      const region = [
        pickString(address, "city") ||
          pickString(address, "town") ||
          pickString(address, "village") ||
          pickString(address, "municipality") ||
          pickString(address, "county"),
        pickString(address, "state"),
        pickString(address, "country"),
      ]
        .filter(Boolean)
        .join(", ");

      const facts: Record<string, string> = {};

      for (const key of FACT_KEYS) {
        const value = pickString(extratags, key);

        if (value) {
          facts[key] = value.slice(0, 200);
        }
      }

      candidates.push({
        item: withDistance(
          ctx,
          name,
          region || displayName,
          lat,
          lon,
          zoomFromRank(rank),
        ),
        category: [pickString(raw, "category"), pickString(raw, "type")]
          .filter(Boolean)
          .join("/"),
        facts,
        wikipedia: pickString(extratags, "wikipedia"),
        importance: Number.isFinite(importance) ? importance : 0,
      });
    }

    return candidates;
  } finally {
    timed.clearConnectTimer();
  }
}

async function searchPhoton(
  query: string,
  ctx: ToolContext,
  masterSignal: AbortSignal,
  useBias: boolean,
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({ q: query, limit: "8" });

  if (useBias && ctx.location) {
    params.set("lat", String(ctx.location.lat));
    params.set("lon", String(ctx.location.lon));
  }

  const timed = createAttempt(masterSignal, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://photon.komoot.io/api/?${params.toString()}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Photon failed with status ${response.status}.`);
    }

    const json: unknown = await response.json();
    const features =
      isRecord(json) && Array.isArray(json.features) ? json.features : [];

    const candidates: PlaceCandidate[] = [];

    for (const feature of features) {
      if (
        !isRecord(feature) ||
        !isRecord(feature.geometry) ||
        !isRecord(feature.properties)
      ) {
        continue;
      }

      const coordinates = feature.geometry.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        continue;
      }

      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);

      if (!isValidGeo(lat, lon)) {
        continue;
      }

      const props = feature.properties;
      const name =
        pickString(props, "name") || pickString(props, "street") || query;
      const street = [
        pickString(props, "street"),
        pickString(props, "housenumber"),
      ]
        .filter(Boolean)
        .join(" ");
      const address = [
        street,
        pickString(props, "district"),
        pickString(props, "city"),
        pickString(props, "state"),
        pickString(props, "country"),
      ]
        .filter(Boolean)
        .join(", ");

      candidates.push({
        item: withDistance(
          ctx,
          name,
          address,
          lat,
          lon,
          zoomFromPhotonType(pickString(props, "type")),
        ),
        category: [pickString(props, "osm_key"), pickString(props, "osm_value")]
          .filter(Boolean)
          .join("/"),
        facts: {},
        wikipedia: "",
        importance: 0,
      });
    }

    return candidates;
  } finally {
    timed.clearConnectTimer();
  }
}

function parseWikiTag(
  tag: string,
): { readonly lang: string; readonly title: string } | null {
  const match = /^([a-z]{2,3}(?:-[a-z]{2,8})?):(.+)$/i.exec(tag.trim());

  if (!match) {
    return null;
  }

  const lang = (match[1] ?? "").toLowerCase();
  const title = (match[2] ?? "").trim().replace(/ /g, "_");

  return lang && title ? { lang, title } : null;
}

async function fetchWikipediaSummary(
  tag: string,
  masterSignal: AbortSignal,
): Promise<string> {
  const parsed = parseWikiTag(tag);

  if (!parsed) {
    return "";
  }

  const timed = createAttempt(masterSignal, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(parsed.title)}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      return "";
    }

    const json: unknown = await response.json();

    return isRecord(json) && typeof json.extract === "string"
      ? json.extract.slice(0, 900)
      : "";
  } catch (error) {
    console.error(`wikipedia summary failed: ${describeError(error)}`);

    return "";
  } finally {
    timed.clearConnectTimer();
  }
}

async function fetchWikipediaPhotos(
  tag: string,
  masterSignal: AbortSignal,
): Promise<PhotoItem[]> {
  const parsed = parseWikiTag(tag);

  if (!parsed) {
    return [];
  }

  const timed = createAttempt(masterSignal, WIKI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://${parsed.lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(parsed.title)}`,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          Accept: "application/json",
        },
        signal: timed.signal,
      },
    );

    if (!response.ok) {
      return [];
    }

    const json: unknown = await response.json();
    const items = isRecord(json) && Array.isArray(json.items) ? json.items : [];
    const photos: PhotoItem[] = [];

    for (const raw of items) {
      if (!isRecord(raw) || raw.type !== "image") {
        continue;
      }

      const title = pickString(raw, "title");

      if (!title || /\.svg$/i.test(title) || PHOTO_SKIP_PATTERN.test(title)) {
        continue;
      }

      const srcset = Array.isArray(raw.srcset) ? raw.srcset : [];
      const last: unknown = srcset[srcset.length - 1];

      if (!isRecord(last)) {
        continue;
      }

      let src = pickString(last, "src");

      if (src.startsWith("//")) {
        src = `https:${src}`;
      }

      if (!src.startsWith("https://upload.wikimedia.org/")) {
        continue;
      }

      if (photos.some((photo) => photo.src === src)) {
        continue;
      }

      photos.push({
        src,
        title: title.replace(/^[^:]+:/, "").replace(/_/g, " ").slice(0, 100),
      });

      if (photos.length >= 5) {
        break;
      }
    }

    return photos;
  } catch (error) {
    console.error(`wikipedia photos failed: ${describeError(error)}`);

    return [];
  } finally {
    timed.clearConnectTimer();
  }
}

const webCache = new Map<
  string,
  { readonly at: number; readonly results: WebResult[] }
>();

function rememberWebResults(key: string, results: WebResult[]): void {
  if (webCache.size >= WEB_CACHE_MAX_ENTRIES) {
    const oldest = webCache.keys().next().value;

    if (oldest !== undefined) {
      webCache.delete(oldest);
    }
  }

  webCache.set(key, { at: Date.now(), results });
}

async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults: number,
  masterSignal: AbortSignal,
): Promise<WebResult[] | null> {
  const cacheKey = `${maxResults}:${query.trim().toLowerCase()}`;
  const cached = webCache.get(cacheKey);

  if (cached && Date.now() - cached.at < WEB_CACHE_TTL_MS) {
    return cached.results;
  }

  const timed = createAttempt(masterSignal, TOOL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      console.error(`web_search failed with status ${response.status}.`);

      return null;
    }

    const json: unknown = await response.json();
    const rawResults =
      isRecord(json) && Array.isArray(json.results) ? json.results : [];
    const results: WebResult[] = [];

    for (const raw of rawResults) {
      if (!isRecord(raw)) {
        continue;
      }

      const title = pickString(raw, "title").trim();
      const rawUrl = pickString(raw, "url");
      const content = pickString(raw, "content");

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
        source: host.slice(0, 80),
        snippet: content.slice(0, 500),
      });
    }

    if (results.length > 0) {
      rememberWebResults(cacheKey, results);
    }

    return results;
  } catch (error) {
    console.error(`web_search threw: ${describeError(error)}`);

    return null;
  } finally {
    timed.clearConnectTimer();
  }
}

function distinctLocations(
  list: readonly PlaceCandidate[],
): PlaceCandidate[] {
  const distinct: PlaceCandidate[] = [];

  for (const candidate of list) {
    const isNew = distinct.every(
      (existing) => distanceBetween(existing.item, candidate.item) > 2,
    );

    if (isNew) {
      distinct.push(candidate);
    }
  }

  return distinct;
}

type SpecificPick = {
  readonly chosen: PlaceCandidate;
  readonly alternatives: readonly PlaceCandidate[];
  readonly ambiguous: boolean;
};

function pickSpecific(
  top: PlaceCandidate,
  all: readonly PlaceCandidate[],
): SpecificPick {
  const topKey = normalizePlaceName(top.item.name);

  const rivals = distinctLocations(
    all.filter(
      (candidate) =>
        candidate !== top &&
        normalizePlaceName(candidate.item.name) === topKey &&
        distanceBetween(candidate.item, top.item) > 2,
    ),
  ).slice(0, 2);

  return {
    chosen: top,
    alternatives: rivals,
    ambiguous: rivals.length > 0 && top.importance < 0.45,
  };
}

function selectNearby(candidates: readonly PlaceCandidate[]): PlaceItem[] {
  const sorted = candidates
    .slice()
    .sort((a, b) => (a.item.km ?? 1e9) - (b.item.km ?? 1e9));
  const picked: PlaceItem[] = [];

  for (const candidate of sorted) {
    const key = normalizePlaceName(candidate.item.name);
    const duplicate = picked.some(
      (existing) =>
        normalizePlaceName(existing.name) === key &&
        distanceBetween(existing, candidate.item) < 0.2,
    );

    if (!duplicate) {
      picked.push(candidate.item);
    }

    if (picked.length >= 3) {
      break;
    }
  }

  return picked;
}

function nearbyOutcome(
  items: readonly PlaceItem[],
  ctx: ToolContext,
): ToolOutcome {
  return {
    data: {
      results: items.map((item) => ({
        name: item.name,
        address: item.address,
        lat: item.lat,
        lon: item.lon,
        distance_km: item.km,
      })),
    },
    finalText: "",
    cardFirst: true,
    cards: [{ t: "places", lang: ctx.lang, items }],
  };
}

async function runNearbySearch(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!ctx.location) {
    return {
      data: {
        error: "user_location_not_available",
        hint: "The user's location is not available. Tell them, in one short sentence, to allow location access for this site in the browser settings.",
      },
    };
  }

  const attempts: NominatimOptions[] = [
    { limit: 10, viewbox: { delta: 0.06, bounded: true } },
    { limit: 10, viewbox: { delta: 0.3, bounded: true } },
    { limit: 10, viewbox: { delta: 0.3, bounded: false } },
  ];

  let lastError = "";

  for (const options of attempts) {
    try {
      const found = await searchNominatim(query, ctx, options, signal);
      const items = selectNearby(found);

      if (items.length > 0) {
        return nearbyOutcome(items, ctx);
      }
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place nominatim failed: ${lastError}`);
    }
  }

  try {
    const found = await searchPhoton(query, ctx, signal, true);
    const items = selectNearby(found);

    if (items.length > 0) {
      return nearbyOutcome(items, ctx);
    }
  } catch (error) {
    lastError = describeError(error);
    console.error(`find_place photon failed: ${lastError}`);
  }

  if (lastError) {
    return {
      data: { error: "map_lookup_failed", detail: lastError.slice(0, 200) },
    };
  }

  return { data: { results: [], note: "No places were found." } };
}

async function runSpecificPlace(
  query: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  let candidates: PlaceCandidate[] = [];
  let lastError = "";

  try {
    candidates = await searchNominatim(
      query,
      ctx,
      { limit: 8, viewbox: null },
      signal,
    );
  } catch (error) {
    lastError = describeError(error);
    console.error(`find_place nominatim failed: ${lastError}`);
  }

  if (candidates.length === 0) {
    try {
      candidates = await searchPhoton(query, ctx, signal, false);
    } catch (error) {
      lastError = describeError(error);
      console.error(`find_place photon failed: ${lastError}`);
    }
  }

  const ranked = candidates
    .slice()
    .sort((a, b) => b.importance - a.importance);
  const top = ranked[0];

  if (!top) {
    return lastError
      ? {
          data: {
            error: "map_lookup_failed",
            detail: lastError.slice(0, 200),
          },
        }
      : { data: { results: [], note: "No places were found." } };
  }

  const pick = pickSpecific(top, ranked);
  const chosen = pick.chosen;

  let about = "";
  let photos: PhotoItem[] = [];

  if (chosen.wikipedia) {
    const [summary, gallery] = await Promise.all([
      fetchWikipediaSummary(chosen.wikipedia, signal),
      fetchWikipediaPhotos(chosen.wikipedia, signal),
    ]);

    about = summary;
    photos = gallery;
  }

  let webContext: Array<{ readonly source: string; readonly snippet: string }> =
    [];

  if (!about && ctx.tavilyKey) {
    const found = await tavilySearch(
      `${chosen.item.name} ${chosen.item.address}`.trim(),
      ctx.tavilyKey,
      3,
      signal,
    );

    webContext = (found ?? []).map((result) => ({
      source: result.source,
      snippet: result.snippet.slice(0, 400),
    }));
  }

  const cards: CardPayload[] = [
    { t: "places", lang: ctx.lang, items: [chosen.item] },
  ];

  if (photos.length > 0) {
    cards.push({ t: "photos", lang: ctx.lang, items: photos });
  }

  return {
    data: {
      place: {
        name: chosen.item.name,
        region: chosen.item.address,
        category: chosen.category,
        lat: chosen.item.lat,
        lon: chosen.item.lon,
        distance_km: chosen.item.km,
        facts: chosen.facts,
        about,
        about_source: about ? "wikipedia" : "",
      },
      web_context: webContext,
      ambiguous: pick.ambiguous,
      picked_reason: "most_prominent",
      other_matches: pick.alternatives.map((candidate) => ({
        name: candidate.item.name,
        region: candidate.item.address,
        distance_km: candidate.item.km,
      })),
    },
    cardFirst: true,
    cards,
  };
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

  return args.intent === "nearby_search"
    ? await runNearbySearch(query, ctx, signal)
    : await runSpecificPlace(query, ctx, signal);
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

  const results = await tavilySearch(query, ctx.tavilyKey, 5, signal);

  if (results === null) {
    return { data: { error: "Web search failed." } };
  }

  if (results.length === 0) {
    return { data: { results: [], note: "No web results were found." } };
  }

  return { data: { results } };
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
    console.error(`tool ${name} threw: ${describeError(error)}`);

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

  const hour = Number(
    safeFormat(
      "en-GB",
      { timeZone: zone, hour: "2-digit", hourCycle: "h23" },
      now,
    ),
  );

  const partOfDay = !Number.isFinite(hour)
    ? "day"
    : hour < 5
      ? "night"
      : hour < 12
        ? "morning"
        : hour < 17
          ? "afternoon"
          : hour < 21
            ? "evening"
            : "night";

  const lines: string[] = [
    "You are Mass Diamond, a brilliant, warm and precise AI assistant inside the Mass Diamond app.",
    "",
    "Reference data (authoritative and already converted; never recompute, convert or reformat it yourself):",
    `- Gregorian date: ${gregorian}`,
  ];

  if (persian) {
    lines.push(`- Persian (Solar Hijri) date: ${persian}`);
  }

  lines.push(
    `- Local time: ${time} (time zone: ${zone})`,
    `- Part of the day for the user: ${partOfDay} (use it only to pick a fitting greeting when the user greets you).`,
  );

  if (!ctx.timeZone) {
    lines.push(
      "- The user's real time zone is unknown, so if the time is requested, say it is UTC and may differ locally.",
    );
  }

  if (ctx.location) {
    lines.push(
      "- The user's position is already known automatically. For 'near me' or 'nearest' questions call find_place with intent nearby_search. Never ask them to share it.",
    );
  } else {
    lines.push(
      "- The user's position is NOT available (location permission is off or denied). For 'near me' questions tell them, in one short sentence, to allow location access for this site in the browser settings.",
    );
  }

  lines.push(
    "Rules for date and time: mention the date or time ONLY when the user explicitly asks, or when the task truly needs it (an age, a deadline, a countdown). Never mention them in greetings or small talk, except a fitting time-of-day greeting word.",
    "",
    "Core behaviour:",
    "- Task requests (questions, lookups, writing, plans): answer exactly what was asked, nothing more. Lead with the answer. No filler openings and no closing lines such as 'anything else?', 'let me know', 'shall we start?' or 'how can I help further?'. Ask a question only when you truly cannot proceed without the answer, and then ask just one short question (if the topic is unknown, list 3 or 4 concrete options in that one line).",
    "- Small talk (greetings, 'how are you?', thanks, compliments, the user's mood) is where you are a warm, cheerful, close friend. Reply in 1 to 3 natural sentences: answer the personal question genuinely, react to the user's mood, and invite them to continue with something specific and inviting. Never answer a greeting with only the greeting word. Use a time-of-day greeting (صبح بخیر، عصر بخیر، شب بخیر) when it fits. Use at most one exclamation mark in the whole reply and never end a greeting with a bare '!'. Match the user's register (informal 'تو' if they are informal). Vary your wording and never copy the same reply twice.",
    "- Never address the user with honorifics such as 'قربان'.",
    "- When asked to create something (an ad, a text, names), deliver a concrete, polished, complete result immediately, using sensible assumptions. Put every unknown specific in [square brackets] as a placeholder. Never invent facts such as ratings, prices, discount codes, phone numbers, addresses or statistics.",
    "",
    "Writing quality:",
    "- Write like an expert human writer: vivid, precise, confident, never generic. Prefer concrete details, numbers and examples over filler. Keep paragraphs short.",
    "- In Persian use natural, idiomatic, polished Persian that does not sound translated, correct half-spaces (ZWNJ) and Persian digits. Never type Latin letters inside Persian words and never mix English words into Persian sentences unless it is a brand or an established term (like HIIT). Use only words you are sure exist; if unsure, choose a simpler common word. Re-read before answering and fix typos and odd words.",
    "- Plans and schedules (workouts, study, meals, trips) must be complete and numbered. (1) A title line such as '**برنامه‌ی ورزشی ۴ روزه**' that always states the total number of days or weeks. (2) One line summarising goal, level, session length and rest days. (3) ONE single Markdown table for the whole plan: never one table per day and never separate sections or headings per day. For workouts use exactly these columns (translate the column names into the user's language): روز | تمرین | ست | تکرار یا مدت | استراحت | نکته. Every row starts with its day label in the first column (for example 'روز ۱'; for plans with several weeks write 'هفته ۱ - روز ۱'). Warm-up and cool-down are rows too. A rest day is one row: the day label, 'استراحت' in the تمرین column, '-' in the number columns and a short suggestion in the نکته column. Every day of the plan must appear as rows, so the plan is complete. (4) Keep cells short (at most 6 words) and write exercise names in Persian. (5) Finish with '### نکات' and 3 or 4 short tips (progression, recovery, hydration, safety).",
    "- Emojis: sparingly, 0 to 2 per reply, only where they add warmth. None in code, tables or serious topics (illness, grief, legal or financial risk, errors).",
    "",
    "Tools:",
    '- get_datetime: use it for ANY question about today\'s date, the weekday, the current time, or the time in another city or country; never answer these from memory and never use web_search for them. If the user mentions ANY city, country or region you MUST pass its IANA time zone id and a place_label; pass timezone "local" only when no place is mentioned. Set show_clock=true only when the user asks for the time of day; false for date or weekday questions. The app writes the answer itself, so after this tool returns just stop.',
    "- find_place: call it FIRST for any question about where a place, business, landmark or address is, or for places near the user. Never answer locations from memory. Use intent specific_place for one named place (query = its full name plus city, region or country when you know it, in the user's language) and intent nearby_search for 'near me' category questions (query = the English category word, e.g. pharmacy). After nearby_search the app shows the cards, so just stop. After specific_place the app has already shown the map card (and a photo strip when available); now write 2 to 4 sentences of general information about the place: what it is, where it is (region and country) and why it is notable. Use ONLY facts found in the tool data: first `about`, then `web_context`, then the category and region fields. Never add roads, landmarks, populations, dates or history that are not in the data; if there is little data, write one short factual sentence from the category and region and stop. Do not repeat the address or coordinates and do not mention photos. If `ambiguous` is true add one short clause saying that other places share this name and that you showed the best-known one. If it reports a failure, say in one short sentence that the map could not be reached right now.",
    ctx.tavilyKey
      ? "- web_search: call it FIRST for anything that changes over time: prices and exchange rates (currency, gold, crypto), news, weather, sports results, schedules. Write the query in the language best suited to the topic (Persian for Iranian prices and news). Answer in ONE short sentence with the key number exactly as in the results. For prices keep the unit exactly as the source states it (تومان or ریال, never convert), write numbers with the thousands separator ٬ (for example ۲۶٬۲۴۰٬۹۰۰), say 'حدود' or 'approximately', and give a range if sources disagree. If a number looks implausible next to the other data, say you could not confirm it. Never write source names or URLs."
      : "- You cannot browse the internet or check live information (news, prices, weather). If asked, say so in one short sentence.",
    "- Never mention tools, function names, JSON or internal data to the user. If a tool reports an error, say in one short sentence that the lookup failed right now; never invent the answer.",
    "- Bracketed notes such as [map card shown: ...] in the conversation are internal records of cards the app already displayed. Never write such notes yourself.",
    "",
    "Language: always reply in the language of the user's latest message, and keep that language consistent through the whole reply.",
    "",
    "Honesty:",
    "- Do not invent facts. If you are not sure, say so.",
  );

  return lines.join("\n");
}

function getConfiguredProviders(): AIProviderId[] {
  const providers: AIProviderId[] = [];

  if (getOptionalEnv("GROQ_API_KEY") && groqModelCandidates().length > 0) {
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
      temperature: GROQ_TEMPERATURE,
      stream: true,
    };

    if (model.includes("gpt-oss")) {
      payload.reasoning_effort = getOptionalEnv("GROQ_REASONING_EFFORT") ?? "medium";
    }

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
  const emitted = new Set<string>();
  const deferred: string[] = [];
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

    const outcomes: ToolOutcome[] = [];

    for (const call of turn.toolCalls) {
      const outcome = await executeTool(
        call.name,
        call.arguments,
        params.ctx,
        params.signal,
      );

      outcomes.push(outcome);

      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.data).slice(0, 12_000),
      });

      for (const card of outcome.cards ?? []) {
        const marker = encodeCard(card);

        if (outcome.cardFirst) {
          if (!emitted.has(marker) && emitted.size < MAX_CARDS) {
            emitted.add(marker);
            yield `${marker}\n\n`;
          }
        } else if (
          !emitted.has(marker) &&
          !deferred.includes(marker) &&
          emitted.size + deferred.length < MAX_CARDS
        ) {
          deferred.push(marker);
        }
      }
    }

    if (outcomes.every((outcome) => outcome.finalText !== undefined)) {
      for (const outcome of outcomes) {
        if (outcome.finalText) {
          yield `${outcome.finalText}\n\n`;
        }

        for (const card of outcome.cards ?? []) {
          const marker = encodeCard(card);

          if (!emitted.has(marker)) {
            emitted.add(marker);
            yield `${marker}\n\n`;
          }
        }
      }

      return;
    }

    const roundOptions: GroqToolOptions = {
      tools: params.tools,
      toolChoice: round + 1 >= MAX_TOOL_ROUNDS ? "none" : "auto",
    };

    let next = await requestGroqRound(
      params.apiKey,
      params.model,
      convo,
      roundOptions,
      params.signal,
    );

    if (!next.ok && next.retryable) {
      await sleep(RETRY_DELAY_MS);
      next = await requestGroqRound(
        params.apiKey,
        params.model,
        convo,
        roundOptions,
        params.signal,
      );
    }

    if (!next.ok) {
      console.error(
        `Groq follow-up round failed (status ${next.status}): ${next.error.slice(0, 300)}`,
      );

      throw new Error(next.error.slice(0, 300));
    }

    body = next.body;
  }

  for (const marker of deferred) {
    if (!emitted.has(marker)) {
      emitted.add(marker);
      yield `\n\n${marker}`;
    }
  }
}

async function openGroqAgent(
  messages: readonly AIMessage[],
  ctx: ToolContext,
  masterSignal: AbortSignal,
): Promise<StreamOpenResult> {
  const apiKey = getOptionalEnv("GROQ_API_KEY");
  const models = groqModelCandidates();

  if (!apiKey || models.length === 0) {
    return failure("groq", "Groq provider is not configured.", false);
  }

  const tools = buildToolDefinitions(ctx);
  const oaiMessages = messages.map(toOAIMessage);

  let lastFailure: StreamOpenFailure = failure(
    "groq",
    "Groq request failed.",
    true,
  );

  for (const model of models) {
    let withTools = true;
    let round = await requestGroqRound(
      apiKey,
      model,
      oaiMessages,
      { tools, toolChoice: "auto" },
      masterSignal,
    );

    if (!round.ok && round.retryable) {
      await sleep(RETRY_DELAY_MS);
      round = await requestGroqRound(
        apiKey,
        model,
        oaiMessages,
        { tools, toolChoice: "auto" },
        masterSignal,
      );
    }

    if (!round.ok && round.status === 400) {
      console.error(
        `Groq model ${model} rejected the tool request: ${round.error.slice(0, 300)}`,
      );
      withTools = false;
      round = await requestGroqRound(
        apiKey,
        model,
        oaiMessages,
        null,
        masterSignal,
      );
    }

    if (round.ok) {
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

    console.error(
      `Groq model ${model} failed (status ${round.status}): ${round.error.slice(0, 300)}`,
    );
    lastFailure = failure("groq", round.error.slice(0, 300), round.retryable);
  }

  return lastFailure;
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
    generationConfig: { temperature: 0.5 },
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

      console.error(
        `Gemini failed (status ${response.status}): ${errorText.slice(0, 300)}`,
      );

      return failure(
        "gemini",
        errorText.slice(0, 300) ||
          `Gemini request failed with status ${response.status}.`,
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

  return rows
    .map((row) => ({
      role: row.role,
      content: stripMarkers(row.content),
    }))
    .filter((message) => message.content.length > 0);
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

async function saveExchange(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantContent: string,
): Promise<void> {
  await saveUserMessage(adminClient, userId, conversationId, userMessage);
  await saveAssistantMessage(
    adminClient,
    userId,
    conversationId,
    assistantContent,
  );
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
  readonly userMessage: string;
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
          console.error(
            `request ${input.requestId}: the AI provider returned an empty response.`,
          );

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

        try {
          await saveExchange(
            input.adminClient,
            input.userId,
            input.conversationId,
            input.userMessage,
            finalContent,
          );

          await touchConversation(
            input.adminClient,
            input.userId,
            input.conversationId,
          );
        } catch (saveError) {
          console.error(
            `request ${input.requestId}: failed to save the exchange: ${describeError(saveError)}`,
          );
        }

        send("done", {
          requestId: input.requestId,
          conversationId: input.conversationId,
          provider: input.provider,
          model: input.model,
          content: finalContent,
        });
      } catch (error) {
        console.error(
          `request ${input.requestId}: stream failed: ${describeError(error).slice(0, 300)}`,
        );

        send("error", {
          error: {
            code: "AI_PROVIDER_ERROR",
            message: describeError(error).slice(0, 300),
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

    const history = trimHistory(
      await loadHistory(adminClient, user.id, conversationId),
    );

    const ctx: ToolContext = {
      now: new Date(),
      timeZone: resolveTimeZone(body.timeZone),
      location,
      lang: /[\u0600-\u06FF]/.test(message) ? "fa" : "en",
      tavilyKey: getTavilyKey(),
    };

    console.log(
      `request ${requestId}: web_search=${ctx.tavilyKey ? "on" : "off"}, location=${ctx.location ? "yes" : "no"}, history=${history.length}`,
    );

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

      console.error(
        `request ${requestId}: provider ${opened.provider} failed: ${opened.error.slice(0, 300)}`,
      );

      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: opened.error.slice(0, 300),
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
        userMessage: message,
        adminClient,
        master,
        totalTimer,
      });
    }

    let content: string;

    try {
      content = (await collectChunks(opened.chunks)).trim();
    } catch (error) {
      console.error(
        `request ${requestId}: generation failed: ${describeError(error).slice(0, 300)}`,
      );

      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: describeError(error).slice(0, 300),
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

    try {
      await saveExchange(
        adminClient,
        user.id,
        conversationId,
        message,
        content,
      );

      await touchConversation(adminClient, user.id, conversationId);
    } catch (saveError) {
      console.error(
        `request ${requestId}: failed to save the exchange: ${describeError(saveError)}`,
      );
    }

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

    console.error(`request ${requestId}: failed: ${message.slice(0, 300)}`);

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
