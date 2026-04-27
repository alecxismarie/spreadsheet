import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "#d8dee8",
        ink: "#142033",
        muted: "#667085",
        panel: "#ffffff",
        canvas: "#f5f7fb",
        accent: "#2563eb",
        success: "#15803d",
        warning: "#b45309",
        danger: "#b42318"
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(16, 24, 40, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
