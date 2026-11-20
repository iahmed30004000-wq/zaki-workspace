"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ManagerPicker, type ManagerChoice } from "@/components/members/manager-picker";
import { devErrorText } from "@/components/team-development/errors";

/**
 * «غيّر المسؤول» in «الهيكل» — one person's direct manager, chosen in the SAME `ManagerPicker` the people sheet uses (A1.3),
 * so the list, the order and the empty answer «بدون مسؤول مباشر» are the same on both screens. The choice is saved through
 * `PUT /api/team-development/lines/<id>` (one service path with the people screen: `assertManager` plus the rank limit).
 * Drawn only for the people the viewer may change (`StructureNode.canEdit`).
 *
 * `options` are everybody but the person and the people below them (the server refuses a loop or a chain deeper than 6 anyway).
 */
export function ManagerLine({
  userId,
  name,
  current,
  options,
  defaultOpen = false,
}: {
  userId: string;
  name: string;
  current: string | null;
  options: ManagerChoice[];
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiPut(`/api/team-development/lines/${userId}`, { managerId: value === "" ? null : value });
      toast(t("teamdev.lines.saved"), "success");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`${t("teamdev.lines.change")}: ${name}`} data-change-supervisor={userId}>
        <UserCog className="size-4" aria-hidden />
        {t("teamdev.lines.change")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ManagerPicker id={`sup-${userId}`} value={value} onChange={setValue} options={options} label={`${t("teamdev.lines.supervisor")}: ${name}`} className="w-auto" />
      <Button type="submit" size="sm" disabled={busy}>
        {t("common.save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
