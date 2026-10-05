// supabase/functions/ai-chat/lib/util.ts
// Small pure helpers shared by every module.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function pickString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];

  return typeof value === "string" ? value : "";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export function getOptionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();

  return value || undefined;
}

export function getRequiredEnv(name: string): string {
  const value = getOptionalEnv(name);

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function round5(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

export function isValidGeo(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

export function getTavilyKey(): string | undefined {
  return (
    getOptionalEnv("TAVILY_API_KEY") ??
    getOptionalEnv("TAVILY_KEY") ??
    getOptionalEnv("TAVILY_API")
  );
}
