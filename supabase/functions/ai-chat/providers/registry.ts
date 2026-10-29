// supabase/functions/ai-chat/providers/registry.ts
// The list of AI services the router may use, in the order it tries them.
// A service is listed only when its secrets are set, so adding a key is all it
// takes to switch a service on, and removing it switches the service off.
//
// Every service is ONE entry in DEFINITIONS: its name and a function that
// returns its endpoint, key and models (or null when it is not configured or
// cannot do the job). Adding a service means adding its name to ProviderName
// and one entry here; the router, the order setting and the tests need no change.

import { GROQ_ENDPOINT } from "../config.ts";
import { getOptionalEnv } from "../lib/util.ts";
import { groqApiKey, groqModels, groqVisionModels } from "./models.ts";

export type ProviderName = "groq" | "cloudflare";

export type Provider = {
  readonly name: ProviderName;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly models: readonly string[];
};

type ProviderSetup = Omit<Provider, "name">;

type ProviderDefinition = {
  readonly name: ProviderName;
  // null = this service is not available for this request.
  readonly setup: (withPhotos: boolean) => ProviderSetup | null;
};

const CLOUDFLARE_DEFAULT_MODELS: readonly string[] = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
];

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

// Photos go only to services whose photo-reading model is known (Groq).
const DEFINITIONS: readonly ProviderDefinition[] = [
  {
    name: "groq",
    setup: (withPhotos) => {
      const apiKey = groqApiKey();
      const models = withPhotos ? groqVisionModels() : groqModels();

      return apiKey && models.length > 0
        ? { endpoint: GROQ_ENDPOINT, apiKey, models }
        : null;
    },
  },
  {
    name: "cloudflare",
    setup: (withPhotos) => {
      const apiKey = getOptionalEnv("CF_AI_TOKEN");
      const account = getOptionalEnv("CF_ACCOUNT_ID")?.trim() ?? "";

      return !withPhotos && apiKey && ACCOUNT_ID.test(account)
        ? {
            endpoint: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
            apiKey,
            models: cloudflareModels(),
          }
        : null;
    },
  },
];

const DEFAULT_ORDER: readonly ProviderName[] = DEFINITIONS.map(
  (definition) => definition.name,
);

// The secret AI_PROVIDER_ORDER (for example "cloudflare,groq") sets the order;
// names it does not know are ignored, and a service it leaves out is not used.
export function providerOrder(): ProviderName[] {
  const raw = getOptionalEnv("AI_PROVIDER_ORDER");
  const order: ProviderName[] = [];

  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    const known = DEFAULT_ORDER.find((candidate) => candidate === name);

    if (known && !order.includes(known)) {
      order.push(known);
    }
  }

  return order.length > 0 ? order : [...DEFAULT_ORDER];
}

export function activeProviders(withPhotos: boolean): Provider[] {
  const providers: Provider[] = [];

  for (const name of providerOrder()) {
    const setup = DEFINITIONS.find((definition) => definition.name === name)?.setup(
      withPhotos,
    );

    if (setup) {
      providers.push({ name, ...setup });
    }
  }

  return providers;
}
