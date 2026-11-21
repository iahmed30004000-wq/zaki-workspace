"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { WorkspaceTeamsPanel } from "@/components/space-settings/teams-panel";
import { useI18n } from "@/lib/i18n";

/**
 * «المقاطع» — the teams inside this space, in a dialog (the way it always was; with the switch `controlPanelV2` ON the same content is the tab «المقاطع» of the
 * space's settings page, `WorkspaceTeamsPanel`). A manager of the space opens teams, puts the space's people in and out, and deletes an empty team; anybody
 * else sees the teams they are in, read-only. The server decides everything again (src/server/services/teams.ts).
 */
export function WorkspaceTeamsButton({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" data-ws-teams-open onClick={() => setOpen(true)}>
        <UsersRound className="size-4 text-accent" />
        {t("spaceteams.title")}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("spaceteams.title")}>
          <WorkspaceTeamsPanel workspaceId={workspaceId} onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}
