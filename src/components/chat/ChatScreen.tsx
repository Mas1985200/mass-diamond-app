import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { supabase } from "../../lib/supabase";
import { useChat } from "../../hooks/useChat";
import type { ChatErrorCode } from "../../lib/chatClient";
import DiamondMark from "../DiamondMark";
import MarkdownText from "./MarkdownText";

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

const DEFAULT_PLACEHOLDER = "چطور می‌تونم کمکت کنم؟";
const STICK_THRESHOLD_PX = 80;
const RESIZE_GRACE_MS = 400;
const LOCATION_REFRESH_MS = 120_000;
const SEND_IMAGE_SRC = "/send-diamond-full.png";

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

interface SourceItem {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
}

interface SourcesCardData {
  readonly t: "sources";
  readonly lang: Lang;
  readonly items: readonly SourceItem[];
}

type CardData = ClockCardData | PlacesCardData | SourcesCardData;

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

function asSafeUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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

  if (value.t === "sources" && Array.isArray(value.items)) {
    const items: SourceItem[] = [];

    for (const raw of value.items.slice(0, 5)) {
      if (!isRecord(raw)) {
        continue;
      }

      const title = asText(raw.title, 140);
      const url = asSafeUrl(raw.url);
      const domain = asText(raw.domain, 80) ?? "";

      if (!title || !url) {
        continue;
      }

      items.push({ title, url, domain });
    }

    return items.length > 0
      ? { t: "sources", lang: asLang(value.lang), items }
      : null;
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

function persianDateText(date: Date, zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).formatToParts(date);

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

type DayRelation = "same" | "tomorrow" | "yesterday";

function buildRelation(diff: number, day: DayRelation, lang: Lang): string {
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const number = (value: number): string =>
    value.toLocaleString(lang === "fa" ? "fa-IR" : "en-US");

  const dayWord =
    day === "same"
      ? lang === "fa"
        ? "امروز"
        : "Today"
      : day === "tomorrow"
        ? lang === "fa"
          ? "فردا"
          : "Tomorrow"
        : lang === "fa"
          ? "دیروز"
          : "Yesterday";

  if (diff === 0) {
    return lang === "fa"
      ? `${dayWord} · هم‌ساعت با شما`
      : `${dayWord} · Same time as you`;
  }

  if (lang === "fa") {
    const pieces: string[] = [];

    if (hours > 0) {
      pieces.push(`${number(hours)} ساعت`);
    }

    if (minutes > 0) {
      pieces.push(`${number(minutes)} دقیقه`);
    }

    return `${dayWord} · ${pieces.join(" و ")} ${
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

  return `${dayWord} · ${pieces.join(" ")} ${
    diff > 0 ? "ahead of you" : "behind you"
  }`;
}

interface ClockInfo {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly digital: string;
  readonly primaryDate: string;
  readonly secondaryDate: string;
  readonly title: string;
  readonly zoneLine: string;
  readonly relation: string | null;
}

function describeClock(card: ClockCardData): ClockInfo | null {
  try {
    const date = new Date(card.iso);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const zone = safeZone(card.zone);
    const refZone = safeZone(card.ref ?? browserZone());

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    const hours = read("hour");
    const minutes = read("minute");
    const seconds = read("second");
    const pad = (value: number): string => String(value).padStart(2, "0");

    const primaryDate =
      card.lang === "fa"
        ? persianDateText(date, zone)
        : new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }).format(date);

    const secondaryDate =
      card.lang === "fa"
        ? new Intl.DateTimeFormat("fa-IR-u-ca-gregory", {
            timeZone: zone,
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(date)
        : "";

    const offset = zoneOffsetMinutes(zone, date);
    const diff = offset - zoneOffsetMinutes(refZone, date);
    const zoneKey = dateKey(zone, date);
    const refKey = dateKey(refZone, date);

    const day: DayRelation =
      zoneKey === refKey ? "same" : zoneKey > refKey ? "tomorrow" : "yesterday";

    const showRelation = diff !== 0 || Boolean(card.label);

    return {
      hours,
      minutes,
      seconds,
      digital: `${pad(hours)}:${pad(minutes)}`,
      primaryDate,
      secondaryDate,
      title: card.label ?? "",
      zoneLine: `${zone} · UTC${formatOffset(offset)}`,
      relation: showRelation ? buildRelation(diff, day, card.lang) : null,
    };
  } catch {
    return null;
  }
}

function ClockFace({
  hours,
  minutes,
  seconds,
}: {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}) {
  const hourAngle = ((hours % 12) + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;
  const ticks = Array.from({ length: 12 }, (_, index) => index);
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="h-28 w-28 shrink-0 text-primary"
      style={{ filter: "drop-shadow(0 0 6px rgba(57,255,136,0.35))" }}
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
          y1="7"
          x2="50"
          y2={index % 3 === 0 ? 12 : 10}
          stroke="currentColor"
          strokeOpacity="0.85"
          strokeWidth={index % 3 === 0 ? 1.8 : 1}
          strokeLinecap="round"
          transform={`rotate(${index * 30} 50 50)`}
        />
      ))}

      {numbers.map((value) => {
        const angle = (value * 30 * Math.PI) / 180;
        const x = 50 + 31 * Math.sin(angle);
        const y = 50 - 31 * Math.cos(angle);

        return (
          <text
            key={value}
            x={x}
            y={y}
            fontSize="8"
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
        y2="33"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        transform={`rotate(${hourAngle} 50 50)`}
      />
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="24"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        transform={`rotate(${minuteAngle} 50 50)`}
      />
      <line
        x1="50"
        y1="56"
        x2="50"
        y2="20"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="0.9"
        strokeLinecap="round"
        transform={`rotate(${secondAngle} 50 50)`}
      />
      <circle cx="50" cy="50" r="2.4" fill="currentColor" />
    </svg>
  );
}

function ClockCard({ card }: { readonly card: ClockCardData }) {
  const info = describeClock(card);

  if (!info) {
    return null;
  }

  const rtl = card.lang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="md-glass my-3 flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        {info.title && (
          <div className="mb-1 truncate text-sm font-semibold text-text">
            {info.title}
          </div>
        )}
        <div
          dir="ltr"
          className="text-4xl font-bold leading-none tabular-nums text-primary"
          style={{ textAlign: rtl ? "right" : "left" }}
        >
          {info.digital}
        </div>
        <div className="mt-2 text-sm leading-6 text-text">
          {info.primaryDate}
        </div>
        {info.secondaryDate && (
          <div className="text-xs leading-5 text-text-subtle">
            {info.secondaryDate}
          </div>
        )}
        {info.relation && (
          <div className="mt-1 text-xs leading-5 text-text-subtle">
            {info.relation}
          </div>
        )}
        <div dir="ltr" className="mt-1 text-[11px] text-text-subtle">
          {info.zoneLine}
        </div>
      </div>

      <ClockFace
        hours={info.hours}
        minutes={info.minutes}
        seconds={info.seconds}
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

function directionsHref(item: PlaceItem): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(item.lat)},${coord(item.lon)}`;
}

function embedSrc(item: PlaceItem): string {
  const lonSpan = 0.006;
  const latSpan = 0.003;
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

function PlacesCard({ card }: { readonly card: PlacesCardData }) {
  const first = card.items[0];

  if (!first) {
    return null;
  }

  const rtl = card.lang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="md-glass my-3 w-full max-w-sm overflow-hidden rounded-2xl"
    >
      <a
        href={osmHref(first)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={first.name}
        className="block bg-black/30"
      >
        <iframe
          src={embedSrc(first)}
          title={first.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          className="pointer-events-none block h-40 w-full border-0"
        />
      </a>

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
              <a href={geoHref(item)} className={PILL_CLASS}>
                {rtl ? "باز کردن در نقشه" : "Open in Maps"}
              </a>
              <a
                href={directionsHref(item)}
                target="_blank"
                rel="noopener noreferrer"
                className={PILL_CLASS}
              >
                {rtl ? "مسیریابی" : "Directions"}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourcesCard({ card }: { readonly card: SourcesCardData }) {
  const rtl = card.lang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="md-glass my-3 w-full max-w-sm rounded-2xl px-4 py-3"
    >
      <div className="mb-2 text-xs font-semibold text-text-subtle">
        {rtl ? "منابع" : "Sources"}
      </div>

      <ul className="flex flex-col gap-2.5">
        {card.items.map((item, index) => (
          <li key={`${item.url}-${index}`}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <div dir="auto" className="text-sm leading-6 text-primary">
                {item.title}
              </div>
              {item.domain && (
                <div dir="ltr" className="text-[11px] text-text-subtle">
                  {item.domain}
                </div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardView({ card }: { readonly card: CardData }) {
  switch (card.t) {
    case "clock":
      return <ClockCard card={card} />;
    case "places":
      return <PlacesCard card={card} />;
    case "sources":
      return <SourcesCard card={card} />;
  }
}

interface LocationFix {
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

type LocationState = "off" | "loading" | "on";

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

function describeLocationError(error: unknown): string {
  if (isRecord(error) && typeof error.code === "number") {
    if (error.code === 1) {
      return "اجازه‌ی دسترسی به موقعیت داده نشد.";
    }

    if (error.code === 3) {
      return "دریافت موقعیت طول کشید. دوباره تلاش کنید.";
    }

    return "موقعیت شما پیدا نشد.";
  }

  return "مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند.";
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
  const [locationState, setLocationState] = useState<LocationState>("off");
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const chatHistoryPushedRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastResizeAtRef = useRef(0);
  const shiftHeldRef = useRef(false);
  const locationRef = useRef<LocationFix | null>(null);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isSending;
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
    if (!locationNotice) {
      return;
    }

    const timer = window.setTimeout(() => setLocationNotice(null), 4500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [locationNotice]);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const update = () => {
      lastResizeAtRef.current = Date.now();
      setViewportHeight(viewport.height);
      window.scrollTo(0, 0);
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
      lastScrollTopRef.current = 0;
      setShowJump(false);
    }
  }, [hasMessages]);

  useEffect(() => {
    const handlePopState = () => {
      if (!chatHistoryPushedRef.current) {
        return;
      }

      chatHistoryPushedRef.current = false;
      reset();
      setDraft("");
      setActiveId(null);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [reset]);

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

    scrollToBottom();

    const frame = requestAnimationFrame(() => {
      if (stickToBottomRef.current) {
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

      if (stickToBottomRef.current) {
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

    const distance =
      element.scrollHeight - currentTop - element.clientHeight;

    if (distance < STICK_THRESHOLD_PX) {
      stickToBottomRef.current = true;
      setShowJump(false);
      return;
    }

    const scrolledUp = currentTop < previousTop - 1;
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

  const handleJumpToBottom = () => {
    stickToBottomRef.current = true;
    setShowJump(false);
    scrollToBottom();
  };

  const handleToggleLocation = async () => {
    if (locationState === "loading") {
      return;
    }

    if (locationState === "on") {
      locationRef.current = null;
      setLocationState("off");
      return;
    }

    setLocationState("loading");

    try {
      locationRef.current = await readPosition(12_000, 0);
      setLocationState("on");
    } catch (failure) {
      locationRef.current = null;
      setLocationState("off");
      setLocationNotice(describeLocationError(failure));
    }
  };

  const submit = async (raw: string) => {
    const text = raw.trim();

    if (!text || isSending) {
      return;
    }

    const fix = locationState === "on" ? locationRef.current : null;

    if (fix && Date.now() - fix.at > LOCATION_REFRESH_MS) {
      void refreshLocation();
    }

    stickToBottomRef.current = true;
    setShowJump(false);
    setDraft("");
    setActiveId(null);

    await sendMessage(
      text,
      fix ? { location: { lat: fix.lat, lon: fix.lon } } : undefined,
    );
  };

  const handleSend = async () => {
    await submit(draft);
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

    reset();
    setDraft("");
    setActiveId(null);
  };

  const handleSignOut = () => {
    void supabase.auth.signOut();
  };

  const locationButtonClass =
    locationState === "on"
      ? "border border-[rgba(57,255,136,0.55)] bg-[rgba(57,255,136,0.12)] text-primary"
      : locationState === "loading"
        ? "animate-pulse text-primary"
        : "text-text-subtle hover:text-primary";

  const locationLabel =
    locationState === "on"
      ? "قطع اشتراک موقعیت"
      : locationState === "loading"
        ? "در حال دریافت موقعیت"
        : "اشتراک موقعیت من";

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: viewportHeight !== null ? `${viewportHeight}px` : "100dvh",
      }}
    >
      <style>{SEARCH_GLOW_CSS}</style>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(57,255,136,0.10),transparent_60%)]" />

      <header
        className="z-10 flex items-center justify-between px-3 py-1"
        dir="ltr"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="خروج از حساب"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-primary"
          >
            <SignOutIcon />
          </button>

          <button
            type="button"
            onClick={() => void handleToggleLocation()}
            aria-label={locationLabel}
            aria-pressed={locationState === "on"}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${locationButtonClass}`}
          >
            <PinIcon />
          </button>
        </div>

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

        {locationNotice && (
          <div
            role="status"
            dir="rtl"
            className="mx-auto mb-2 w-full max-w-xl rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm leading-6 text-amber-200"
          >
            {locationNotice}
          </div>
        )}

        {error && (
          <div
            role="alert"
            dir="rtl"
            className="mx-auto mb-2 flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-300"
          >
            <span>{ERROR_MESSAGES[error.code]}</span>

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

          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled
              aria-label="پیوست فایل"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-text-subtle opacity-40"
            >
              <AttachIcon />
            </button>

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
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-text placeholder:text-text-subtle"
            />

            <button
              type="button"
              disabled
              aria-label="ورودی صوتی"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-text-subtle opacity-40"
            >
              <MicIcon />
            </button>

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              aria-label="ارسال"
              className="flex h-10 w-[70px] shrink-0 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <img
                src={SEND_IMAGE_SRC}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            </button>
          </div>
        </div>
      </footer>
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

function PinIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M17.5 8.5 9.6 16.4a3.2 3.2 0 0 1-4.5-4.5l8-8a2.2 2.2 0 0 1 3.1 3.1l-7.6 7.6a1.2 1.2 0 0 1-1.7-1.7l6.9-6.9" />
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
