import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{tsx,ts}", "./components/**/*.{tsx,ts}"],
  theme: {
    extend: {
      colors: {
        "bg-base":     "#0a0e14",
        "bg-surface":  "#0f1318",
        "bg-card":     "#141920",
        "bg-elevated": "#1a2130",
        "bg-input":    "#1e2738",
        "bg-hover":    "#232e3f",
        accent:        "#6c63ff",
        "accent-hover":"#7b74ff",
        bull:          "#26d07c",
        bear:          "#ff4d6a",
        neutral:       "#f0b429",
        info:          "#4da6ff",
        purple:        "#9d8fff",
        /* semantic aliases used in pages */
        profit:        "#26d07c",
        loss:          "#ff4d6a",
        warn:          "#f0b429",
        ai:            "#9d8fff",
      },
      fontFamily: {
        sans: ["Inter", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs:    ["11px", "16px"],
        sm:    ["12px", "18px"],
        base:  ["13px", "20px"],
        md:    ["14px", "22px"],
        lg:    ["16px", "24px"],
        xl:    ["20px", "28px"],
        "2xl": ["24px", "32px"],
        "3xl": ["32px", "40px"],
        hero:  ["48px", "56px"],
      },
      spacing: {
        sidebar: "130px",
        topbar:  "56px",
      },
      borderRadius: {
        sm:   "4px",
        md:   "8px",
        lg:   "12px",
        xl:   "16px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
export default config;
