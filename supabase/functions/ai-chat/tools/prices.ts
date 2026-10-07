// supabase/functions/ai-chat/tools/prices.ts
// get_market_prices tool: Iranian market prices (currencies, gold, coins) and a
// few global prices, read from a structured JSON feed instead of web snippets.
// Feed: Iran Market Data (https://iran-market.github.io), sourced from TGJU.
// NOTE: symbols named *_IRR in the feed are already in toman.

import { TOOL_TIMEOUT_MS } from "../config.ts";
import type { ToolContext, ToolOutcome } from "../types.ts";
import { describeError, isRecord } from "../lib/util.ts";
import { createAttempt } from "../lib/http.ts";

const FEED_URLS: readonly string[] = [
  "https://iran-market.github.io/data/latest-toman.json",
  "https://raw.githubusercontent.com/iran-market/iran-market.github.io/main/data/latest-toman.json",
];

const FEED_CACHE_TTL_MS = 300_000;
const FEED_STALE_GRACE_MS = 1_800_000;
const MAX_ITEMS_PER_CALL = 8;

type FeedEntry = {
  readonly symbol: string;
  readonly nameFa: string;
  readonly currency: string;
  readonly unit: string;
  readonly unitSize: number;
  readonly price: number;
  readonly prevClose: number | null;
  readonly changePct: number | null;
  readonly timestamp: string;
  readonly updatedTehran: string;
  readonly stale: boolean;
  readonly flags: readonly string[];
};

type Feed = {
  readonly at: number;
  readonly entries: ReadonlyMap<string, FeedEntry>;
  readonly publishedAt: string;
};

type PriceSpec = {
  readonly symbol: string;
  readonly label: string;
};

const SPEC_LIST: ReadonlyArray<readonly [string, PriceSpec]> = [
  ["usd", { symbol: "USD_IRR_FREE", label: "دلار آمریکا (بازار آزاد)" }],
  ["eur", { symbol: "EUR_IRR_FREE", label: "یورو (بازار آزاد)" }],
  ["gbp", { symbol: "GBP_IRR_FREE", label: "پوند انگلیس (بازار آزاد)" }],
  ["usdt", { symbol: "USDT_IRR", label: "تتر" }],
  ["usd_center", { symbol: "ICE_TRANSFER_USD_SELL", label: "دلار (مرکز مبادله، فروش)" }],
  ["eur_center", { symbol: "ICE_TRANSFER_EUR_SELL", label: "یورو (مرکز مبادله، فروش)" }],
  ["cny_center", { symbol: "ICE_TRANSFER_CNY_SELL", label: "یوان (مرکز مبادله، فروش)" }],
  ["gold18", { symbol: "GOLD_18K_IRR", label: "طلای ۱۸ عیار" }],
  ["gold24", { symbol: "GOLD_24K_IRR", label: "طلای ۲۴ عیار" }],
  ["mesghal", { symbol: "GOLD_MESGHAL_IRR", label: "مثقال طلا" }],
  ["coin_emami", { symbol: "COIN_EMAMI_IRR", label: "سکه امامی" }],
  ["coin_bahar", { symbol: "COIN_BAHAR_IRR", label: "سکه بهار آزادی" }],
  ["coin_half", { symbol: "COIN_HALF_IRR", label: "نیم‌سکه" }],
  ["coin_quarter", { symbol: "COIN_QUARTER_IRR", label: "ربع‌سکه" }],
  ["coin_gram", { symbol: "COIN_GRAMI_IRR", label: "سکه گرمی" }],
  ["silver_gram", { symbol: "SILVER_999_IRR", label: "نقره ۹۹۹ (هر گرم)" }],
  ["gold_ounce", { symbol: "XAU_USD", label: "انس طلا (دلار)" }],
  ["silver_ounce", { symbol: "SILVER", label: "انس نقره (دلار)" }],
  ["brent", { symbol: "BRENT_USD", label: "نفت برنت (دلار)" }],
  ["copper", { symbol: "BASE_GLOBAL_COPPER", label: "مس جهانی (دلار)" }],
  ["aluminium", { symbol: "ALUMINIUM", label: "آلومینیوم جهانی (دلار)" }],
  ["zinc", { symbol: "BASE_GLOBAL_ZINC", label: "روی جهانی (دلار)" }],
  ["nickel", { symbol: "BASE_GLOBAL_NICKEL", label: "نیکل جهانی (دلار)" }],
  ["lead", { symbol: "BASE_GLOBAL_LEAD", label: "سرب جهانی (دلار)" }],
  ["tin", { symbol: "BASE_GLOBAL_TIN", label: "قلع جهانی (دلار)" }],
  ["btc", { symbol: "BTC_USD", label: "بیت‌کوین (دلار)" }],
  ["eth", { symbol: "ETH_USD", label: "اتریوم (دلار)" }],
];

const SPECS: ReadonlyMap<string, PriceSpec> = new Map(SPEC_LIST);

