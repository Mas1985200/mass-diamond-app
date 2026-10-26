import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";

import { supabase } from "../../lib/supabase";
import { useChat } from "../../hooks/useChat";
import { useVoiceInput } from "../../hooks/useVoiceInput";
import { VOICE_LABELS } from "../../features/voice/voiceMessages";
import type { ChatErrorCode } from "../../lib/chatClient";
import DiamondMark from "../DiamondMark";
import MarkdownText from "./MarkdownText";
import DirectionsButton from "./DirectionsButton";
import VoiceStatusBar from "./VoiceStatusBar";
import PhotosCard, { parsePhotosCard, type PhotosCardData } from "./PhotosCard";
import PhotoStrip, { MessageThumbs } from "./PhotoStrip";
import AttachSheet from "./AttachSheet";
import {
  MAX_PHOTOS,
  addImages,
  type AttachErrorCode,
  type AttachedPhoto,
} from "../../lib/imageAttach";

const ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  AUTH_REQUIRED: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
  CONVERSATION_NOT_FOUND:
    "این گفتگو پیدا نشد. پیام بعدی شما گفتگوی جدیدی را شروع می‌کند.",
  AI_PROVIDER_ERROR:
    "دستیار هوشمند در حال حاضر پاسخ نمی‌دهد. لطفاً دوباره تلاش کنید.",
  METHOD_NOT_ALLOWED: "درخواست نامعتبر بود. لطفاً دوباره تلاش کنید.",
  INTERNAL_ERROR: "خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.",
  NETWORK_ERROR:
    "اتصال به سرور برقرار نشد. لطفاً اینترنت خود را بررسی کنید.",
  UNKNOWN_ERROR: "خطای ناشناخته‌ای رخ داد. لطفاً دوباره تلاش کنید.",
};

const PHOTO_ERROR_MESSAGES: Record<AttachErrorCode, string> = {
  unsupported: "فقط فایل عکس قابل پیوست است.",
  unreadable: "این عکس خوانده نشد. لطفاً عکس دیگری انتخاب کنید.",
  limit: `حداکثر ${MAX_PHOTOS.toLocaleString("fa-IR")} عکس را می‌شود پیوست کرد.`,
};

const DEFAULT_PLACEHOLDER = "چطور می‌تونم کمکت کنم؟";
const ROUND_BUTTON_CLASS =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const STICK_THRESHOLD_PX = 80;
const RESIZE_GRACE_MS = 400;
const LOCATION_REFRESH_MS = 120_000;
const SEND_IMAGE_SRC = "/send-diamond-full.png";
const NO_PAGE_ZOOM = "pan-x pan-y";
const TILE_SIZE = 256;
const PREVIEW_ZOOM = 16;
const PREVIEW_HEIGHT = 168;
// The spoken language of the voice input. This screen is Persian; a fixed
// language is more accurate than automatic detection, which can mistake
// Persian for Arabic or Urdu.
const VOICE_LANGUAGE = "fa";
const VOICE_ERROR_VISIBLE_MS = 6_000;
// What the voice input is told about the person's own earlier words.
const VOICE_CONTEXT_MESSAGES = 3;
const VOICE_CONTEXT_MESSAGE_CHARS = 200;

interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly enabled: boolean;
  readonly highlight?: boolean;
  readonly icon: ReactNode;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "ask",
    label: "هر چیزی بپرس",
    hint: DEFAULT_PLACEHOLDER,
    enabled: true,
    icon: <ChatIcon />,
  },
  {
    id: "web",
    label: "جستجو در وب",
    hint: "چه چیزی را جستجو کنم؟",
    enabled: false,
    highlight: true,
    icon: <SearchIcon />,
  },
  {
    id: "image",
    label: "ساخت تصویر",
    hint: "چه تصویری بسازم؟",
    enabled: false,
    icon: <ImageIcon />,
  },
  {
    id: "learn",
    label: "کمک آموزشی",
    hint: "چه چیزی یاد بگیریم؟",
    enabled: true,
    icon: <LearnIcon />,
  },
  {
    id: "product",
    label: "پیدا کردن محصول",
    hint: "دنبال چه محصولی هستی؟",
    enabled: true,
    icon: <BagIcon />,
  },
  {
    id: "property",
    label: "جستجوی ملک",
    hint: "دنبال چه ملکی هستی؟",
    enabled: true,
    icon: <HomeIcon />,
  },
];

const DIAMOND_FADE_MASK =
  "radial-gradient(ellipse at center, #000 58%, transparent 100%)";

const SEARCH_GLOW_CSS = `
@keyframes md-search-glow {
  0%, 100% { box-shadow: 0 0 10px rgba(57,255,136,0.18); }
  50% { box-shadow: 0 0 22px rgba(57,255,136,0.42); }
}
.md-search-highlight {
  background: linear-gradient(135deg, rgba(57,255,136,0.20), rgba(57,255,136,0.04));
  border-color: rgba(57,255,136,0.55);
  animation: md-search-glow 2.6s ease-in-out infinite;
}
@keyframes md-thinking {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1); }
}
.md-thinking-dot {
  animation: md-thinking 1.2s ease-in-out infinite;
}
@keyframes md-rec {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}
.md-rec-dot {
  animation: md-rec 1.1s ease-in-out infinite;
}
.md-second-hand {
  transition: transform 0.3s cubic-bezier(0.4, 2.2, 0.55, 1);
}
.md-gallery {
  scrollbar-width: none;
}
.md-gallery::-webkit-scrollbar {
  display: none;
}
.md-prose { width: 100%; }
.md-prose ol,
.md-prose ul {
  padding-inline-start: 1.5rem !important;
  margin-inline-start: 0 !important;
  margin-block: 0.4rem !important;
}
.md-prose li {
  padding-inline-start: 0.1rem !important;
  margin-block: 0.2rem !important;
}
.md-prose p,
.md-prose li {
  line-height: 1.75 !important;
}
.md-prose p {
  margin-block: 0.4rem !important;
}
@media (prefers-reduced-motion: reduce) {
  .md-search-highlight { animation: none; }
  .md-thinking-dot { animation: none; opacity: 0.7; }
  .md-rec-dot { animation: none; }
  .md-second-hand { transition: none; }
}
`;

