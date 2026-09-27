import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#060907",
        surface: "#0d1410",
        primary: {
          DEFAULT: "#39FF88",
          light: "#6dffab",
        },
        text: {
          DEFAULT: "#f2fff6",
          subtle: "#9db3a6",
        },
        danger: "#ff5c5c",
        warning: "#ffb03a",
        success: "#39FF88",
      },
      boxShadow: {
        "glow-lg": "0 0 40px rgba(57, 255, 136, 0.35)",
      },
      transitionTimingFunction: {
        "md-smooth": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        "180": "180ms",
        "240": "240ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
