"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InfoDock } from "@/components/chat/v2/info/info-frame";
import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { useInfoSlot } from "@/components/chat/v2/info/info-slot";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { chatKeys } from "@/lib/chat/cache/keys";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { ct } from "@/lib/chat/text";
import { useIsWide } from "@/lib/chat/v2/info/use-wide";
import { doors } from "@/lib/chat/v2/pane/message-actions";
import { usePeople } from "@/lib/chat/v2/pane/use-people";
import { chatHref } from "@/lib/chat/v2/routes";
import { useIsDesktop } from "@/lib/chat/v2/use-media";

/**
 * C2.4 — SEAM 4: the info panel. C2.7 FILLED IT. The header's title only toggles `infoOpen` in the pane's actions (`pane-actions.tsx`); this reads it and
 * draws `InfoPanel` (ONE body, `components/chat/v2/info/`, which C2.8's phone route mounts too):
 *
 *   from 1024 px   a 360 px column beside the conversation: the panel is portaled into the column the chat shell draws (`InfoSlotContext`), so it pushes
 *                  the conversation aside and no file of the pane's layout changes;
 *   768 to 1023 px an overlay sheet from the END side;
 *   below 768 px   (the phone, C2.8) NOT a sheet: the same panel is its own screen `/chat/<id>/info` (`phone/info-screen.tsx`), so this host closes itself and
 *                  goes there.
 *
 * It reads only the header and the pane's actions; the people come from the SAME cache entry the pane already asked for (one request per conversation,
 * shared), and nothing else is asked for while the panel is closed. The server decides every action again; a refusal is a toast through the pane's `call`.
 */
export function InfoHost({ header }: { header: ConversationHeaderDto }) {
  const a = usePaneActions();
  const qc = useQueryClient();
  const slot = useInfoSlot();
  const wide = useIsWide();
  const people = usePeople(header.id, header.memberCount);
  const router = useRouter();
  const desktop = useIsDesktop();
  // C2.8: on a phone the info is a screen of its own, not a sheet over the conversation (`desktop === false` only when the screen size is known to be below 768 px)
  const toScreen = a.infoOpen && desktop === false;
  const { closeInfo } = a;
  React.useEffect(() => {
    if (!toScreen) return;
    closeInfo();
    router.push(chatHref.info(header.id));
  }, [toScreen, closeInfo, router, header.id]);
  if (!a.infoOpen) return null;
  if (toScreen) return null;

  const docked = wide === true && slot !== null;
  const topicCall = (patch: { closed?: boolean; archived?: boolean }) =>
    void a.call(doors.topic(header.id, patch), "chath.menu.done").then((ok) => {
      if (ok) void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
    });
  const panel = (onClose?: () => void) => (
    <InfoPanel
      header={header}
      people={people}
      onSearch={() => {
        // on the sheet the search would sit behind it: close the sheet first
        if (!docked) a.closeInfo();
        a.openSearch();
      }}
      onTopic={topicCall}
      onSettingsSaved={() => {
        void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
        scheduleSync(qc);
      }}
      {...(onClose ? { onClose } : {})}
    />
  );

  if (docked && slot) return createPortal(<InfoDock>{panel(a.closeInfo)}</InfoDock>, slot);
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : a.closeInfo())}>
      <SheetContent side="end" className="md:w-[22.5rem]">
        <SheetHeader>
          <SheetTitle>{ct("chatui.pane.menu.info")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col px-0 pb-0">{panel()}</SheetBody>
      </SheetContent>
    </Sheet>
  );
}
