// src/features/video/videoClient.ts
// The one place where the video card meets the app's sign-in: it gives the
// video calls (videoApi.ts) the signed-in person's access token and the
// project address. Kept tiny on purpose; the rules are in videoApi.ts.

import { supabase } from "../../lib/supabase";
import { createVideoApi, type VideoApi, type VideoAuth } from "./videoApi.ts";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

// null = nobody is signed in. A missing project address is a setup problem,
// not a sign-in problem, so it throws (the call is then "unreachable").
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
    throw new Error("The Supabase configuration is missing.");
  }

  const anonKey =
    pickString(internals.supabaseKey) ??
    pickString(env.VITE_SUPABASE_ANON_KEY);

  return { url, token, anonKey };
}

export const videoApi: VideoApi = createVideoApi({ getAuth });
