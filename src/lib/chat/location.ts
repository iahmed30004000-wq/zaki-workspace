/**
 * «إرسال الموقع» — the pure words of a shared place: what a stored card holds, how the browser is asked for it, how its accuracy is read and the ONE address the reader may
 * open. No React, no server import, and NO request to anybody: nothing here draws a map or fetches a tile. The browser is asked only by `askPosition`, which the screen calls
 * when the person taps «الموقع» (or «حدّد من جديد»); there is no watching, no live location and nothing collected in the background.
 */

export interface SharedPlace {
  lat: number;
  lng: number;
  /** how far the real place may be from the point, in metres */
  accuracy: number;
}

/** Six decimals are about ten centimetres: more says nothing. */
export const COORD_DECIMALS = 6;
/** An accuracy beyond this says nothing about where the person is. */
export const ACCURACY_MAX_M = 1_000_000;
/** From this on the confirmation says the accuracy is weak. */
export const WEAK_ACCURACY_M = 100;
/** How long the browser is given to answer, in ms. */
export const LOCATE_TIMEOUT_MS = 20_000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const validPlace = (p: { lat: unknown; lng: unknown; accuracy: unknown }): boolean =>
  finite(p.lat) && finite(p.lng) && finite(p.accuracy) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && p.accuracy >= 0 && p.accuracy <= ACCURACY_MAX_M;

const round = (v: number): number => {
  const k = 10 ** COORD_DECIMALS;
  return Math.round(v * k) / k;
};

/** The place as it is stored and sent: six decimals, whole metres (rounded UP: never claim to be more accurate than the phone said). */
export function roundPlace(p: SharedPlace): SharedPlace {
  return { lat: round(p.lat), lng: round(p.lng), accuracy: Math.ceil(p.accuracy) };
}

/** The place a stored card holds (`ChatMessage.card` with `type: "location"`), or null for anything else or anything broken. */
export function locationOf(card: unknown): SharedPlace | null {
  if (!card || typeof card !== "object") return null;
  const c = card as { type?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown };
  if (c.type !== "location" || !validPlace({ lat: c.lat, lng: c.lng, accuracy: c.accuracy })) return null;
  return { lat: c.lat as number, lng: c.lng as number, accuracy: c.accuracy as number };
}

/** «31.953900, 35.910600»: Western digits, latitude first. */
export const coordsText = (p: Pick<SharedPlace, "lat" | "lng">): string => `${p.lat.toFixed(COORD_DECIMALS)}, ${p.lng.toFixed(COORD_DECIMALS)}`;

/**
 * «افتح بالخرائط»: the one address, built from the two numbers alone (never from text a message carries). It is a link the READER taps: the page and the server never ask it
 * for anything. The universal form opens the maps app on a phone that has one.
 */
export function mapsUrl(p: Pick<SharedPlace, "lat" | "lng">): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat.toFixed(COORD_DECIMALS)},${p.lng.toFixed(COORD_DECIMALS)}`)}`;
}

/** The accuracy as the dictionary says it: metres, and kilometres (one decimal) from one thousand. */
export function accuracyWords(metres: number): { key: "chatloc.accuracy_m" | "chatloc.accuracy_km"; n: number } {
  if (metres < 1000) return { key: "chatloc.accuracy_m", n: Math.max(1, Math.ceil(metres)) };
  return { key: "chatloc.accuracy_km", n: Math.ceil(metres / 100) / 10 };
}

export type LocateFailure = "denied" | "unavailable" | "timeout" | "unsupported";
export type LocateResult = { ok: true; place: SharedPlace } | { ok: false; reason: LocateFailure };

interface GeolocationLike {
  getCurrentPosition(
    success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    error?: (failure: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

const browserGeolocation = (): GeolocationLike | null => (typeof navigator !== "undefined" && navigator.geolocation ? (navigator.geolocation as unknown as GeolocationLike) : null);

/**
 * Asks the browser for the place ONCE (the browser asks the person for permission then, if it has not). A fresh reading, never a cached one (`maximumAge: 0`), the precise
 * one where the device has it. Never rejects.
 */
export function askPosition(geolocation: GeolocationLike | null = browserGeolocation()): Promise<LocateResult> {
  if (!geolocation) return Promise.resolve({ ok: false, reason: "unsupported" });
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const raw = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
          resolve(validPlace(raw) ? { ok: true, place: roundPlace(raw) } : { ok: false, reason: "unavailable" });
        },
        (failure) => resolve({ ok: false, reason: failure.code === 1 ? "denied" : failure.code === 3 ? "timeout" : "unavailable" }),
        { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
      );
    } catch {
      resolve({ ok: false, reason: "unavailable" });
    }
  });
}
