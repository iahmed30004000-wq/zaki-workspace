import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;
// the presenter's neighbours load the database client at import; only their pure functions are used here
vi.mock("@/server/db", () => ({ db: {} }));

import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { accuracyWords, ACCURACY_MAX_M, askPosition, coordsText, LOCATE_TIMEOUT_MS, locationOf, mapsUrl, roundPlace, validPlace } from "@/lib/chat/location";
import { attachItemsOf, attachTabsOf } from "@/lib/chat/v2/composer/attach-items";
import { LocationView, type LocationState } from "@/components/chat/v2/composer/location-dialog";
import { LocationCard } from "@/components/chat/message/location-card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TgAttachPanel } from "@/components/chat/v2/composer/attach-sheet-tg";
import { AttachCaptionBar, AttachTile } from "@/components/chat/v2/composer/attach-sheet";
import { presentMessage, previewOf } from "@/server/chat/redact";
import { locationSendSchema } from "@/server/chat/location";

/**
 * «إرسال الموقع» — the pure rules, what the person sees before anything is sent, the card, and what the source promises (no request to anybody, no watching). WHO may send and
 * read a place is the server's rule, proven against a real database in tests/db/chat-location.test.ts.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}
const noop = () => undefined;
const PLACE = { lat: 31.953949, lng: 35.910635, accuracy: 25 };

describe("the switch «إرسال الموقع»", () => {
  it("is on by default, in the chat group and needs the new chat screen", () => {
    expect(FEATURE_DEFAULTS.chatLocation).toBe(true);
    expect(FEATURE_META.chatLocation).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(AR["features.chatLocation.hint"]).toContain("⚠️");
    expect(AR["features.chatLocation.hint"]).toContain("🔧");
  });
});

describe("the attach menus offer «الموقع» only where the server says so", () => {
  it("the items and the phone's tabs", () => {
    expect(attachItemsOf({})).not.toContain("location");
    expect(attachItemsOf({ canLocation: true })).toEqual(["media", "file", "location"]);
    expect(attachTabsOf({ canPoll: true })).not.toContain("location");
    expect(attachTabsOf({ canPoll: true, canChecklist: true, canLocation: true })).toEqual(["media", "file", "location", "poll", "contact", "checklist"]);
  });
  it("the phone's sheet draws the tab", () => {
    const html = renderToStaticMarkup(createElement(TgAttachPanel, { parts: { Tile: AttachTile, CaptionBar: AttachCaptionBar }, tabs: attachTabsOf({ canLocation: true }), tab: "media", size: "half", files: [], busy: false, caption: "", canSend: false, onTab: noop, onBack: noop, onCaption: noop, onPick: noop, onRemove: noop, onSend: noop }));
    expect(html).toContain('data-attach-tab="location"');
    expect(html).toContain("الموقع");
  });
});

describe("a place", () => {
  it("is two real coordinates and an accuracy; anything else is none", () => {
    expect(validPlace(PLACE)).toBe(true);
    for (const bad of [{ ...PLACE, lat: 90.0001 }, { ...PLACE, lng: -180.5 }, { ...PLACE, accuracy: -1 }, { ...PLACE, accuracy: ACCURACY_MAX_M + 1 }, { ...PLACE, lat: Number.NaN }, { ...PLACE, lng: "35" as unknown as number }, { ...PLACE, accuracy: Infinity }]) {
      expect(validPlace(bad), JSON.stringify(bad)).toBe(false);
    }
  });
  it("is stored with six decimals and whole metres, never claiming to be more accurate than the phone said", () => {
    expect(roundPlace({ lat: 31.95394912345, lng: -0.00000049, accuracy: 24.01 })).toEqual({ lat: 31.953949, lng: -0, accuracy: 25 });
  });
  it("is read out of a stored card only when the whole card is good", () => {
    expect(locationOf({ type: "location", ...PLACE })).toEqual(PLACE);
    expect(locationOf({ type: "product", cardId: "x" })).toBeNull();
    expect(locationOf({ type: "location", lat: 200, lng: 0, accuracy: 1 })).toBeNull();
    expect(locationOf(null)).toBeNull();
  });
  it("is written with Western digits, and the one maps address is built from the two numbers alone", () => {
    expect(coordsText(PLACE)).toBe("31.953949, 35.910635");
    expect(mapsUrl(PLACE)).toBe("https://www.google.com/maps/search/?api=1&query=31.953949%2C35.910635");
  });
  it("says its accuracy in metres, then kilometres", () => {
    expect(accuracyWords(0)).toEqual({ key: "chatloc.accuracy_m", n: 1 });
    expect(accuracyWords(999)).toEqual({ key: "chatloc.accuracy_m", n: 999 });
    expect(accuracyWords(1240)).toEqual({ key: "chatloc.accuracy_km", n: 1.3 });
  });
});

describe("asking the browser", () => {
  type Ok = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
  type Fail = (f: { code: number }) => void;

  it("one fresh, precise reading", async () => {
    const asked: unknown[] = [];
    const result = await askPosition({
      getCurrentPosition: (ok: Ok, _fail?: Fail, options?: unknown) => {
        asked.push(options);
        ok({ coords: { latitude: 31.953949, longitude: 35.910635, accuracy: 24.2 } });
      },
    });
    expect(result).toEqual({ ok: true, place: { lat: 31.953949, lng: 35.910635, accuracy: 25 } });
    expect(asked).toEqual([{ enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 }]);
  });
  it("a refusal, no signal, a time out, a nonsense answer and a browser without it each say what happened, and nothing throws", async () => {
    const failing = (code: number) => ({ getCurrentPosition: (_ok: Ok, fail?: Fail) => fail?.({ code }) });
    expect(await askPosition(failing(1))).toEqual({ ok: false, reason: "denied" });
    expect(await askPosition(failing(2))).toEqual({ ok: false, reason: "unavailable" });
    expect(await askPosition(failing(3))).toEqual({ ok: false, reason: "timeout" });
    expect(await askPosition({ getCurrentPosition: (ok: Ok) => ok({ coords: { latitude: 999, longitude: 0, accuracy: 1 } }) })).toEqual({ ok: false, reason: "unavailable" });
    expect(await askPosition({ getCurrentPosition: () => { throw new Error("blocked"); } })).toEqual({ ok: false, reason: "unavailable" });
    expect(await askPosition(null)).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("what the person sees before anything is sent", () => {
  const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
  const view = (state: LocationState, error = "") =>
    renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Dialog, { open: true }, createElement(DialogContent, { portal: false, "aria-describedby": undefined }, createElement(LocationView, { state, busy: false, error, onSend: noop, onAgain: noop, onCancel: noop })))));

  it("while the place is read there is nothing to send", () => {
    const html = view({ step: "locating" });
    expect(html).toContain(AR["chatloc.locating"]!);
    expect(html).not.toContain("data-location-send");
  });
  it("the point, its accuracy, the warning with its fix, and only then «ابعت موقعي»", () => {
    const html = view({ step: "found", place: PLACE });
    expect(html).toContain("31.953949, 35.910635");
    expect(html).toContain("دقة الموقع: ضمن 25 متر تقريبًا");
    expect(html).toContain(AR["chatloc.warn"]!);
    expect(html).toContain(AR["chatloc.fix"]!);
    expect(html).toContain("data-location-send");
    expect(html).toContain("ابعت موقعي");
    expect(html).not.toContain("data-location-weak");
    expect(html).not.toMatch(/<img|<iframe/);
  });
  it("a weak reading says so, with what to do", () => {
    const html = view({ step: "found", place: { ...PLACE, accuracy: 2400 } });
    expect(html).toContain("data-location-weak");
    expect(html).toContain(AR["chatloc.weak_fix"]!);
    expect(html).toContain("2.4");
  });
  it("every failure has its sentence and its fix, and nothing to send", () => {
    for (const reason of ["denied", "unavailable", "timeout", "unsupported"] as const) {
      const html = view({ step: "failed", reason });
      expect(html, reason).toContain(AR[`chatloc.err.${reason}`]!);
      expect(html, reason).toContain(AR[`chatloc.fix.${reason}`]!);
      expect(html).not.toContain("data-location-send");
      expect(html).toContain("data-location-again");
    }
  });
});

describe("the card", () => {
  const html = renderToStaticMarkup(createElement(LocationCard, { place: { type: "location", ...PLACE } }));
  it("coordinates, accuracy and «افتح بالخرائط», a link the reader taps: a new tab, no handle back, no referrer", () => {
    expect(html).toContain("31.953949, 35.910635");
    expect(html).toContain("افتح بالخرائط");
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=31.953949%2C35.910635"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("draws no map: no picture, no frame, nothing the page would fetch by itself", () => {
    expect(html).not.toMatch(/<img|<iframe|<script|<link|url\(/);
  });
});

describe("what a reader receives", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "m1", kind: "CARD", body: AR["chatloc.body"]!, card: { type: "location", ...PLACE }, createdAt: new Date(), pinned: false, editedAt: null, deletedAt: null, authorId: "u1", ...over });
  const viewer = { userId: "u2", role: "MEMBER", canModerateHere: false };

  it("a live message gives the place; the words carry no number, so no list, bell, search or model sees where the person is", () => {
    const dto = presentMessage(row(), viewer);
    expect(dto.card).toEqual({ type: "location", ...PLACE });
    expect(dto.body).toBe("📍 موقع");
    expect(AR["chatloc.body"]).not.toMatch(/\d/);
    expect(previewOf(dto.body, null)).toBe("📍 موقع");
  });
  it("a deleted message gives no place to anybody, the owner included", () => {
    for (const who of [viewer, { userId: "o", role: "OWNER", oversight: true, canModerateHere: true }]) {
      const dto = presentMessage(row({ deletedAt: new Date() }), who);
      expect(dto.card).toBeUndefined();
      expect(JSON.stringify(dto)).not.toContain("31.953949");
    }
  });
  it("a broken stored card gives nothing", () => {
    expect(presentMessage(row({ card: { type: "location", lat: 400, lng: 0, accuracy: 1 } }), viewer).card).toBeUndefined();
  });
  it("«رد على رسالتك»: the answered person is told the quoted message is theirs, and nobody else", () => {
    const quoted = { id: "p", body: "سؤال", deletedAt: null, authorId: "u2", author: { name: "سلمى" } };
    expect(presentMessage(row({ replyTo: quoted }), viewer).replyTo?.mine).toBe(true);
    expect(presentMessage(row({ replyTo: quoted }), { ...viewer, userId: "u3" }).replyTo).not.toHaveProperty("mine");
  });
});

describe("what the server takes", () => {
  it("the two coordinates and the accuracy, in range, and nothing else", () => {
    expect(locationSendSchema.safeParse({ ...PLACE, clientId: "k" }).success).toBe(true);
    for (const bad of [{ ...PLACE, lat: 91 }, { ...PLACE, lng: 181 }, { ...PLACE, accuracy: -1 }, { lat: 1, lng: 1 }, { ...PLACE, lat: "31" }, { ...PLACE, body: "x" }, { ...PLACE, address: "x" }]) {
      expect(locationSendSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("what the source promises", () => {
  it("nothing watches the place, and only the confirmation dialog reads it", { timeout: 60_000 }, () => {
    const source = walk(path.join(ROOT, "src")).map((file) => ({ file, text: read(file) }));
    const holding = (pattern: RegExp) => source.filter((s) => pattern.test(s.text)).map((s) => s.file).sort();
    expect(holding(/watchPosition/)).toEqual([]);
    expect(holding(/\bgetCurrentPosition\(/)).toEqual(["src/lib/chat/location.ts"]);
    expect(holding(/\baskPosition\b/)).toEqual(["src/components/chat/v2/composer/location-dialog.tsx", "src/lib/chat/location.ts"]);
    // the dialog exists only after the tap on «الموقع»
    expect(read("src/components/chat/v2/composer/attach-menu.tsx")).toContain("{locationOpen ? <LocationFromMenu");
  });
  it("neither the page nor the server asks anybody for a map or an address", () => {
    for (const file of ["src/lib/chat/location.ts", "src/server/chat/location.ts", "src/components/chat/message/location-card.tsx"]) expect(read(file), file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon/);
    expect(read("src/components/chat/v2/composer/location-dialog.tsx").match(/fetch\(`[^`]*`/g)).toEqual(["fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/location`"]);
  });
  it("the server's door asks both switches", () => {
    const service = read("src/server/chat/location.ts");
    expect(service).toContain('assertFeatureOn(ctx.orgId, "chatLayoutV2")');
    expect(service).toContain('assertFeatureOn(ctx.orgId, "chatLocation")');
  });
});
