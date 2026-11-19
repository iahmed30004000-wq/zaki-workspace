import type { Config } from "tailwindcss";
import { COLOR_TOKENS } from "./src/lib/themes/palettes";

/**
 * Every colour is a theme token (src/lib/themes/palettes.ts -> src/app/themes.css), exposed as
 * `rgb(var(--x) / <alpha-value>)` so opacity modifiers work: `bg-ok/10`, `border-warn/40`,
 * `text-cat-3`. Write new code with these semantic names, never with a palette colour
 * (`text-red-500`): a token follows the theme, a palette colour does not.
 */
const themeColors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, `rgb(var(--${token}) / <alpha-value>)`]));

const config: Config = {
  // the dark themes also carry the `dark` class on <html>, so `dark:` keeps working
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: themeColors,
      fontFamily: {
        // the body face, loaded by the root layout through next/font (--font-plex)
        sans: ["var(--font-plex)", '"Segoe UI"', "Tahoma", "system-ui", "sans-serif"],
        // titles: Reem Kufi on night, day and epic, IBM Plex on neon-coast (h1-h3 use it by default)
        display: ["var(--font-display)"],
        // the wordmark «زاكي» (Lalezar, loaded by the root layout through next/font: --font-lalezar)
        brand: ["var(--font-lalezar)", "var(--font-display)"],
      },
      borderRadius: {
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        card: "var(--radius-card)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "0 2px 6px rgb(0 0 0 / 0.07)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        // the smart cards of «اليوم»: a card rises into place, and the progress ring fills (its arc has pathLength 100)
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "ring-fill": { from: { "stroke-dashoffset": "100" } },
        // «نتفرّج سوا»: a reaction rises over the video and fades
        "float-up": { "0%": { opacity: "0", transform: "translateY(0) scale(0.8)" }, "15%": { opacity: "1" }, "100%": { opacity: "0", transform: "translateY(-160px) scale(1.2)" } },
        // C2.8, the chat's motion (src/lib/chat/v2/phone/motion.ts): a phone screen slides in from the START edge — this app is right-to-left only (html dir=rtl), so
        // the start edge is the right one and the offset is +100%; `--zk-slide-from` is the hook a left-to-right page would set to -100% (nothing sets it today) —
        // a bubble that just arrived fades up, a reaction pops. Always used with `motion-reduce:animate-none`.
        "slide-in-start": { from: { transform: "translateX(var(--zk-slide-from, 100%))" }, to: { transform: "none" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        pop: { "0%": { transform: "scale(0.85)" }, "60%": { transform: "scale(1.08)" }, "100%": { transform: "scale(1)" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        rise: "rise 450ms ease-out both",
        "ring-fill": "ring-fill 900ms ease-out both",
        "float-up": "float-up 2.5s ease-out forwards",
        // no fill mode on these three: a finished animation must not keep a `transform` that would beat the swipe's own inline one
        "slide-in-start": "slide-in-start 200ms ease-out",
        "fade-up": "fade-up 120ms ease-out",
        pop: "pop 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