type Lang = "fa" | "en";

interface ClockCardData {
  readonly t: "clock";
  readonly iso: string;
  readonly zone: string;
  readonly ref?: string;
  readonly label?: string;
  readonly lang: Lang;
}

interface PlaceItem {
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lon: number;
  readonly km?: number;
}

interface PlacesCardData {
  readonly t: "places";
  readonly lang: Lang;
  readonly items: readonly PlaceItem[];
}

type CardData = ClockCardData | PlacesCardData | PhotosCardData;

const MARKER_RE =
  /:::md-(?:clock~([^~\s]+)~([A-Za-z0-9_\/+-]+)~(fa|en)|card~([A-Za-z0-9_-]+)):::/g;
const PENDING_MARKER_RE = /:{2,3}(?:m[^\n]*)?$/;

type ContentPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "card"; readonly card: CardData };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asText(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function asLang(value: unknown): Lang {
  return value === "en" ? "en" : "fa";
}

function parseCard(value: unknown): CardData | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.t === "clock") {
    const iso = asText(value.iso, 40);
    const zone = asText(value.zone, 64);

    if (!iso || !zone) {
      return null;
    }

    const ref = asText(value.ref, 64) ?? undefined;
    const label = asText(value.label, 80) ?? undefined;

    return { t: "clock", iso, zone, ref, label, lang: asLang(value.lang) };
  }

  if (value.t === "places" && Array.isArray(value.items)) {
    const items: PlaceItem[] = [];

    for (const raw of value.items.slice(0, 3)) {
      if (!isRecord(raw)) {
        continue;
      }

      const name = asText(raw.name, 80);
      const address = asText(raw.address, 160) ?? "";
      const lat = typeof raw.lat === "number" ? raw.lat : Number.NaN;
      const lon = typeof raw.lon === "number" ? raw.lon : Number.NaN;

      if (
        !name ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      ) {
        continue;
      }

      const km =
        typeof raw.km === "number" && Number.isFinite(raw.km)
          ? raw.km
          : undefined;

      items.push({ name, address, lat, lon, km });
    }

    return items.length > 0
      ? { t: "places", lang: asLang(value.lang), items }
      : null;
  }

  if (value.t === "photos") {
    return parsePhotosCard(value);
  }

  return null;
}

function decodeCard(body: string): CardData | null {
  try {
    const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    return parseCard(parsed);
  } catch {
    return null;
  }
}

function splitAssistantContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let cursor = 0;

  for (const match of raw.matchAll(MARKER_RE)) {
    const index = match.index ?? 0;
    const before = raw.slice(cursor, index).trim();

    if (before) {
      parts.push({ kind: "text", text: before });
    }

    const iso = match[1];
    const zone = match[2];
    const lang = match[3];
    const cardBody = match[4];

    let card: CardData | null = null;

    if (cardBody !== undefined) {
      card = decodeCard(cardBody);
    } else if (iso !== undefined && zone !== undefined) {
      card = { t: "clock", iso, zone, lang: lang === "en" ? "en" : "fa" };
    }

    if (card) {
      parts.push({ kind: "card", card });
    }

    cursor = index + match[0].length;
  }

  const rest = raw.slice(cursor).replace(PENDING_MARKER_RE, "").trim();

  if (rest) {
    parts.push({ kind: "text", text: rest });
  }

  return parts;
}

function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
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

  return Math.round((asUtc - truncated) / 60000);
}

function dateKey(zone: string, date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

interface ClockParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

function clockParts(date: Date, zone: string): ClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    hours: read("hour"),
    minutes: read("minute"),
    seconds: read("second"),
  };
}

