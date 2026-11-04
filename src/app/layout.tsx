import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans_Arabic, Lalezar } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { AppScaleLock } from "@/components/app-scale-lock";
import { DECOR_COOKIE, THEME_COOKIE, decorLevelOf, rootThemeAttributes, themeOf } from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";
import { DIGITS_COOKIE, digitsOf } from "@/lib/digits";

/** The body face of every theme. */
const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

/**
 * The title face of «ليل», «نهار» and «إسلامي ملحمي» (h1-h3 through --font-display, see palettes.ts).
 * Self-hosted (public/fonts, SIL OFL — reem-kufi-OFL.txt beside it). Preloaded (WP-UI2 item 6):
 * when somebody opens the app on an Islamic theme the titles are the first thing painted, and a
 * late display face swaps visibly; 24 KB preloaded is cheaper than the flash. No size-adjusted
 * fallback: while it loads, a title is drawn in Plex.
 */
const reem = localFont({
  src: "../../public/fonts/reem-kufi-var.woff2",
  weight: "400 700",
  display: "swap",
  preload: true,
  variable: "--font-reem",
  adjustFontFallback: false,
});

/**
 * The wordmark face of «نجمة وطريق»: «زاكي» in a heavy Arabic display face (SIL OFL). Like Plex it is
 * fetched once at BUILD time by next/font and served from this site: a visitor's browser never asks Google.
 * Not preloaded: only the wordmark wears it (`font-brand`).
 */
const lalezar = Lalezar({
  subsets: ["arabic"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-lalezar",
});

export const metadata: Metadata = {
  title: { default: "Zaki Workspace", template: "%s · Zaki Workspace" },
  description: "مساحة عمل فريقك: المهام والمشاريع والدردشة والملفات في مكان واحد.",
  appleWebApp: { capable: true, title: "زاكي", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false, date: false },
};

/** The theme and decoration level this browser chose (cookies; anything unknown is the default). */
function chosen() {
  const store = cookies();
  return {
    theme: themeOf(store.get(THEME_COOKIE)?.value),
    decor: decorLevelOf(store.get(DECOR_COOKIE)?.value),
    digits: digitsOf(store.get(DIGITS_COOKIE)?.value),
  };
}

/** The browser bar wears the chosen theme's page colour. */
export function generateViewport(): Viewport {
  // viewportFit "cover" lets env(safe-area-inset-*) work on iPhones with a notch or a home bar (the bottom bar and sheets use it)
  // interactiveWidget "resizes-content": when the keyboard opens, the page shrinks instead of the
  // bottom bar sliding under it, so the composer and the bottom bar stay reachable
  return { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: themeColorOf(chosen().theme) };
}

/**
 * The theme is painted on the SERVER: `data-theme` (and the `dark` class for a dark theme) on
 * <html> from the `zaki_theme` cookie, so the first frame is already right and no script is needed.
 * Dialogs and menus inherit it from <html>.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme, decor, digits } = chosen();
  const attrs = rootThemeAttributes(theme, decor);
  const className = [plex.variable, reem.variable, lalezar.variable, attrs.dark ? "dark" : ""].filter(Boolean).join(" ");
  return (
    <html lang="ar" dir="rtl" data-theme={attrs["data-theme"]} data-decor={attrs["data-decor"]} data-digits={digits} className={className} suppressHydrationWarning>
      <body>
        <AppScaleLock />
        <Providers theme={theme} decor={decor} digits={digits}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
