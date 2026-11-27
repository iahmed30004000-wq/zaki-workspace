"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiPatch, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

/** The words of a refused change: the current password was wrong, the name is taken or breaks the rule, or too many tries. */
export function usernameErrorText(err: unknown, t: (key: string) => string): string {
  if (!(err instanceof ApiError)) return t("common.error");
  if (err.messageKey === "password.wrong_current") return t("profile.wrongCurrent");
  if (err.code === "rate_limited") return t("auth.too_many_attempts");
  const details = Array.isArray(err.details) ? (err.details as { message?: unknown }[]) : [];
  const key = [err.messageKey, ...details.map((d) => d.message)].find((k): k is string => typeof k === "string" && t(k) !== k);
  return key ? t(key) : t("common.error");
}

/**
 * «اسم المستخدم» in «حسابي», which the person may change themselves: the name as it is with «تغيير»; the form asks for the new name and the current
 * password (it is the name they sign in with).
 */
export function OwnUsername({ username }: { username: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [shown, setShown] = useState(username);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const made = await apiPatch<{ username: string }>("/api/me/username", { username: f.get("username"), currentPassword: f.get("currentPassword") });
      setShown(made.username);
      setOpen(false);
      toast(t("ownUsername.saved"), "success");
      router.refresh();
    } catch (err) {
      setError(usernameErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-own-username="" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">{t("settingsMe.account.username")}</p>
          <p dir="ltr" className="break-all text-end text-fg">
            @{shown}
          </p>
        </div>
        {open ? null : (
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            {t("ownUsername.change")}
          </Button>
        )}
      </div>
      {open ? (
        <form onSubmit={save} className="mt-3 space-y-3 border-t border-border pt-3">
          <div>
            <Label>{t("ownUsername.new")}</Label>
            <Input name="username" defaultValue={shown} required minLength={3} maxLength={32} dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" className="text-start" />
            <p className="mt-1 text-xs text-fg-muted">{t("ownUsername.rule")}</p>
          </div>
          <div>
            <Label>{t("profile.currentPassword")}</Label>
            <Input name="currentPassword" type="password" required autoComplete="current-password" />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {t("task.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              {t("ownUsername.cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