function shortDateText(date: Date, zone: string, lang: Lang): string {
  try {
    if (lang === "fa") {
      const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        timeZone: zone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).formatToParts(date);

      const pick = (type: string): string =>
        parts.find((part) => part.type === type)?.value ?? "";

      return [pick("weekday"), pick("day"), pick("month")]
        .filter(Boolean)
        .join(" ");
    }

    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

type DayRelation = "same" | "tomorrow" | "yesterday";

function buildRelation(diff: number, day: DayRelation, lang: Lang): string {
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const number = (value: number): string =>
    value.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  const dayPrefix =
    day === "same"
      ? ""
      : day === "tomorrow"
        ? lang === "fa"
          ? "فردا، "
          : "Tomorrow, "
        : lang === "fa"
          ? "دیروز، "
          : "Yesterday, ";

  if (diff === 0) {
    return `${dayPrefix}${lang === "fa" ? "هم‌ساعت با شما" : "Same time as you"}`;
  }

  if (lang === "fa") {
    const pieces: string[] = [];

    if (hours > 0) {
      pieces.push(`${number(hours)} ساعت`);
    }

    if (minutes > 0) {
      pieces.push(`${number(minutes)} دقیقه`);
    }

    return `${dayPrefix}${pieces.join(" و ")} ${
      diff > 0 ? "جلوتر از شما" : "عقب‌تر از شما"
    }`;
  }

  const pieces: string[] = [];

  if (hours > 0) {
    pieces.push(`${hours}h`);
  }

  if (minutes > 0) {
    pieces.push(`${minutes}m`);
  }

  return `${dayPrefix}${pieces.join(" ")} ${
    diff > 0 ? "ahead of you" : "behind you"
  }`;
}

interface ClockInfo {
  readonly hourAngle: number;
  readonly minuteAngle: number;
  readonly secondAngle: number;
  readonly digital: string;
  readonly dateLine: string;
  readonly title: string;
  readonly relation: string | null;
}

function describeClock(
  card: ClockCardData,
  elapsedSeconds: number,
): ClockInfo | null {
  try {
    const base = new Date(card.iso);

    if (Number.isNaN(base.getTime())) {
      return null;
    }

    const zone = safeZone(card.zone);
    const refZone = safeZone(card.ref ?? browserZone());
    const current = new Date(base.getTime() + elapsedSeconds * 1000);

    const start = clockParts(base, zone);
    const now = clockParts(current, zone);

    const secondsTotal = start.seconds + elapsedSeconds;
    const minuteFraction = start.minutes + secondsTotal / 60;
    const pad = (value: number): string => String(value).padStart(2, "0");

    const diff =
      zoneOffsetMinutes(zone, current) - zoneOffsetMinutes(refZone, current);
    const zoneKey = dateKey(zone, current);
    const refKey = dateKey(refZone, current);

    const day: DayRelation =
      zoneKey === refKey ? "same" : zoneKey > refKey ? "tomorrow" : "yesterday";

    const showRelation = diff !== 0 || Boolean(card.label);

    return {
      hourAngle: ((start.hours % 12) + minuteFraction / 60) * 30,
      minuteAngle: minuteFraction * 6,
      secondAngle: secondsTotal * 6,
      digital: `${pad(now.hours)}:${pad(now.minutes)}`,
      dateLine: shortDateText(current, zone, card.lang),
      title: card.label ?? "",
      relation: showRelation ? buildRelation(diff, day, card.lang) : null,
    };
  } catch {
    return null;
  }
}

function useElapsedSeconds(): number {
  const startRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return elapsed;
}

function handStyle(angle: number): CSSProperties {
  return {
    transform: `rotate(${angle}deg)`,
    transformOrigin: "50px 50px",
  };
}

function ClockFace({
  hourAngle,
  minuteAngle,
  secondAngle,
}: {
  readonly hourAngle: number;
  readonly minuteAngle: number;
  readonly secondAngle: number;
}) {
  const ticks = Array.from({ length: 12 }, (_, index) => index);
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="h-20 w-20 shrink-0 text-primary"
      style={{ filter: "drop-shadow(0 0 5px rgba(57,255,136,0.35))" }}
    >
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="rgba(57,255,136,0.05)"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />

      {ticks.map((index) => (
        <line
          key={index}
          x1="50"
          y1="6"
          x2="50"
          y2={index % 3 === 0 ? 11 : 9}
          stroke="currentColor"
          strokeOpacity="0.85"
          strokeWidth={index % 3 === 0 ? 1.8 : 1}
          strokeLinecap="round"
          transform={`rotate(${index * 30} 50 50)`}
        />
      ))}

      {numbers.map((value) => {
        const angle = (value * 30 * Math.PI) / 180;
        const x = 50 + 33 * Math.sin(angle);
        const y = 50 - 33 * Math.cos(angle);

        return (
          <text
            key={value}
            x={x}
            y={y}
            fontSize="10"
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            fillOpacity="0.9"
          >
            {value}
          </text>
        );
      })}

      <line
        x1="50"
        y1="50"
        x2="50"
        y2="34"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        style={handStyle(hourAngle)}
      />
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        style={handStyle(minuteAngle)}
      />
      <line
        className="md-second-hand"
        x1="50"
        y1="58"
        x2="50"
        y2="16"
        stroke="currentColor"
        strokeOpacity="0.8"
        strokeWidth="1"
        strokeLinecap="round"
        style={handStyle(secondAngle)}
      />
      <circle cx="50" cy="50" r="2.6" fill="currentColor" />
    </svg>
  );
}

function ClockCard({ card }: { readonly card: ClockCardData }) {
  const elapsed = useElapsedSeconds();
  const info = describeClock(card, elapsed);

  if (!info) {
    return null;
  }

  const rtl = card.lang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="md-glass my-2 flex w-full max-w-[17rem] items-center gap-3 rounded-2xl px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        {info.title && (
          <div className="truncate text-xs font-semibold text-text">
            {info.title}
          </div>
        )}
        <div
          dir="ltr"
          className="text-3xl font-bold leading-none tabular-nums text-primary"
          style={{ textAlign: rtl ? "right" : "left" }}
        >
          {info.digital}
        </div>
        <div className="mt-1 truncate text-xs text-text">{info.dateLine}</div>
        {info.relation && (
          <div className="truncate text-[11px] leading-5 text-text-subtle">
            {info.relation}
          </div>
        )}
      </div>

      <ClockFace
        hourAngle={info.hourAngle}
        minuteAngle={info.minuteAngle}
        secondAngle={info.secondAngle}
      />
    </div>
  );
}

function coord(value: number): string {
  return value.toFixed(6);
}

function osmHref(item: PlaceItem): string {
  return `https://www.openstreetmap.org/?mlat=${coord(item.lat)}&mlon=${coord(item.lon)}#map=17/${coord(item.lat)}/${coord(item.lon)}`;
}

function geoHref(item: PlaceItem): string {
  return `geo:${coord(item.lat)},${coord(item.lon)}?q=${coord(item.lat)},${coord(item.lon)}(${encodeURIComponent(item.name)})`;
}

