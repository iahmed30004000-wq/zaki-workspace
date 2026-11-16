"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

/** «خلّي المهام المسندة المفتوحة خاصة»: shows how many tasks it would change, then asks once. */
export function TaskPrivacyBulkButton({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    try {
      setCount((await apiGet<{ count: number }>(`/api/workspaces/${workspaceId}/private-tasks`)).count);
    } catch (err) {
      const shown = err instanceof ApiError && err.messageKey ? t(err.messageKey) : "";
      toast(shown && shown !== (err instanceof ApiError ? err.messageKey : "") ? shown : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await apiPost<{ changed: number }>(`/api/workspaces/${workspaceId}/private-tasks`, {});
      toast(t("taskpriv.bulk_done", { n: res.changed }), "success");
      setCount(null);
    } catch (err) {
      const shown = err instanceof ApiError && err.messageKey ? t(err.messageKey) : "";
      toast(shown && shown !== (err instanceof ApiError ? err.messageKey : "") ? shown : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (count === null) {
    return (
      <Button type="button" variant="secondary" onClick={ask} disabled={busy}>
        <Lock className="h-4 w-4" /> {t("taskpriv.bulk_button")}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-fg">{count === 0 ? t("taskpriv.bulk_none") : t("taskpriv.bulk_confirm", { n: count })}</span>
      {count > 0 ? (
        <Button type="button" onClick={confirm} disabled={busy}>
          {t("taskpriv.bulk_yes")}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" onClick={() => setCount(null)} disabled={busy}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
