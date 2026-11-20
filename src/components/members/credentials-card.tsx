"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, CheckCircle2, ClipboardCopy, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { buildLoginMessage, loginUrlOf } from "@/lib/members-ui";
import { cn } from "@/lib/utils";
import { copyText } from "./clipboard";

/**
 * A copy button that confirms itself for two seconds (the icon turns into a check, and a screen reader
 * is told), and says so in a toast if copying failed. A success toast would only sit on top of the
 * buttons under the result card: the button itself is where the thumb is, so the answer is there.
 */
function useCopy() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  async function copy(text: string) {
    const ok = await copyText(text);
    if (!ok) {
      toast(t("members.copy_failed"), "error");
      return;
    }
    setCopied(true);
  }
  return { copied, copy };
}

/** A value that is read off the screen or pasted elsewhere: always left-to-right, easy to select. */
function SecretRow({ label, value, copyLabel, large = false }: { label: string; value: string; copyLabel: string; large?: boolean }) {
  const { t } = useI18n();
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="mt-0.5">
          <span
            dir="ltr"
            className={cn(
              "inline-block max-w-full select-all break-all font-mono font-semibold text-fg",
              large ? "text-xl tracking-wide" : "text-base",
            )}
          >
            {value}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copy(value)}
        aria-label={copyLabel}
        className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
      >
        {copied ? <Check className="size-4 text-ok" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{copied ? t("members.copied") : t("members.copy")}</span>
      </button>
      {/* outside the button, so it does not become part of the button's name */}
      <span role="status" className="sr-only">
        {copied ? t("members.copied") : ""}
      </span>
    </div>
  );
}

/**
 * The ONE result card after an account is created, a password is reset or a person is reactivated:
 * the username and the temporary password with a copy button for each, a single button that copies
 * a ready message (address + username + password + "change it on first sign-in"), and the honest
 * warning that the password is shown only once, with what to do if it is lost.
 */
export function CredentialsCard({
  heading,
  name,
  username,
  password,
  note,
  onDone,
  doneLabel,
  secondary,
}: {
  heading: string;
  /** The person's name, for the greeting in the copied message. */
  name: string;
  username: string;
  /** null only when the server did not send one. */
  password: string | null;
  note?: ReactNode;
  onDone: () => void;
  doneLabel?: string;
  secondary?: { label: string; onClick: () => void };
}) {
  const { t } = useI18n();
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const all = useCopy();

  // the card replaces what was on screen: put focus on it so the keyboard and a screen reader follow
  useEffect(() => {
    ref.current?.focus();
  }, []);

  function copyAll() {
    if (password === null) return;
    const message = buildLoginMessage(t, {
      name,
      loginUrl: loginUrlOf(window.location.origin),
      username,
      password,
    });
    void all.copy(message);
  }

  return (
    <section ref={ref} tabIndex={-1} aria-labelledby={headingId} className="space-y-4 outline-none">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-6 shrink-0 text-ok" aria-hidden="true" />
        <h3 id={headingId} className="text-base font-semibold text-fg">
          {heading}
        </h3>
      </div>

      <div className="space-y-3 rounded-[14px] bg-surface-1 p-3">
        <SecretRow label={t("members.secret_username")} value={username} copyLabel={t("members.copy_username_label")} />
        {password !== null ? (
          <>
            <div className="border-t border-border" />
            <SecretRow label={t("members.secret_password")} value={password} copyLabel={t("members.copy_password_label")} large />
          </>
        ) : null}
      </div>

      {password !== null ? (
        <>
          <Button type="button" onClick={copyAll} className="h-12 w-full text-base">
            {all.copied ? <Check className="size-5" aria-hidden="true" /> : <ClipboardCopy className="size-5" aria-hidden="true" />}
            {all.copied ? t("members.copied") : t("members.copy_all")}
          </Button>
          <span role="status" className="sr-only">
            {all.copied ? t("members.copied_all") : ""}
          </span>
          <div role="note" className="space-y-1 rounded-lg bg-warn/10 p-3 text-xs leading-6 text-warn">
            <p className="font-semibold">{t("members.once_warning")}</p>
            <p>{t("members.once_fix")}</p>
            <p>{t("members.must_change")}</p>
          </div>
        </>
      ) : (
        <p role="note" className="rounded-lg bg-warn/10 p-3 text-xs leading-6 text-warn">
          {t("members.no_password_returned")}
        </p>
      )}

      {note ? <div className="text-xs leading-6 text-fg-muted">{note}</div> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onDone} className="h-11 sm:flex-1">
          {doneLabel ?? t("members.done")}
        </Button>
        {secondary ? (
          <Button type="button" variant="secondary" onClick={secondary.onClick} className="h-11 sm:flex-1">
            {secondary.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
