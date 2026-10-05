// supabase/functions/ai-chat/lib/time.ts
// Time zone, date formatting and Persian calendar helpers.

export function resolveTimeZone(candidate: string | undefined): string | null {
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

export function cityFromZone(zone: string): string {
  const last = zone.split("/").pop() ?? zone;

  return last.replace(/_/g, " ");
}

export function safeFormat(
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

export function persianDateText(now: Date, zone: string): string {
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

export function zoneOffsetMinutes(zone: string, date: Date): number {
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

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const rest = String(abs % 60).padStart(2, "0");

  return `${sign}${hours}:${rest}`;
}

export function dateKey(zone: string, date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
