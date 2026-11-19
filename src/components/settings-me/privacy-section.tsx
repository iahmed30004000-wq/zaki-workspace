"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LastSeenToggle } from "@/components/last-seen-toggle";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { wipeChatCache } from "@/lib/chat/cache/wipe";
import { Group } from "@/components/settings-me/parts";
import { sectionHref } from "@/components/settings-me/sections";

/**
 * C4.1 — «الخصوصية والأمان»: «آخر ظهور» (today's hide switch, `/api/me/last-seen`, with its own ⚠️ and 🔧; the owner's `ownerHiddenOnline` rule and the
 * company's `lastSeen` switch are not touched here), the way into «الأجهزة والجلسات» and the password, and the button of C1.5's wipe.
 */

/** The wipe button of the messages kept on this device: C1.5's ONE wipe function, behind a confirmation (the messages come back from the server on the next open). */
export function WipeButton() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      // the cache of messages only: a message still waiting to be sent stays theirs to send
      await wipeChatCache();
      toast(t("settingsMe.p.wipe.done"), "success");
    } catch {
      toast(t("settingsMe.p.wipe.failed"), "error");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div data-wipe>
      {asking ? (
        <div role="alertdialog" aria-label={t("settingsMe.p.wipe.confirm")} className="space-y-2">
          <p className="text-sm text-fg">{t("settingsMe.p.wipe.confirm")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>
              {t("settingsMe.p.wipe.yes")}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              {t("settingsMe.p.wipe.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
          {t("settingsMe.p.wipe.button")}
        </Button>
      )}
    </div>
  );
}

export function PrivacySection({ lastSeen }: { lastSeen: { hide: boolean } | null }) {
  const { t } = useI18n();
  return (
    <div data-section-body="privacy">
      <Group title={t("settingsMe.p.lastseen.title")}>
        {lastSeen ? <LastSeenToggle initialHide={lastSeen.hide} /> : <p className="text-sm text-fg-muted">{t("settingsMe.p.lastseen.off")}</p>}
      </Group>
      <Group>
        <Link href={sectionHref("devices")} className="flex min-h-14 items-center justify-between gap-3 rounded-xl px-1 text-start hover:bg-surface-2">
          <span>
            <span className="block text-[15px] font-medium text-fg">{t("settingsMe.p.devices")}</span>
            <span className="block text-[13px] text-fg-muted">{t("settingsMe.p.devices.hint")}</span>
          </span>
        </Link>
        <Link href={sectionHref("account")} className="flex min-h-14 items-center justify-between gap-3 rounded-xl px-1 text-start hover:bg-surface-2">
          <span>
            <span className="block text-[15px] font-medium text-fg">{t("settingsMe.p.password")}</span>
            <span className="block text-[13px] text-fg-muted">{t("settingsMe.p.password.hint")}</span>
          </span>
        </Link>
      </Group>
      <Group title={t("settingsMe.p.wipe")} hint={t("settingsMe.p.wipe.hint")}>
        <WipeButton />
      </Group>
    </div>
  );
}
