"use client";

import { useEffect, useState } from "react";
import { Briefcase, CalendarCheck, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { DoorShell } from "@/components/theme/door-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { apiPost, ApiError } from "@/lib/api-client";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Step = "password" | "notice";

/** The first rule a new password breaks (the same rules the server enforces), as a message key. */
function passwordProblem(current: string, fresh: string, confirm: string): string | null {
  if (fresh.length < 8) return "onboarding.err_min8";
  if (!/[A-Za-z]/.test(fresh)) return "onboarding.err_letter";
  if (!/[0-9]/.test(fresh)) return "onboarding.err_digit";
  if (fresh === current) return "onboarding.err_same";
  if (fresh !== confirm) return "onboarding.err_mismatch";
  return null;
}

/** Server validation messages -> the wording of this page. */
const SERVER_MESSAGES: Record<string, string> = {
  "password.min8": "onboarding.err_min8",
  "password.letter": "onboarding.err_letter",
  "password.digit": "onboarding.err_digit",
  "password.wrong_current": "onboarding.err_wrong_current",
  "onboarding.err_same": "onboarding.err_same",
};

/**
 * The onboarding steps, one at a time, phone first: (1) choose your own password, (2) read and
 * accept the transparency notice. When the last step is done the browser continues to `next`
 * with a full page load, so the middleware sees the fresh session cookie.
 *
 * It sits on the same calm door as sign-in (`DoorShell`, the wider column): the Zaki Workspace mark and wordmark,
 * the decoration of the active theme behind, the steps on an opaque card, and the sign-out under the card.
 */
export function OnboardingForm({
  name,
  owesPassword,
  owesNotice,
  next,
}: {
  name: string;
  owesPassword: boolean;
  owesNotice: boolean;
  next: string;
}) {
  const { t } = useI18n();
  const steps: Step[] = [...(owesPassword ? (["password"] as const) : []), ...(owesNotice ? (["notice"] as const) : [])];
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const step = steps[index];

  function messageFor(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        window.location.replace("/login");
        return t("common.loading");
      }
      if (err.code === "rate_limited") return t("auth.too_many_attempts");
      const first =
        err.code === "validation.failed" && Array.isArray(err.details)
          ? (err.details[0] as { message?: string } | undefined)?.message
          : undefined;
      const key = SERVER_MESSAGES[err.messageKey ?? ""] ?? SERVER_MESSAGES[first ?? ""] ?? err.messageKey;
      if (key && t(key) !== key) return t(key);
    }
    return t("common.error");
  }

  function advance() {
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      setPending(false);
    } else {
      window.location.replace(next);
    }
  }

  async function refreshAndContinue() {
    setPending(true);
    setError(null);
    try {
      // nothing is owed, but this browser's cookie still says so: accepting again changes no
      // record and re-issues the cookie
      await apiPost("/api/me/transparency", { accept: true });
      window.location.replace(next);
    } catch (err) {
      setError(messageFor(err));
      setPending(false);
    }
  }

  useEffect(() => {
    if (steps.length === 0) void refreshAndContinue();
    // runs once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const current = String(form.get("currentPassword") ?? "");
    const fresh = String(form.get("newPassword") ?? "");
    const confirm = String(form.get("confirmPassword") ?? "");
    const problem = passwordProblem(current, fresh, confirm);
    if (problem) {
      setError(t(problem));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost("/api/me/password", { currentPassword: current, newPassword: fresh });
      setPasswordSaved(true);
      advance();
    } catch (err) {
      setError(messageFor(err));
      setPending(false);
    }
  }

  async function acceptNotice() {
    setPending(true);
    setError(null);
    try {
      await apiPost("/api/me/transparency", { accept: true });
      advance();
    } catch (err) {
      setError(messageFor(err));
      setPending(false);
    }
  }

  async function signOut() {
    try {
      await apiPost("/api/auth/logout");
    } finally {
      // nothing of this person stays on the device for the next one to sign in (C1.5; never throws)
      await wipeChatCache();
      window.location.replace("/login");
    }
  }

  const fieldType = showPasswords ? "text" : "password";
  const inputClass = "h-11 text-base";
  const points = [
    { icon: Eye, text: t("onboarding.notice_kept") },
    { icon: Briefcase, text: t("onboarding.notice_work") },
    { icon: CalendarCheck, text: t("onboarding.notice_record") },
  ];

  return (
    <DoorShell width="md">
      <Card className="rounded-2xl p-5 shadow-card sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t("onboarding.welcome", { name })}</h1>
          {steps.length > 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{steps.length > 1 ? t("onboarding.intro_two") : t("onboarding.intro_one")}</p>
          ) : null}

          {steps.length > 1 ? (
            <div className="mt-4">
              <p className="text-xs text-fg-muted">{t("onboarding.step", { current: index + 1, total: steps.length })}</p>
              <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
                {steps.map((s, i) => (
                  <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-accent" : "bg-surface-2")} />
                ))}
              </div>
            </div>
          ) : null}

          {step === "password" ? (
            <form onSubmit={savePassword} className="mt-5 space-y-4">
              <div className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <p className="text-base font-semibold text-fg">{t("onboarding.password_title")}</p>
                  <p className="mt-1 text-sm leading-6 text-fg-muted">{t("onboarding.password_hint")}</p>
                </div>
              </div>
              <label className="block">
                <Label>{t("onboarding.current_password")}</Label>
                <Input name="currentPassword" type={fieldType} required autoComplete="current-password" dir="ltr" className={inputClass} />
              </label>
              <label className="block">
                <Label>{t("onboarding.new_password")}</Label>
                <Input name="newPassword" type={fieldType} required minLength={8} maxLength={200} autoComplete="new-password" dir="ltr" className={inputClass} />
              </label>
              <label className="block">
                <Label>{t("onboarding.confirm_password")}</Label>
                <Input name="confirmPassword" type={fieldType} required minLength={8} maxLength={200} autoComplete="new-password" dir="ltr" className={inputClass} />
              </label>
              <p className="text-xs leading-5 text-fg-muted">{t("onboarding.password_rule")}</p>
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="flex min-h-11 items-center gap-1.5 text-xs text-accent hover:underline"
              >
                {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPasswords ? t("onboarding.hide_passwords") : t("onboarding.show_passwords")}
              </button>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={pending} className="h-11 w-full text-base">
                {pending ? t("common.loading") : t("onboarding.password_submit")}
              </Button>
            </form>
          ) : null}

          {step === "notice" ? (
            <div className="mt-5">
              {passwordSaved ? <p className="mb-4 text-sm text-ok">{t("onboarding.password_saved")}</p> : null}
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-accent" />
                <p className="text-base font-semibold text-fg">{t("onboarding.notice_title")}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{t("onboarding.notice_intro")}</p>
              <ul className="mt-3 space-y-3 rounded-xl bg-surface-2 p-4 text-sm leading-7 text-fg">
                {points.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-3">
                    <Icon className="mt-1.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
              <Button type="button" onClick={acceptNotice} disabled={pending} className="mt-5 h-11 w-full text-base">
                {pending ? t("common.loading") : t("onboarding.notice_accept")}
              </Button>
            </div>
          ) : null}

          {steps.length === 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-fg-muted">{t("onboarding.finishing")}</p>
              {error ? (
                <>
                  <p role="alert" className="text-sm text-danger">{error}</p>
                  <Button type="button" onClick={refreshAndContinue} disabled={pending} className="h-11 w-full text-base">
                    {t("common.retry")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Under the card, on the page (or the scrim panel): the dimmer of the three colours a decorated screen may use. */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={signOut}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {t("common.logout")}
        </button>
      </div>
    </DoorShell>
  );
}