function embedSrc(item: PlaceItem, lonSpan: number): string {
  const latSpan = lonSpan / 2;
  const bbox = [
    item.lon - lonSpan,
    item.lat - latSpan,
    item.lon + lonSpan,
    item.lat + latSpan,
  ]
    .map(coord)
    .join(",");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coord(item.lat)},${coord(item.lon)}`;
}

function distanceLabel(km: number, lang: Lang): string {
  if (km < 1) {
    const meters = Math.max(10, Math.round((km * 1000) / 10) * 10);

    return lang === "fa"
      ? `${meters.toLocaleString("fa-IR")} متر`
      : `${meters} m`;
  }

  return lang === "fa"
    ? `${km.toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر`
    : `${km.toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
}

const PILL_CLASS =
  "rounded-full border border-[rgba(57,255,136,0.35)] px-3 py-1 text-xs text-primary transition-colors hover:bg-[rgba(57,255,136,0.08)]";

function tileFraction(
  lat: number,
  lon: number,
  zoom: number,
): { readonly x: number; readonly y: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;

  return {
    x: ((lon + 180) / 360) * n,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n,
  };
}

function MapPreview({
  item,
  label,
}: {
  readonly item: PlaceItem;
  readonly label: string;
}) {
  const n = 2 ** PREVIEW_ZOOM;
  const { x, y } = tileFraction(item.lat, item.lon, PREVIEW_ZOOM);

  const tiles: Array<{
    readonly key: string;
    readonly src: string;
    readonly left: string;
    readonly top: string;
  }> = [];

  for (let tx = Math.floor(x - 0.9); tx <= Math.floor(x + 0.9); tx += 1) {
    for (let ty = Math.floor(y - 0.4); ty <= Math.floor(y + 0.4); ty += 1) {
      if (ty < 0 || ty >= n) {
        continue;
      }

      const wrapped = ((tx % n) + n) % n;

      tiles.push({
        key: `${tx}/${ty}`,
        src: `https://tile.openstreetmap.org/${PREVIEW_ZOOM}/${wrapped}/${ty}.png`,
        left: `calc(50% + ${Math.round((tx - x) * TILE_SIZE)}px)`,
        top: `calc(50% + ${Math.round((ty - y) * TILE_SIZE)}px)`,
      });
    }
  }

  return (
    <div
      dir="ltr"
      className="relative w-full overflow-hidden bg-[#0b120d]"
      style={{ height: PREVIEW_HEIGHT }}
    >
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          width={TILE_SIZE}
          height={TILE_SIZE}
          loading="lazy"
          draggable={false}
          referrerPolicy="origin"
          className="absolute max-w-none select-none"
          style={{
            left: tile.left,
            top: tile.top,
            width: TILE_SIZE,
            height: TILE_SIZE,
          }}
        />
      ))}

      <svg
        width="30"
        height="38"
        viewBox="0 0 30 38"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -100%)",
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))",
        }}
      >
        <path
          d="M15 37C15 37 2 23.5 2 14.5a13 13 0 0 1 26 0C28 23.5 15 37 15 37Z"
          fill="#39ff88"
          stroke="#0b2415"
          strokeWidth="2"
        />
        <circle cx="15" cy="14.5" r="5" fill="#0b2415" />
      </svg>

      <span className="absolute left-2 top-2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-primary">
        {label}
      </span>

      <span className="absolute bottom-1 right-1 rounded bg-white/80 px-1 text-[9px] text-black/70">
        © OpenStreetMap
      </span>
    </div>
  );
}

