// supabase/functions/ai-chat/tools/datetime.ts
// get_datetime tool: exact date/time for the user's place or another place.

import type { Lang, ToolContext, ToolOutcome } from "../types.ts";
import {
  cityFromZone,
  dateKey,
  formatOffset,
  persianDateText,
  resolveTimeZone,
  safeFormat,
  zoneOffsetMinutes,
} from "../lib/time.ts";

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

export function runGetDatetime(
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