let cachedFeed: Feed | null = null;

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseEntry(raw: unknown): FeedEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const symbol = toText(raw.symbol);
  const price = toNumber(raw.price);

  if (!symbol || price === null) {
    return null;
  }

  const unitSize = toNumber(raw.unit_size);
  const flags = Array.isArray(raw.quality)
    ? raw.quality.filter((flag): flag is string => typeof flag === "string")
    : [];

  return {
    symbol,
    nameFa: toText(raw.name_fa),
    currency: toText(raw.currency),
    unit: toText(raw.unit),
    unitSize: unitSize !== null && unitSize > 0 ? unitSize : 1,
    price,
    prevClose: toNumber(raw.prev_close),
    changePct: toNumber(raw.change_pct),
    timestamp: toText(raw.timestamp),
    updatedTehran: toText(raw.timestamp_tehran),
    stale: raw.stale === true,
    flags,
  };
}

function parseFeed(json: unknown): Feed | null {
  if (!isRecord(json) || !isRecord(json.data) || !isRecord(json.meta)) {
    return null;
  }

  // Safety check: refuse the feed if its unit ever changes from toman.
  if (json.meta.unit !== "toman") {
    return null;
  }

  const categories = json.data.categories;

  if (!isRecord(categories)) {
    return null;
  }

  const entries = new Map<string, FeedEntry>();

  for (const list of Object.values(categories)) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const raw of list) {
      const entry = parseEntry(raw);

      if (entry && !entries.has(entry.symbol)) {
        entries.set(entry.symbol, entry);
      }
    }
  }

  if (entries.size === 0) {
    return null;
  }

  return {
    at: Date.now(),
    entries,
    publishedAt: toText(json.meta.published_at),
  };
}

async function loadFeed(master: AbortSignal): Promise<Feed | null> {
  if (cachedFeed && Date.now() - cachedFeed.at < FEED_CACHE_TTL_MS) {
    return cachedFeed;
  }

  for (const url of FEED_URLS) {
    const timed = createAttempt(master, TOOL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: timed.signal,
      });

      if (!response.ok) {
        console.error(`prices feed failed with status ${response.status}.`);
        continue;
      }

      const json: unknown = await response.json();
      const parsed = parseFeed(json);

      if (parsed) {
        cachedFeed = parsed;

        return parsed;
      }

      console.error("prices feed has an unexpected shape or unit.");
    } catch (error) {
      console.error(`prices feed threw: ${describeError(error)}`);
    } finally {
      timed.clearConnectTimer();
    }
  }

  // Better a recent copy than nothing, but never one older than 30 minutes.
  if (cachedFeed && Date.now() - cachedFeed.at < FEED_STALE_GRACE_MS) {
    return cachedFeed;
  }

  return null;
}

function readItems(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const items: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }

    const item = entry.trim().toLowerCase();

    if (item && !items.includes(item)) {
      items.push(item);
    }

    if (items.length >= MAX_ITEMS_PER_CALL) {
      break;
    }
  }

  return items;
}

type Lookup = {
  readonly key: string;
  readonly label: string;
  readonly entry: FeedEntry | undefined;
};

function lookup(
  item: string,
  entries: ReadonlyMap<string, FeedEntry>,
): Lookup {
  const spec = SPECS.get(item);

  if (spec) {
    return { key: item, label: spec.label, entry: entries.get(spec.symbol) };
  }

  // Any other currency by its 3-letter ISO code, e.g. KWD, CNY, JPY, TRY.
  if (/^[a-z]{3}$/.test(item)) {
    const code = item.toUpperCase();
    const entry =
      entries.get(`${code}_IRR_FREE`) ?? entries.get(`PRICE_${code}`);
    const label =
      entry && entry.nameFa && entry.nameFa !== entry.symbol
        ? entry.nameFa
        : code;

    return { key: code, label, entry };
  }

  return { key: item, label: item, entry: undefined };
}

function ageInMinutes(timestamp: string, now: number): number | null {
  const parsed = Date.parse(timestamp);

  return Number.isNaN(parsed)
    ? null
    : Math.max(0, Math.round((now - parsed) / 60_000));
}

function toResult(
  found: Lookup,
  entry: FeedEntry,
  now: number,
): Record<string, unknown> {
  return {
    key: found.key,
    name: found.label,
    price: entry.price,
    currency: entry.currency === "IRT" ? "toman" : entry.currency,
    unit: entry.unit,
    unit_size: entry.unitSize,
    previous_close: entry.prevClose,
    change_percent: entry.changePct,
    updated_at_tehran: entry.updatedTehran,
    age_minutes: ageInMinutes(entry.timestamp, now),
    flags: entry.flags,
  };
}

export async function runMarketPrices(
  args: Record<string, unknown>,
  _ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const items = readItems(args.items);

  if (items.length === 0) {
    return { data: { error: "items is required." } };
  }

  const feed = await loadFeed(signal);

  if (!feed) {
    return {
      data: {
        error:
          "The price feed is unavailable right now. Use web_search with fresh=true instead.",
      },
    };
  }

  const now = Date.now();
  const prices: Record<string, unknown>[] = [];
  const unavailable: Record<string, unknown>[] = [];
  const notFound: string[] = [];

  for (const item of items) {
    const found = lookup(item, feed.entries);

    if (!found.entry) {
      notFound.push(item);
      continue;
    }

    if (found.entry.stale) {
      unavailable.push({
        key: found.key,
        reason: "stale",
        last_update: found.entry.updatedTehran,
      });
      continue;
    }

    prices.push(toResult(found, found.entry, now));
  }

  return {
    data: {
      source: "Iran Market Data (TGJU)",
      feed_published_at: feed.publishedAt,
      prices,
      unavailable,
      not_found: notFound,
    },
  };
}
