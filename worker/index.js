// worker/index.js
// Same-address proxy for the database and AI functions: the app talks only to
// its own address, and this worker passes the call on to Supabase. Only the one
// fixed Supabase address is ever called, never an address taken from the request.

const PREFIX = "/sb";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + "/")) {
      return env.ASSETS.fetch(request);
    }

    const origin = String(env.SUPABASE_ORIGIN || "").replace(/\/+$/, "");

    if (!origin.startsWith("https://")) {
      return new Response(JSON.stringify({ error: "proxy_not_configured" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const target = origin + url.pathname.slice(PREFIX.length) + url.search;

    try {
      return await fetch(new Request(target, request));
    } catch {
      return new Response(JSON.stringify({ error: "upstream_unreachable" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
