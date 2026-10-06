// supabase/functions/ai-chat/request.ts
// Request body parsing, location tag extraction and user authentication.

import {
  createClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_MESSAGE_LENGTH } from "./config.ts";
import type { ChatRequestBody, GeoPoint } from "./types.ts";
import { isRecord, isValidGeo, round4 } from "./lib/util.ts";
import { getBearerToken } from "./lib/http.ts";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCATION_TAG_PATTERN =
  /\s*:::md-loc~(-?\d{1,3}(?:\.\d+)?)~(-?\d{1,3}(?:\.\d+)?):::\s*$/;

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

export function extractLocationTag(message: string): {
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

export function parseRequestBody(value: unknown): ChatRequestBody {
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

export function validateMessage(message: string | undefined): string {
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

export const AUTH_REQUIRED_MESSAGE = "Authentication is required.";
export const AUTH_INVALID_MESSAGE = "Authentication is invalid or expired.";

export async function authenticateUser(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<User> {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
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
    throw new Error(AUTH_INVALID_MESSAGE);
  }

  return data.user;
}
