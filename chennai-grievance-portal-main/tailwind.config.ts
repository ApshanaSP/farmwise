import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0B3D91",
          50: "#F0F4FC",
          100: "#DCE6F8",
          200: "#BACEF0",
          300: "#8DAEE4",
          400: "#5B86D4",
          500: "#2C5FBE",
          600: "#0B3D91",
          700: "#0A3175",
          800: "#082555",
          900: "#061A3B",
          950: "#040F24"
        },
        gold: {
          DEFAULT: "#C8891B",
          50: "#FDF8EC",
          100: "#FAEDCF",
          200: "#F4D89B",
          300: "#EBBE60",
          400: "#DEA334",
          500: "#C8891B",
          600: "#A66C13",
          700: "#7D4F10",
          800: "#5A3A0F"
        },
        ink: {
          DEFAULT: "#0C1B33",
          muted: "#4A5A75",
          subtle: "#7A879E",
          faint: "#A3AEC2"
        },
        canvas: {
          DEFAULT: "#F7F8FC",
          raised: "#FFFFFF",
          sunken: "#EEF1F8",
          border: "#E4E9F2"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Plus Jakarta Sans", "system-ui", "sans-serif"]
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }]
      },
      boxShadow: {
        xs: "0 1px 2px rgba(12, 27, 51, 0.05)",
        soft: "0 1px 2px rgba(12, 27, 51, 0.04), 0 4px 12px -2px rgba(12, 27, 51, 0.06)",
        card: "0 1px 3px rgba(12, 27, 51, 0.05), 0 12px 28px -12px rgba(12, 27, 51, 0.16)",
        lift: "0 12px 24px -10px rgba(12, 27, 51, 0.18), 0 28px 56px -20px rgba(12, 27, 51, 0.22)",
        glow: "0 0 0 4px rgba(11, 61, 145, 0.10)",
        "glow-gold": "0 0 0 4px rgba(200, 137, 27, 0.16)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.08)"
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
        "4xl": "2rem"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(-18px, -24px) scale(1.06)" }
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" }
        },
        "progress-grow": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        drift: "drift 14s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
        "progress-grow": "progress-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both"
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)"
      }
    }
  },
  plugins: []
};

export default config;
