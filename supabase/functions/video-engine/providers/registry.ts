// supabase/functions/video-engine/providers/registry.ts
// Chooses which engine(s) make a video. Pure code: the engines are given in,
// so it is tested without any network.
//
//  - "auto" (the default): every engine that is configured and can make the
//    request, in the order the list was given (best first). If one fails, the
//    queue moves on to the next one.
//  - a model the person picked: only that engine. It is never silently
//    replaced by another one, because the person chose it on purpose.
// It also describes the engines for the model chooser in the app.

import {
  supportsRequest,
  type ProviderCapabilities,
  type VideoProvider,
  type VideoRequest,
} from "./types.ts";

export const AUTO_MODEL = "auto";

type Env = Readonly<Record<string, string | undefined>>;

export type Selection =
  | { ok: true; providers: VideoProvider[] }
  | {
      ok: false;
      reason: "unknown_model" | "not_available" | "unsupported_request";
    };

// The engines that could make this request now, best first.
export function usableProviders(
  providers: readonly VideoProvider[],
  request: VideoRequest,
  env: Env,
): VideoProvider[] {
  return providers.filter(
    (provider) =>
      provider.isConfigured(env) &&
      supportsRequest(provider.capabilities, request),
  );
}

export function selectProviders(
  providers: readonly VideoProvider[],
  request: VideoRequest,
  env: Env,
  model: string | null | undefined,
): Selection {
  const wanted = model?.trim() || AUTO_MODEL;

  if (wanted === AUTO_MODEL) {
    const usable = usableProviders(providers, request, env);
    return usable.length > 0
      ? { ok: true, providers: usable }
      : { ok: false, reason: "not_available" };
  }

  const chosen = providers.find((p) => p.capabilities.id === wanted);
  if (!chosen) return { ok: false, reason: "unknown_model" };
  if (!chosen.isConfigured(env)) return { ok: false, reason: "not_available" };
  if (!supportsRequest(chosen.capabilities, request)) {
    return { ok: false, reason: "unsupported_request" };
  }
  return { ok: true, providers: [chosen] };
}

export interface ModelInfo extends ProviderCapabilities {
  // False when the engine is not connected (no key yet): shown greyed out.
  available: boolean;
}

// What the model chooser shows: "auto" is added by the app itself.
export function describeModels(
  providers: readonly VideoProvider[],
  env: Env,
): ModelInfo[] {
  return providers.map((provider) => ({
    ...provider.capabilities,
    available: provider.isConfigured(env),
  }));
}
