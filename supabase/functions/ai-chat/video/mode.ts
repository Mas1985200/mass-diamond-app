// supabase/functions/ai-chat/video/mode.ts
// Small helpers for the video mode of the chat: reading the mode from the
// request, adding the video rule to the system prompt, and making the request
// key of a video depend on the chat turn it was asked in. No Deno-only code.

import { VIDEO_TOOL_RULE } from "./rules.ts";
import type { VideoPort } from "./port.ts";

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const MAX_MODEL_ID_CHARS = 64;

// Only the exact word "video" turns the mode on; anything else is ignored.
export function parseMode(value: unknown): "video" | undefined {
  return value === "video" ? "video" : undefined;
}

// The video model the person picked in the app's model chooser. Only a plain
// model id is accepted; "auto", nothing, or anything else means "no pick".
export function parseVideoModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.length > MAX_MODEL_ID_CHARS || !MODEL_ID_PATTERN.test(id)) {
    return undefined;
  }
  return id.toLowerCase() === "auto" ? undefined : id;
}

// A model the person picked on purpose always wins over what the chat model
// guessed, so the video is made by exactly the engine they chose. Without a
// pick the port is returned as it is.
export function pinModel(port: VideoPort, model: string | undefined): VideoPort {
  if (!model) return port;
  return {
    create: (args, options) => port.create({ ...args, model }, options),
  };
}

// The video rule is added at the end of the system prompt, as its own block.
export function withVideoRules(prompt: string): string {
  return `${prompt}\n\nVideo mode:\n${VIDEO_TOOL_RULE}`;
}

// The same chat turn sent again (a retry, a double tap) gives the same key and
// so the same video; the same words asked later in the chat give a new key,
// because the history is longer by then.
export function turnKeyOf(
  conversationId: string,
  historyLength: number,
  userText: string,
): string {
  return JSON.stringify([conversationId, historyLength, userText]);
}

export function scopeToTurn(port: VideoPort, turnKey: string): VideoPort {
  return {
    create: (args, options) =>
      port.create(args, {
        ...options,
        requestKey: `${turnKey}|${options.requestKey}`,
      }),
  };
}

// end of mode.ts