function MapViewer({
  item,
  lang,
  onClose,
}: {
  readonly item: PlaceItem;
  readonly lang: Lang;
  readonly onClose: () => void;
}) {
  const rtl = lang === "fa";

  useEffect(() => {
    const onKey = (event: { readonly key: string }): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      dir={rtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-[100] flex flex-col bg-[#060907]"
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ touchAction: "none" }}
      >
        <div className="min-w-0">
          <div dir="auto" className="truncate text-sm font-semibold text-text">
            {item.name}
          </div>
          {item.address && (
            <div dir="auto" className="truncate text-xs text-text-subtle">
              {item.address}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={rtl ? "بستن نقشه" : "Close map"}
          className="md-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none text-primary"
        >
          ×
        </button>
      </div>

      <iframe
        src={embedSrc(item, 0.012)}
        title={item.name}
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0"
      />

      <div className="flex flex-wrap gap-2 px-4 py-3">
        <a href={geoHref(item)} className={PILL_CLASS}>
          {rtl ? "باز کردن در برنامه‌ی نقشه" : "Open in Maps app"}
        </a>
        <DirectionsButton
          target={{ lat: item.lat, lon: item.lon, name: item.name }}
          rtl={rtl}
          className={PILL_CLASS}
        />
        <a
          href={osmHref(item)}
          target="_blank"
          rel="noopener noreferrer"
          className={PILL_CLASS}
        >
          OpenStreetMap
        </a>
      </div>
    </div>,
    document.body,
  );
}

function PlacesCard({ card }: { readonly card: PlacesCardData }) {
  const [viewer, setViewer] = useState<PlaceItem | null>(null);
  const closeViewer = useCallback((): void => setViewer(null), []);
  const first = card.items[0];

  if (!first) {
    return null;
  }

  const rtl = card.lang === "fa";

  const handlePreviewKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setViewer(first);
    }
  };

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="md-glass my-3 w-full max-w-sm overflow-hidden rounded-2xl"
    >      <div
        role="button"
        tabIndex={0}
        aria-label={
          rtl ? `نمایش نقشه‌ی ${first.name}` : `Show map of ${first.name}`
        }
        onClick={() => setViewer(first)}
        onKeyDown={handlePreviewKey}
        className="block cursor-pointer"
      >
        <MapPreview item={first} label={rtl ? "بزرگ‌نمایی" : "Enlarge"} />
      </div>

      <ul className="divide-y divide-white/10">
        {card.items.map((item, index) => (
          <li key={`${item.lat}-${item.lon}-${index}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div dir="auto" className="text-sm font-semibold text-text">
                  {item.name}
                </div>
                {item.address && (
                  <div
                    dir="auto"
                    className="mt-0.5 text-xs leading-5 text-text-subtle"
                  >
                    {item.address}
                  </div>
                )}
              </div>
              {item.km !== undefined && (
                <span className="shrink-0 text-xs text-primary">
                  {distanceLabel(item.km, card.lang)}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setViewer(item)}
                className={PILL_CLASS}
              >
                {rtl ? "بزرگ‌نمایی" : "Enlarge"}
              </button>
              <a href={geoHref(item)} className={PILL_CLASS}>
                {rtl ? "باز کردن در نقشه" : "Open in Maps"}
              </a>
              <DirectionsButton
                target={{ lat: item.lat, lon: item.lon, name: item.name }}
                rtl={rtl}
                className={PILL_CLASS}
              />
            </div>
          </li>
        ))}
      </ul>

      {viewer && (
        <MapViewer item={viewer} lang={card.lang} onClose={closeViewer} />
      )}
    </div>
  );
}

function CardView({ card }: { readonly card: CardData }) {
  switch (card.t) {
    case "clock":
      return <ClockCard card={card} />;
    case "places":
      return <PlacesCard card={card} />;
    case "photos":
      return <PhotosCard card={card} />;
  }
}

interface LocationFix {
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function readPosition(
  timeoutMs: number,
  maximumAgeMs: number,
): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: round4(position.coords.latitude),
          lon: round4(position.coords.longitude),
          at: Date.now(),
        }),
      (failure) => reject(failure),
      {
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      },
    );
  });
}

// What the person wrote before: their last few messages (oldest first) and,
// last, the draft that is not sent yet. The server keeps the newest words and
// uses them to choose the right words, names and spelling. Only the person's
// own words are used, never the assistant's answers.
function buildVoiceContext(
  messages: readonly { readonly role: string; readonly content: string }[],
  draft: string,
): string {
  const recent: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message || message.role !== "user") {
      continue;
    }

    const text = message.content.replace(/\s+/g, " ").trim();

    if (text) {
      recent.unshift(text.slice(-VOICE_CONTEXT_MESSAGE_CHARS));
    }

    if (recent.length >= VOICE_CONTEXT_MESSAGES) {
      break;
    }
  }

  const current = draft.replace(/\s+/g, " ").trim();

  return [...recent, ...(current ? [current] : [])].join(" ");
}

export default function ChatScreen() {
  const {
    messages,
    isSending,
    isStreaming,
    error,
    canRetry,
    sendMessage,
    retry,
    reset,
  } = useChat();

  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [photos, setPhotos] = useState<readonly AttachedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<AttachErrorCode | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The voice input asks for these when a recording is sent, so it always
  // sees the newest draft and messages.
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);

  useEffect(() => {
    draftRef.current = draft;
    messagesRef.current = messages;
  });

  // The recognized words are added to the end of what is already typed; the
  // user reads them and presses send.
  const voice = useVoiceInput({
    language: VOICE_LANGUAGE,
    onText: (text: string): void => {
      setDraft((previous) =>
        previous.trim() ? `${previous.trimEnd()} ${text}` : text,
      );
    },
    getContext: (): string =>
      buildVoiceContext(messagesRef.current, draftRef.current),
  });
  const cancelVoice = voice.cancel;
  const clearVoiceError = voice.clearError;
  const voiceBusy = voice.state !== "idle";

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  // The open sheet owns one browser-history entry, so the phone's back button
  // closes the sheet instead of leaving the chat.
  const sheetEntryRef = useRef(false);
  const skipPopRef = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const chatHistoryPushedRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const touchingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastResizeAtRef = useRef(0);
  const shiftHeldRef = useRef(false);
  const locationRef = useRef<LocationFix | null>(null);

  const hasMessages = messages.length > 0;
  const canSend =
    (draft.trim().length > 0 || photos.length > 0) &&
    !isSending &&
    !isPreparing &&
    !voiceBusy;
  const showThinking = isSending && !isStreaming;

  const activeAction =
    QUICK_ACTIONS.find((action) => action.id === activeId) ?? null;

  const scrollToBottom = useCallback((): void => {
    const element = mainRef.current;

    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
    lastScrollTopRef.current = element.scrollTop;
  }, []);

  const refreshLocation = useCallback(async (): Promise<void> => {
    try {
      locationRef.current = await readPosition(8000, 60_000);
    } catch {
      // Keep the previous fix.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.touchAction;

    root.style.touchAction = NO_PAGE_ZOOM;

    return () => {
      root.style.touchAction = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        return;
      }

      let permission: PermissionState | "unknown" = "unknown";

      try {
        const status = await navigator.permissions.query({
          name: "geolocation",
        });

        permission = status.state;

        status.onchange = () => {
          if (status.state === "denied") {
            locationRef.current = null;
          } else if (status.state === "granted") {
            void refreshLocation();
          }
        };
      } catch {
        permission = "unknown";
      }

      if (cancelled || permission === "denied") {
        return;
      }

      try {
        const fix = await readPosition(12_000, 60_000);

        if (!cancelled) {
          locationRef.current = fix;
        }
      } catch {
        if (!cancelled) {
          locationRef.current = null;
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [refreshLocation]);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const update = () => {
      lastResizeAtRef.current = Date.now();
      setViewportHeight(Math.round(viewport.height * viewport.scale));

      if (viewport.scale <= 1.01) {
        window.scrollTo(0, 0);
      }
    };

    update();

    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    if (hasMessages) {
      return;
    }

    const element = mainRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [viewportHeight, hasMessages]);

  useEffect(() => {
    if (hasMessages && !chatHistoryPushedRef.current) {
      window.history.pushState({ mdChat: true }, "");
      chatHistoryPushedRef.current = true;
    }

    if (!hasMessages) {
      chatHistoryPushedRef.current = false;
      stickToBottomRef.current = true;
      touchingRef.current = false;
      lastScrollTopRef.current = 0;
      setShowJump(false);
    }
  }, [hasMessages]);

  useEffect(() => {
    const handlePopState = () => {
      // The sheet closing itself moved the history back: nothing else to do.
      if (skipPopRef.current) {
        skipPopRef.current = false;
        return;
      }

      // The back button while the sheet is open only closes the sheet.
      if (sheetEntryRef.current) {
        sheetEntryRef.current = false;
        setSheetOpen(false);
        return;
      }

      if (!chatHistoryPushedRef.current) {
        return;
      }

      chatHistoryPushedRef.current = false;
      cancelVoice();
      reset();
      setDraft("");
      setPhotos([]);
      setPhotoError(null);
      setActiveId(null);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [reset, cancelVoice]);

  // A voice error disappears by itself after a few seconds, except while the
  // recording is kept for a retry: then the message and its "try again" button
  // stay until the person uses them, cancels or starts a new recording.
  useEffect(() => {
    if (!voice.error || voice.canRetry) {
      return;
    }

    const timer = window.setTimeout(clearVoiceError, VOICE_ERROR_VISIBLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [voice.error, voice.canRetry, clearVoiceError]);

  useEffect(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft, activeId]);

  useEffect(() => {
    if (!hasMessages || !stickToBottomRef.current) {
      return;
    }

    if (!touchingRef.current) {
      scrollToBottom();
    }

    const frame = requestAnimationFrame(() => {
      if (stickToBottomRef.current && !touchingRef.current) {
        scrollToBottom();
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    messages,
    showThinking,
    error,
    hasMessages,
    viewportHeight,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!hasMessages || typeof ResizeObserver === "undefined") {
      return;
    }

    const main = mainRef.current;
    const list = listRef.current;

    if (!main || !list) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === main) {
          lastResizeAtRef.current = Date.now();
        }
      }

      if (stickToBottomRef.current && !touchingRef.current) {
        scrollToBottom();
      }
    });

    observer.observe(main);
    observer.observe(list);

    return () => {
      observer.disconnect();
    };
  }, [hasMessages, scrollToBottom]);

  const handleScroll = () => {
    const element = mainRef.current;

    if (!element || !hasMessages) {
      return;
    }

    const previousTop = lastScrollTopRef.current;
    const currentTop = element.scrollTop;

    lastScrollTopRef.current = currentTop;

    const scrolledUp = currentTop < previousTop - 1;

    if (touchingRef.current) {
      if (scrolledUp) {
        stickToBottomRef.current = false;
        setShowJump(true);
      }

      return;
    }

    const distance =
      element.scrollHeight - currentTop - element.clientHeight;

    if (distance < STICK_THRESHOLD_PX) {
      stickToBottomRef.current = true;
      setShowJump(false);
      return;
    }

    const resizedRecently =
      Date.now() - lastResizeAtRef.current < RESIZE_GRACE_MS;

    if (scrolledUp && !resizedRecently) {
      stickToBottomRef.current = false;
      setShowJump(true);
      return;
    }

    if (stickToBottomRef.current) {
      scrollToBottom();
    } else {
      setShowJump(true);
    }
  };

  const handleTouchStart = () => {
    touchingRef.current = true;
  };

  const handleTouchEnd = () => {
    touchingRef.current = false;

    const element = mainRef.current;

    if (!element) {
      return;
    }

    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (distance < STICK_THRESHOLD_PX) {
      stickToBottomRef.current = true;
      setShowJump(false);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    if (event.deltaY < 0 && hasMessages) {
      stickToBottomRef.current = false;
      setShowJump(true);
    }
  };

  const handleJumpToBottom = () => {
    stickToBottomRef.current = true;
    setShowJump(false);
    scrollToBottom();
  };

  const submit = async (raw: string) => {
    const text = raw.trim();

    if (
      (!text && photos.length === 0) ||
      isSending ||
      isPreparing ||
      voiceBusy
    ) {
      return;
    }

    const fix = locationRef.current;

    if (fix && Date.now() - fix.at > LOCATION_REFRESH_MS) {
      void refreshLocation();
    }

    const attached = photos;

    stickToBottomRef.current = true;
    setShowJump(false);
    setDraft("");
    setPhotos([]);
    setPhotoError(null);
    setActiveId(null);

    await sendMessage(text, {
      photos: attached,
      ...(fix ? { location: { lat: fix.lat, lon: fix.lon } } : {}),
    });
  };

  const openSheet = () => {
    if (isSending || isPreparing || voiceBusy || photos.length >= MAX_PHOTOS) {
      return;
    }

    if (!sheetEntryRef.current) {
      window.history.pushState({ mdSheet: true }, "");
      sheetEntryRef.current = true;
    }

    setSheetOpen(true);
  };

  const closeSheet = useCallback((): void => {
    setSheetOpen(false);

    if (sheetEntryRef.current) {
      sheetEntryRef.current = false;
      skipPopRef.current = true;
      window.history.back();
    }
  }, []);

  const handleChoosePhotos = () => {
    closeSheet();
    fileInputRef.current?.click();
  };

  const handleTakePhoto = () => {
    closeSheet();
    cameraInputRef.current?.click();
  };

  const handleFilesChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    // Lets the same photo be chosen again later.
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    setIsPreparing(true);
    setPhotoError(null);

    try {
      const result = await addImages(photos, files);

      setPhotos(result.photos);
      setPhotoError(result.error);
    } finally {
      setIsPreparing(false);
    }
  };

  const handleRemovePhoto = (id: string) => {
    setPhotos((previous) => previous.filter((photo) => photo.id !== id));
    setPhotoError(null);
  };

  const handleSend = async () => {
    await submit(draft);
  };

  // One tap starts the recording, the next tap stops it and sends the sound
  // to be turned into text.
  const handleMic = () => {
    if (voice.state === "recording") {
      voice.stop();
      return;
    }

    if (voice.state === "idle") {
      void voice.start();
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as InputEvent;

    if (native.inputType === "insertLineBreak" && !shiftHeldRef.current) {
      const { value, selectionStart } = event.target;
      const cut = selectionStart - 1;
      const cleaned =
        cut >= 0 && value[cut] === "\n"
          ? value.slice(0, cut) + value.slice(cut + 1)
          : value;

      void submit(cleaned);
      return;
    }

    setDraft(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    shiftHeldRef.current = event.shiftKey;

    const isEnter = event.key === "Enter" || event.keyCode === 13;

    if (isEnter && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    shiftHeldRef.current = event.shiftKey;
  };

  const handleQuickAction = (action: QuickAction) => {
    if (!action.enabled) {
      return;
    }

    setActiveId(action.id === "ask" ? null : action.id);
    inputRef.current?.focus();
  };

  const handleBack = () => {
    if (chatHistoryPushedRef.current) {
      window.history.back();
      return;
    }

    cancelVoice();
    reset();
    setDraft("");
    setPhotos([]);
    setPhotoError(null);
    setActiveId(null);
  };

  const handleSignOut = () => {
    cancelVoice();
    void supabase.auth.signOut();
  };

  const micClass =
    voice.state === "recording"
      ? `${ROUND_BUTTON_CLASS} border-red-400/60 bg-red-400/15 text-red-300`
      : `${ROUND_BUTTON_CLASS} text-primary hover:border-[rgba(57,255,136,0.4)]`;

  const micLabel =
    voice.state === "recording"
      ? VOICE_LABELS.micStop
      : voice.state === "transcribing"
        ? VOICE_LABELS.micBusy
        : VOICE_LABELS.micIdle;

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: viewportHeight !== null ? `${viewportHeight}px` : "100dvh",
        touchAction: NO_PAGE_ZOOM,
      }}
    >
      <style>{SEARCH_GLOW_CSS}</style>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(57,255,136,0.10),transparent_60%)]" />

      <header
        className="z-10 flex items-center justify-between px-3 py-1"
        dir="ltr"
      >
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="خروج از حساب"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-primary"
        >
          <SignOutIcon />
        </button>

        {hasMessages ? (
          <button
            type="button"
            onClick={handleBack}
            aria-label="بازگشت به صفحه اصلی"
            className="md-glass flex h-10 items-center gap-2 rounded-full px-4 text-sm text-primary transition-colors hover:border-[rgba(57,255,136,0.4)]"
          >
            <span>بازگشت</span>
            <BackIcon />
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </header>

      <main
        ref={mainRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onWheel={handleWheel}
        style={{ touchAction: NO_PAGE_ZOOM }}
        className="z-10 flex-1 overflow-y-auto px-4"
      >
        {hasMessages ? (
          <ul
            ref={listRef}
            dir="ltr"
            className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-4"
          >
            {messages.map((message) =>
              message.role === "user" ? (
                <li key={message.id} className="flex justify-end">
                  <div
                    dir="auto"
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border border-[rgba(57,255,136,0.35)] bg-[rgba(57,255,136,0.08)] px-4 py-2.5 text-[15px] leading-7 text-text"
                  >
                    {message.thumbs && message.thumbs.length > 0 && (
                      <div className={message.content ? "mb-2" : ""}>
                        <MessageThumbs thumbs={message.thumbs} />
                      </div>
                    )}
                    {message.content}
                  </div>
                </li>
              ) : (
                <li key={message.id} className="w-full">
                  <div className="md-prose w-full px-1 text-[15px] text-text">
                    {splitAssistantContent(message.content).map(
                      (part, index) =>
                        part.kind === "card" ? (
                          <CardView key={`card-${index}`} card={part.card} />
                        ) : (
                          <MarkdownText key={`text-${index}`} text={part.text} />
                        ),
                    )}
                  </div>
                </li>
              ),
            )}

            {showThinking && (
              <li className="flex w-full justify-start" dir="rtl" aria-live="polite">
                <div className="flex items-center gap-1.5 px-1 py-2" dir="ltr">
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "180ms" }}
                  />
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "360ms" }}
                  />
                </div>
              </li>
            )}
          </ul>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-between gap-3 pb-2 text-center">
            <div className="-mt-4 flex flex-col items-center gap-3">
              <div
                style={{
                  WebkitMaskImage: DIAMOND_FADE_MASK,
                  maskImage: DIAMOND_FADE_MASK,
                }}
              >
                <DiamondMark size={92} />
              </div>

              <div>
                <h1 className="text-2xl font-bold leading-tight">
                  Hello, I'm <span className="text-primary">Mass Diamond</span>
                </h1>
                <p className="mt-1.5 text-sm text-text-subtle">
                  Your Intelligent Assistant for a Bigger Tomorrow
                </p>
                <p
                  dir="rtl"
                  className="mx-auto mt-2 max-w-xs text-xs leading-5 text-text-subtle"
                >
                  سؤال بپرس، یاد بگیر، محصول و ملک پیدا کن. پیامت را در کادر
                  پایین بنویس.
                </p>
              </div>
            </div>

            <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  disabled={!action.enabled}
                  className={`md-glass flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[13px] text-text transition-colors duration-180 hover:border-[rgba(57,255,136,0.4)] disabled:cursor-not-allowed ${
                    action.highlight
                      ? "md-search-highlight disabled:opacity-90"
                      : "disabled:opacity-40"
                  }`}
                >
                  <span className="shrink-0 text-primary">{action.icon}</span>
                  <span className="truncate">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 px-4 pb-4 pt-2">
        {showJump && hasMessages && (
          <button
            type="button"
            onClick={handleJumpToBottom}
            aria-label="رفتن به آخرین پیام"
            className="md-glass absolute -top-12 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-primary transition-colors hover:border-[rgba(57,255,136,0.4)]"
          >
            <DownIcon />
          </button>
        )}

        {error && (
          <div
            role="alert"
            dir="rtl"
            className="mx-auto mb-2 flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-300"
          >
            <span>
              {ERROR_MESSAGES[error.code]}
              {error.code === "AI_PROVIDER_ERROR" && error.detail && (
                <span
                  dir="ltr"
                  className="mt-1 block break-words text-[11px] leading-4 text-red-300/70"
                >
                  {error.detail.slice(0, 220)}
                </span>
              )}
            </span>

            {canRetry && (
              <button
                type="button"
                onClick={() => void retry()}
                disabled={isSending}
                className="shrink-0 rounded-lg border border-red-300/30 px-3 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-300/10 disabled:opacity-50"
              >
                تلاش دوباره
              </button>
            )}
          </div>
        )}

        <div
          className="md-glass mx-auto w-full max-w-xl rounded-3xl px-3 py-2"
          dir="rtl"
        >
          {activeAction && (
            <div className="flex items-center pb-1">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(57,255,136,0.35)] bg-[rgba(57,255,136,0.08)] px-3 py-1 text-xs text-primary">
                <span className="shrink-0">{activeAction.icon}</span>
                <span>{activeAction.label}</span>
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  aria-label="لغو انتخاب"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-base leading-none text-text-subtle transition-colors hover:text-primary"
                >
                  ×
                </button>
              </span>
            </div>
          )}

          <PhotoStrip
            photos={photos}
            onRemove={handleRemovePhoto}
            disabled={isPreparing}
          />

          {(isPreparing || photoError) && (
            <p role="status" className="pb-1 text-xs text-text-subtle">
              {isPreparing
                ? "در حال آماده‌سازی عکس…"
                : photoError
                  ? PHOTO_ERROR_MESSAGES[photoError]
                  : ""}
            </p>
          )}

          <VoiceStatusBar
            state={voice.state}
            seconds={voice.seconds}
            error={voice.error}
            canRetry={voice.canRetry}
            onCancel={cancelVoice}
            onRetry={voice.retry}
          />

          <textarea
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            rows={1}
            dir="auto"
            enterKeyHint="send"
            placeholder={activeAction?.hint ?? DEFAULT_PLACEHOLDER}
            style={{ outline: "none", boxShadow: "none" }}
            className="block max-h-40 w-full resize-none bg-transparent px-1 py-2 text-sm leading-6 text-text placeholder:text-text-subtle"
          />

          <div className="flex items-center justify-between pt-1" dir="ltr">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                void handleFilesChosen(event)
              }
            />

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                void handleFilesChosen(event)
              }
            />

            <button
              type="button"
              onClick={openSheet}
              disabled={
                isSending ||
                isPreparing ||
                voiceBusy ||
                photos.length >= MAX_PHOTOS
              }
              aria-label="پیوست عکس"
              className={`${ROUND_BUTTON_CLASS} text-primary hover:border-[rgba(57,255,136,0.4)]`}
            >
              <PlusIcon />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMic}
                disabled={
                  !voice.supported ||
                  isSending ||
                  isPreparing ||
                  voice.state === "transcribing"
                }
                aria-label={micLabel}
                aria-pressed={voice.state === "recording"}
                className={micClass}
              >
                {voice.state === "recording" ? <StopIcon /> : <MicIcon />}
              </button>

              {canSend ? (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  aria-label="ارسال"
                  className="flex h-10 w-[70px] shrink-0 items-center justify-center transition"
                >
                  <img
                    src={SEND_IMAGE_SRC}
                    alt=""
                    draggable={false}
                    className="h-full w-full select-none object-contain"
                  />
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-label="گفتگوی صوتی"
                  className={`${ROUND_BUTTON_CLASS} bg-primary text-black`}
                >
                  <WaveIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      <AttachSheet
        open={sheetOpen}
        onClose={closeSheet}
        onCamera={handleTakePhoto}
        onPhotos={handleChoosePhotos}
        remaining={MAX_PHOTOS - photos.length}
      />
    </div>
  );
}

function iconProps() {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "w-5 h-5",
  };
}

function PlusIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 10v4" />
      <path d="M8 6v12" />
      <path d="M12 3v18" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9 4H5v16h4" />
      <path d="m16 8 4 4-4 4" />
      <path d="M20 12H9" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="10.5" cy="10.5" r="7" />
      <ellipse cx="10.5" cy="10.5" rx="3" ry="7" />
      <path d="M3.5 10.5h14" />
      <path d="m20.5 20.5-5.1-5.1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function LearnIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 8 12 4l9 4-9 4-9-4Z" />
      <path d="M7 10.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}
