// supabase/functions/ai-chat/providers/models.ts
// Ordered list of Groq models to try, built from secrets plus defaults.

import { GROQ_DEFAULT_MODELS } from "../config.ts";
import { getOptionalEnv } from "../lib/util.ts";

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
