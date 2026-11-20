"use client";

import { useState } from "react";
import { apiPatch, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { SwitchRow } from "@/components/members/switch-row";

/**
 * «إخفاء آخر ظهوري» on one's own profile page (`PATCH /api/me/last-seen`). ⚠️ The warning and its fix 🔧 are drawn
 * together: hiding one's own «آخر ظهور» also hides everybody else's from the person (like a messenger), and it can be
 * undone here at any time. Online status (the green dot) is not affected.
 */
export function LastSeenToggle({ initialHide, bare = false }: { initialHide: boolean; /** inside a settings card already: no card of its own */ bare?: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [hide, setHide] = useState(initialHide);
  const [busy, setBusy] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    try {
      await apiPatch("/api/me/last-seen", { hide: next });
      setHide(next);
      toast(t("lastSeen.hide.saved"), "success");
    } catch (err) {
      const key = err instanceof ApiError && err.messageKey && t(err.messageKey) !== err.messageKey ? err.messageKey : "";
      toast(key ? t(key) : t("lastSeen.hide.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-last-seen-toggle className={bare ? undefined : "rounded-[14px] bg-surface-1 p-1"}>
      <SwitchRow
        checked={hide}
        busy={busy}
        onChange={(next) => void change(next)}
        title={t("lastSeen.hide.title")}
        hint={t("lastSeen.hide.hint")}
        note={
          <>
            <span className="block text-warn">{t("lastSeen.hide.warning")}</span>
            <span className="block text-fg-muted">{t("lastSeen.hide.fix")}</span>
          </>
        }
      />
    </section>
  );
}
