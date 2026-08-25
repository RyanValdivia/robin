import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        bg: "hsl(var(--bg))",
        panel: "hsl(var(--panel))",
        panel2: "hsl(var(--panel2))",
        panel3: "hsl(var(--panel3))",
        muted: "hsl(var(--muted))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      fontFamily: {
        // Sin fetch de red: si el sistema tiene Inter la usa, si no cae en
        // la fuente nativa del SO (misma familia visual que usan Linear/Claude).
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI Variable"',
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
