import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { audit, startSession, verifyPassword } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { clientIp } from "@/server/rate-limit";
import { LoginGuard } from "@/server/login-guard";
import { loginSchema } from "@/server/validation";
import { onboardingStateOf } from "@/server/policy/org-settings";
import { THEME_COOKIE, isChosenTheme, prefCookieOptions, themeOf } from "@/lib/themes/registry";
import { DIGITS_COOKIE, digitsOf } from "@/lib/digits";
import { SWITCH_COOKIE, parseSwitchPref, serializeSwitchPref } from "@/lib/themes/switch-fx";

/**
 * Brute-force guard (policy and reasoning live in login-guard.ts): the (typed text, address) pair,
 * the account as a whole (by user id, except from addresses it signed in from before), the
 * address's failures and its short burst.
 */
const guard = new LoginGuard();

/** A real cost-12 bcrypt hash of a throw-away value: unknown identifiers cost the same time as known ones. */
const DUMMY_HASH = "$2a$12$VeIDbFoPFwHKK1UpCnxtEuyhq/uLZ7Ik6NSvJ3XvcS7gwHexWMDJ2";

/**
 * The account an identifier names: a username or an e-mail address (both stored lower-case and
 * unique). When the identifier could be either, the reading it looks like wins ("@" = e-mail).
 */
async function findAccount(identifier: string) {
  const rows = await db.user.findMany({
    where: { OR: [{ username: identifier }, { email: identifier }] },
    take: 2,
    select: {
      id: true,
      email: true,
      username: true,
      passwordHash: true,
      tokenVersion: true,
      mustChangePassword: true,
      transparencyVersion: true,
      theme: true,
      digits: true,
      themeSwitch: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { organizationId: true, organization: { select: { settings: true } } },
      },
    },
  });
  const byEmail = rows.find((r) => r.email === identifier);
  const byUsername = rows.find((r) => r.username === identifier);
  return identifier.includes("@") ? (byEmail ?? byUsername) : (byUsername ?? byEmail);
}

/**
 * Sign in with `{ identifier, password }` (a username or an e-mail; the old `{ email, password }`
 * still works). 200 `{ ok, next }` tells the client where to go: "/onboarding" while a temporary
 * password or the transparency notice is still owed, "/" otherwise.
 *
 * An unknown identifier and a wrong password are the same 401. Somebody who proves the password
 * but is suspended or offboarded gets a clear 403 `auth.account_suspended` and no cookie.
 * The audit trail never holds a password, nor what was typed into the identifier field for a
 * failed attempt (people type their password there by mistake): a failure against a real account
 * is recorded with that account's id.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ip = clientIp(req);
    guard.admitAddress(ip);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("validation.failed", "invalid JSON");
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return apiError("auth.required", "invalid_credentials");

    const { identifier, password } = parsed.data;
    // The account-wide cap follows the ACCOUNT, whichever of its names was typed (a person with a
    // username and an e-mail does not get twice the guesses); the (typed text, address) lock follows
    // what was typed. The lookup is a plain read: the attempt is still counted before the password
    // is checked.
    const user = await findAccount(identifier);
    const attempt = guard.beginAttempt(ip, { typed: identifier, userId: user?.id ?? null });
    try {
      const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !passwordOk) {
        await audit("auth.login_failed", { target: user?.id ?? null });
        return apiError("auth.required", "invalid_credentials");
      }
      const active = user.memberships[0];
      if (!active) {
        await audit("auth.login_refused", { actorId: user.id, target: user.id, meta: { reason: "not_active" } });
        return apiError("forbidden", "auth.account_suspended");
      }
      attempt.success();
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      // Sign the session version read BEFORE the password check: a reset or "log out everywhere"
      // that landed during the check leaves this cookie already stale instead of being undone.
      await startSession(user.id, { tv: user.tokenVersion });
      await audit("auth.login", { actorId: user.id, orgId: active.organizationId });
      const owed = onboardingStateOf(user, active.organization.settings);
      const res = NextResponse.json({ ok: true, next: owed.mustChangePassword || owed.transparencyPending ? "/onboarding" : "/" });
      // the person's saved theme comes with them to this device ("system" = never chose: no cookie); a retired
      // key is written as the theme it now means
      if (isChosenTheme(user.theme)) res.cookies.set(THEME_COOKIE, themeOf(user.theme), prefCookieOptions(process.env.NODE_ENV === "production"));
      // and how they see 0-9 (always set: «123» is a choice too, and this device may hold the other one)
      res.cookies.set(DIGITS_COOKIE, digitsOf(user.digits), prefCookieOptions(process.env.NODE_ENV === "production"));
      // and the look of their light/dark switch («مظهر المفتاح»), when they chose one
      if (user.themeSwitch) res.cookies.set(SWITCH_COOKIE, serializeSwitchPref(parseSwitchPref(user.themeSwitch)), prefCookieOptions(process.env.NODE_ENV === "production"));
      return res;
    } finally {
      attempt.done();
    }
  });
}
