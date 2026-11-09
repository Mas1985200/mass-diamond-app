// src/features/video/videoClient.ts
// Connects videoApi.ts to the app's own Supabase sign-in: the project address,
// the key and the signed-in person's access token. Kept tiny on purpose (it
// needs the browser build, so it is not run in the tests); all the rules are
// in videoApi.ts and videoCard.ts.

import { supabase } from "../../lib/supabase";
import { createVideoApi, type VideoApi, type VideoAuth } from "./videoApi";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function getAuth(): Promise<VideoAuth | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return null;
  }

  const internals = supabase as unknown as Record<string, unknown>;
  const env = import.meta.env as unknown as Record<string, unknown>;

  const url =
    pickString(internals.supabaseUrl) ?? pickString(env.VITE_SUPABASE_URL);

  if (url === null) {
    return null;
  }

  return {
    url,
    token,
    anonKey:
      pickString(internals.supabaseKey) ??
      pickString(env.VITE_SUPABASE_ANON_KEY),
  };
}

export const videoApi: VideoApi = createVideoApi({ getAuth });
