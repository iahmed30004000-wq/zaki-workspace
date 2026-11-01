import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings",
}));

import { FeatureSwitches } from "@/components/feature-switches";
import { ServerHealthCard } from "@/components/server-health-card";
import { ECONOMY_FORCED_OFF, FEATURES, FEATURE_DEFAULTS, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const items = (over: Partial<Record<FeatureKey, boolean>> = {}) => FEATURES.map((key) => ({ key, on: over[key] ?? FEATURE_DEFAULTS[key] }));
const view = (over: Partial<Record<FeatureKey, boolean>> = {}) => render(createElement(FeatureSwitches, { initial: items(over) }));

function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("«الميزات»: the economy panel", () => {
  it("is on top, prints the list of what it holds off and the ⚠️ warning with its 🔧 way back, whether it is on or off", () => {
    for (const economyMode of [false, true]) {
      const markup = view({ economyMode });
      const text = textOf(markup);
      expect(markup.indexOf("data-economy-panel")).toBeGreaterThan(-1);
      // the panel comes before the first ordinary switch
      expect(markup.indexOf("data-economy-panel")).toBeLessThan(markup.indexOf(AR["features.watch.hint"] as string));
      for (const key of ECONOMY_FORCED_OFF) expect(text, key).toContain(AR[`features.${key}.name`] as string);
      expect(text).toContain("⚠️");
      expect(text).toContain("🔧");
      expect(text).toContain((AR["economy.fix"] as string).replace("🔧 ", ""));
      // «وضع التوفير» is its own panel, not one more row of the list
      expect(markup.match(new RegExp(AR["features.economyMode.hint"] as string, "g")) ?? []).toHaveLength(0);
    }
  });

  it("economy ON: the switches it holds are marked «مطفية بوضع التوفير» and the panel says it is active; OFF: nothing is marked", () => {
    const on = textOf(view({ economyMode: true }));
    expect(on).toContain(AR["economy.active"] as string);
    const marks = on.split(AR["economy.held"] as string).length - 1;
    expect(marks).toBe(ECONOMY_FORCED_OFF.length);
    const off = textOf(view({ economyMode: false }));
    expect(off).not.toContain(AR["economy.held"] as string);
    expect(off).not.toContain(AR["economy.active"] as string);
  });

  it("a switch the owner already turned OFF is not marked as held (it is simply off), and one off the list is never marked", () => {
    const text = textOf(view({ economyMode: true, calls: false }));
    expect(text.split(AR["economy.held"] as string).length - 1).toBe(ECONOMY_FORCED_OFF.length - 1);
  });

  it("the toggles keep the owner's own state (the held ones stay switched on under the badge, dimmed)", () => {
    const markup = view({ economyMode: true });
    // every held row still has its switch ON: economy mode never moves the owner's toggle
    const rows = ECONOMY_FORCED_OFF.map((key) => new RegExp(`aria-checked="true"[^>]*aria-label="${(AR[`features.${key}.name`] as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    for (const row of rows) expect(markup).toMatch(row);
    expect(markup).toContain("opacity-50");
  });

  it("uses theme tokens and logical directions only", () => {
    expectClean(view({ economyMode: true }));
    expectClean(view({ economyMode: false }));
  });
});

describe("«حال السيرفر»: the card", () => {
  it("shows its title, the refresh button and that it is measuring, before the first reading; theme tokens only", () => {
    const markup = render(createElement(ServerHealthCard));
    const text = textOf(markup);
    expect(text).toContain(AR["health.title"] as string);
    expect(text).toContain(AR["health.refresh"] as string);
    expect(text).toContain(AR["health.loading"] as string);
    expectClean(markup);
  });

  it("is drawn only for the owner on the settings page, above the switches it advises on", () => {
    const page = read("src/app/(app)/settings/page.tsx");
    expect(page).toMatch(/actor\.isOwner \? <ServerHealthCard \/> : null/);
    expect(page.indexOf("<ServerHealthCard />")).toBeLessThan(page.indexOf("<FeatureSwitches"));
  });

  it("never measures on a timer: it reads when the screen opens and on «حدّث» only", () => {
    const src = read("src/components/server-health-card.tsx");
    expect(src).not.toMatch(/setInterval|refetchInterval/);
  });

  it("its thresholds are printed, and both the warning and the way back are in Arabic with ⚠️ and 🔧", () => {
    expect(AR["health.warn"]).toContain("⚠️");
    expect(AR["health.warn_fix"]).toContain("🔧");
    expect(AR["economy.warn"]).toContain("⚠️");
    expect(AR["economy.fix"]).toContain("🔧");
    expect(AR["health.thresholds"]).toMatch(/\{rss\}.*\{free\}.*\{lag\}.*\{db\}.*\{load\}/);
  });
});

describe("«وضع التوفير»: the shell tells the browser, and the timers listen", () => {
  it("the layout hands the switch to the shell, the shell sets it before anything below renders, and the repeated refreshes read their period through pollMs", () => {
    expect(read("src/app/(app)/layout.tsx")).toMatch(/economy=\{economyOn\(org\?\.settings\)\}/);
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toMatch(/setEconomy\(economy\);\s+const \{ t \} = useI18n\(\);/);
    for (const file of [
      "src/components/checkins/checkins-view.tsx",
      "src/components/checkins/my-checkin-card.tsx",
      "src/components/reminders/my-reminders-card.tsx",
      "src/components/time/my-time-today.tsx",
    ]) expect(read(file), file).toMatch(/setInterval\(\(\) => void load\(\), pollMs\(REFRESH_MS\)\)/);
    expect(read("src/components/notification-bell.tsx")).toMatch(/refetchInterval: pollMs\(30_000\)/);
    expect(read("src/lib/realtime/use-realtime.ts")).toMatch(/\}, pollMs\(POLL_MS\)\);/);
  });
});
