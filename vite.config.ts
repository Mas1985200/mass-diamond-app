import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// On the Cloudflare build the app talks to its own address, where a small
// worker (worker/index.js) passes calls on to Supabase. This keeps the app
// working when the direct Supabase address is blocked on the person's network.
const APP_ADDRESS = "https://mass-diamond-app.mas1985dimond.workers.dev";

if (process.env.WORKERS_CI || process.env.CF_PAGES) {
  process.env.VITE_SUPABASE_URL = `${APP_ADDRESS}/sb`;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
