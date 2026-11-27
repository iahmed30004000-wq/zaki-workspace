"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { apiPost, apiPatch, apiDelete, apiUpload, ApiError } from "@/lib/api-client";
import { compressImage } from "@/lib/chat/compress-image";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { LastSeenToggle } from "@/components/last-seen-toggle";
import { OwnUsername } from "@/components/own-username";

export interface MeData {
  id: string;
  /** Absent for an account that has only a username. */
  email: string | null;
  name: string;
  jobTitle: string | null;
  bio: string | null;
  locale: string;
  hue: number;
  /** `/api/avatars/<id>`, or null when the person has no picture yet. */
  avatarUrl?: string | null;
}

/**
 * The Arabic text for a failed password change: the current password was wrong, the new one breaks
 * a rule (the server sends the rule's key in `details`), or there were too many tries.
 */
export function passwordErrorText(err: unknown, t: (key: string) => string): string {
  if (!(err instanceof ApiError)) return t("common.error");
  if (err.messageKey === "password.wrong_current") return t("profile.wrongCurrent");
  if (err.code === "rate_limited") return t("auth.too_many_attempts");
  const details = Array.isArray(err.details) ? (err.details as { message?: unknown }[]) : [];
  const rule = details.map((d) => d.message).find((m): m is string => typeof m === "string" && t(m) !== m);
  return rule ? t(rule) : t("common.error");
}

/** Self-service account form: the picture, then identity + job title + bio + password change. */
export function ProfileForm({
  me,
  withPicture = true,
  lastSeen,
  embedded = false,
  identity,
}: {
  me: MeData;
  withPicture?: boolean;
  /** «إخفاء آخر ظهوري»: given only when the company's «آخر ظهور» switch is on and the person is not a guest */
  lastSeen?: { hide: boolean };
  /** C4.1: drawn inside «إعداداتي» → «حسابي» (the section brings its own heading and padding) */
  embedded?: boolean;
  /** C4.1: the read-only identity lines of «حسابي» (the username and who may change it) */
  identity?: { username: string | null; usernameManaged: boolean };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  // the picture: the file picker, the upload in flight, and what the circle shows now
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me.avatarUrl ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    try {
      // the phone's camera makes 4000×3000 photos: the same client resize the chat uses, so 2 MB is generous
      const compressed = await compressImage(file, file.name);
      const body = compressed ? new File([compressed.blob], "avatar.jpg", { type: compressed.mime }) : file;
      const form = new FormData();
      form.set("file", body, body.name || "avatar.jpg");
      const made = await apiUpload<{ avatarUrl: string }>("/api/me/avatar", form);
      setAvatarUrl(made.avatarUrl);
      toast(t("profile.photo.saved"), "success");
      router.refresh();
    } catch (err) {
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "common.error";
      toast(t(key), "error");
    } finally {
      setAvatarBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      await apiDelete("/api/me/avatar");
      setAvatarUrl(null);
      toast(t("profile.photo.removed"), "success");
      router.refresh();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      await apiPatch("/api/me", {
        name: f.get("name"),
        jobTitle: f.get("jobTitle") || "",
        bio: f.get("bio") || null,
      });
      toast(t("profile.saved"), "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error"), "error");
    } finally {
      setPending(false);
    }
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setPending(true);
    try {
      await apiPost("/api/me/password", {
        currentPassword: f.get("currentPassword"),
        newPassword: f.get("newPassword"),
      });
      form.reset();
      toast(t("profile.passwordChanged"), "success");
    } catch (err) {
      toast(passwordErrorText(err, t), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={embedded ? "space-y-5 px-3 pb-6 md:px-0" : "mx-auto max-w-2xl space-y-5 p-4 md:p-6"}>
      <section>
        {embedded ? null : <h1 className="mb-3 text-base font-semibold text-fg">{t("profile.title")}</h1>}
        <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-4">
          <Avatar name={me.name} src={avatarUrl} className="h-16 w-16 text-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{t("profile.photo")}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{t("profile.photo.hint")}</p>
          </div>
          {withPicture ? (
            <div className="flex items-center gap-2">
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
            <Button type="button" variant="secondary" disabled={avatarBusy} onClick={() => picker.current?.click()}>
              {avatarBusy ? t("common.loading") : avatarUrl ? t("profile.photo.change") : t("profile.photo.add")}
            </Button>
            {avatarUrl ? (
              <Button type="button" variant="ghost" disabled={avatarBusy} onClick={() => void removeAvatar()}>
                {t("profile.photo.remove")}
              </Button>
            ) : null}
          </div>
          ) : null}
        </div>
        <form onSubmit={saveProfile} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <Label>{t("auth.name")}</Label>
            <Input name="name" defaultValue={me.name} required maxLength={100} />
          </div>
          <div>
            <Label>{t("auth.jobTitle")}</Label>
            <Input name="jobTitle" defaultValue={me.jobTitle ?? ""} maxLength={60} placeholder={t("auth.jobTitlePlaceholder")} />
          </div>
          <div>
            <Label>{t("profile.bio")}</Label>
            <Textarea name="bio" defaultValue={me.bio ?? ""} maxLength={500} rows={3} />
          </div>
          {identity ? (
            <div data-identity className="space-y-2 border-t border-border pt-3 text-sm">
              {me.email ? (
                <div>
                  <p className="text-fg-muted">{t("settingsMe.account.email")}</p>
                  <p dir="ltr" className="break-all text-end text-fg">
                    {me.email}
                  </p>
                  <p className="text-xs text-fg-muted">{t("settingsMe.account.readonly")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={pending}>
            {t("task.save")}
          </Button>
        </form>
      </section>

      {identity?.username ? <OwnUsername username={identity.username} /> : null}

      {lastSeen ? <LastSeenToggle initialHide={lastSeen.hide} /> : null}

      <section>
        <h2 className="mb-3 text-base font-semibold text-fg">{t("profile.changePassword")}</h2>
        <form onSubmit={changePassword} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <Label>{t("profile.currentPassword")}</Label>
            <Input name="currentPassword" type="password" required autoComplete="current-password" />
          </div>
          <div>
            <Label>{t("onboarding.new_password")}</Label>
            <Input name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
            <p className="mt-1 text-xs text-muted">{t("auth.passwordRule")}</p>
          </div>
          <Button type="submit" disabled={pending}>
            {t("profile.changePassword")}
          </Button>
        </form>
      </section>
    </div>
  );
}
