// supabase/functions/ai-chat/providers/registry.ts
// The list of AI services the router may use, in the order it tries them.
// A service is listed only when its secrets are set, so adding a key is all it
// takes to switch a service on, and removing it switches the service off.

import { GROQ_ENDPOINT } from "../config.ts";
import { getOptionalEnv } from "../lib/util.ts";
import { groqApiKey, groqModels, groqVisionModels } from "./models.ts";

export type Provider = {
  readonly name: "groq" | "cloudflare";
  readonly endpoint: string;
  readonly apiKey: string;
  readonly models: readonly string[];
};

const CLOUDFLARE_DEFAULT_MODELS: readonly string[] = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

const DEFAULT_ORDER: readonly Provider["name"][] = ["groq", "cloudflare"];

// A Cloudflare account id is 32 hexadecimal characters; anything else is a
// typo in the secret, and it is never put into a web address.
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export function cloudflareModels(): string[] {
  const ordered: string[] = [];

  for (const candidate of [
    getOptionalEnv("CF_AI_MODEL"),
    ...CLOUDFLARE_DEFAULT_MODELS,
  ]) {
    if (candidate && !ordered.includes(candidate)) {
      ordered.push(candidate);
    }
  }

  return ordered;
}

// The secret AI_PROVIDER_ORDER (for example "cloudflare,groq") sets the order;
// names it does not know are ignored, and a service it leaves out is not used.
export function providerOrder(): Provider["name"][] {
  const raw = getOptionalEnv("AI_PROVIDER_ORDER");
  const order: Provider["name"][] = [];

  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();

    if ((name === "groq" || name === "cloudflare") && !order.includes(name)) {
      order.push(name);
    }
  }

  return order.length > 0 ? order : [...DEFAULT_ORDER];
}

// Photos go only to services whose photo-reading model is known (Groq).
export function activeProviders(withPhotos: boolean): Provider[] {
  const providers: Provider[] = [];

  for (const name of providerOrder()) {
    if (name === "groq") {
      const apiKey = groqApiKey();
      const models = withPhotos ? groqVisionModels() : groqModels();

      if (apiKey && models.length > 0) {
        providers.push({ name, endpoint: GROQ_ENDPOINT, apiKey, models });
      }

      continue;
    }

    const apiKey = getOptionalEnv("CF_AI_TOKEN");
    const account = getOptionalEnv("CF_ACCOUNT_ID")?.trim() ?? "";

    if (!withPhotos && apiKey && ACCOUNT_ID.test(account)) {
      providers.push({
        name,
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
        apiKey,
        models: cloudflareModels(),
      });
    }
  }

  return providers;
}
