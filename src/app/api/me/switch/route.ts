import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { THEMES, THEME_KEYS, prefCookieOptions } from "@/lib/themes/registry";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  SWITCH_COOKIE,
  SWITCH_STYLES,
  WARMTH_MAX,
  WARMTH_MIN,
  parseSwitchPref,
  serializeSwitchPref,
} from "@/lib/themes/switch-fx";

/** The look of the switch and its two numbers, and the dark theme to come back to — any of them, nothing else. */
const switchChoiceSchema = z
  .object({
    style: z.enum(SWITCH_STYLES).optional(),
    brightness: z.number().int().min(BRIGHTNESS_MIN).max(BRIGHTNESS_MAX).optional(),
    warmth: z.number().int().min(WARMTH_MIN).max(WARMTH_MAX).optional(),
    dark: z
      .enum(THEME_KEYS)
      .refine((key) => THEMES[key].dark, { message: "validation.failed" })
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "validation.failed" });

/**
 * «مظهر المفتاح»: save the caller's own look of the light/dark switch. Merged into what is stored
 * (`User.themeSwitch`, `style.brightness.warmth.dark`, src/lib/themes/switch-fx.ts), so a request may
 * carry just the number that moved; set as the `zk-switch` cookie by the server for a year (a
 * script-written cookie lasts seven days in Safari), like the theme's. Only the caller's own row is
 * touched and nothing but those four values is ever stored. Usable during the onboarding (its pages
 * are themed too). Answers `{ ok, pref }`.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser({ allowPending: true });
    const input = await parseJson(switchChoiceSchema, req);

    const row = await db.user.findUnique({ where: { id: user.id }, select: { themeSwitch: true } });
    const pref = { ...parseSwitchPref(row?.themeSwitch), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    const value = serializeSwitchPref(pref);
    await db.user.update({ where: { id: user.id }, data: { themeSwitch: value } });

    const res = NextResponse.json({ ok: true, pref: parseSwitchPref(value) });
    res.cookies.set(SWITCH_COOKIE, value, prefCookieOptions(process.env.NODE_ENV === "production"));
    return res;
  });
}
