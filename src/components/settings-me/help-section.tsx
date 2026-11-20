"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Group } from "@/components/settings-me/parts";

/**
 * C4.1 — «المساعدة»: the guide, and «تواصل مع الإدارة» that opens (or makes) a private chat with the company's owner through the ordinary `dm` door. The owner's id is
 * given only to somebody who has a staff directory (an external partner gets none, so the button is not drawn for them) and never to the owner himself.
 */
export function HelpSection({ ownerId }: { ownerId: string | null }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function contact() {
    if (!ownerId) return;
    setBusy(true);
    try {
      const made = await apiPost<{ id: string }>("/api/chat/dm", { userId: ownerId });
      router.push(`/chat/${encodeURIComponent(made.id)}`);
    } catch {
      toast(t("settingsMe.h.contact.failed"), "error");
      setBusy(false);
    }
  }

  return (
    <div data-section-body="help">
      <Group rows>
        <Link href="/guide" className="flex min-h-14 items-center px-3.5 py-2 text-start transition-colors hover:bg-surface-2">
          <span>
            <span className="block text-[15px] font-medium text-fg">{t("settingsMe.h.guide")}</span>
            <span className="block text-[13px] text-fg-muted">{t("settingsMe.h.guide.hint")}</span>
          </span>
        </Link>
      </Group>
      {ownerId ? (
        <Group title={t("settingsMe.h.contact")} hint={t("settingsMe.h.contact.hint")}>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void contact()}>
            {t("settingsMe.h.contact")}
          </Button>
        </Group>
      ) : null}
    </div>
  );
}
