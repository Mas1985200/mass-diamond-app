// supabase/functions/ai-chat/providers/models.ts
// Ordered list of Groq models to try, built from secrets plus defaults.

import { GROQ_DEFAULT_MODELS } from "../config.ts";
import { getOptionalEnv } from "../lib/util.ts";

// Models that can look at photos (Groq's vision models). Used only when the
// user attached a photo; the secret GROQ_VISION_MODEL can name another one.
const GROQ_DEFAULT_VISION_MODELS: readonly string[] = ["qwen/qwen3.8-27b"];

export function groqApiKey(): string | undefined {
  return getOptionalEnv("GROQ_API_KEY");
}

export function groqModels(): string[] {
  const ordered: string[] = [];

  for (const candidate of [
    getOptionalEnv("GROQ_MODEL_PREFERRED"),
    getOptionalEnv("GROQ_MODEL"),
    getOptionalEnv("GROQ_FALLBACK_MODEL"),
    ...GROQ_DEFAULT_MODELS,
  ]) {
    if (candidate && !ordered.includes(candidate)) {
      ordered.push(candidate);
    }
  }

  return ordered;
}

export function groqVisionModels(): string[] {
  const ordered: string[] = [];

  for (const candidate of [
    getOptionalEnv("GROQ_VISION_MODEL"),
    ...GROQ_DEFAULT_VISION_MODELS,
  ]) {
    if (candidate && !ordered.includes(candidate)) {
      ordered.push(candidate);
    }
  }

  return ordered;
}
