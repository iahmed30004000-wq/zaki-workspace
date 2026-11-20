"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { WorkspaceMembersPanel } from "@/components/space-settings/people-panel";
import { useI18n } from "@/lib/i18n";

/**
 * "أعضاء المساحة" — the people IN this space, in a dialog (the way it always was; with the switch `controlPanelV2` ON the same content is the tab «الناس» of the
 * space's settings page, `WorkspaceMembersPanel`). The panel asks the server only while the dialog is open.
 */
export function WorkspaceMembersButton({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" data-ws-members-open onClick={() => setOpen(true)}>
        <Users className="size-4 text-accent" />
        {t("ws.members")}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("ws.members_title")}>
          <WorkspaceMembersPanel workspaceId={workspaceId} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}
