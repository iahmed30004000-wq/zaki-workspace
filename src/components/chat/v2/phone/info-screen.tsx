"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { InfoPanel } from "@/components/chat/v2/info/info-panel";
import { PaneUnavailable } from "@/components/chat/v2/pane/conversation-pane";
import { useOptionalToast } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { useChatHeader } from "@/lib/chat/cache/selectors";
import { ct } from "@/lib/chat/text";
import { callDoor, doors } from "@/lib/chat/v2/pane/message-actions";
import { usePeople } from "@/lib/chat/v2/pane/use-people";
import { markPendingSearch } from "@/lib/chat/v2/phone/pending-search";
import { usePhoneBack } from "@/lib/chat/v2/phone/use-phone-back";
import { chatHref } from "@/lib/chat/v2/routes";
import { useIsDesktop } from "@/lib/chat/v2/use-media";

/**
 * C2.8 — THE PHONE'S INFO SCREEN (`/chat/<id>/info`): the same panel body the computer draws as a column and a tablet as a sheet (`InfoPanel`, C2.7), full
 * screen under its own 56 px bar (a back arrow to the conversation, the title). It is handed what it can DO — a topic change through the topics door, with
 * the server deciding again — and it reads the header and the people from the cache the conversation already filled, so it opens at once.
 *
 * A computer has no such screen (the panel is its side column): the address goes back to the conversation. Until the screen size is known nothing is drawn
 * (the server and the first client render agree). The «🔍 بحث» button returns to the conversation, where the header's search is one tap away.
 */
export function PhoneInfoScreen({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { go, onLinkClick } = usePhoneBack();
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const desktop = useIsDesktop();
  const headerQuery = useChatHeader(conversationId);
  const header = headerQuery.data;
  const people = usePeople(conversationId, header?.memberCount);
  const back = chatHref.conversation(conversationId);

  React.useEffect(() => {
    if (desktop === true) router.replace(back);
  }, [desktop, router, back]);

  if (desktop !== false) return null;
  if (!header) {
    if (headerQuery.isError) return <PaneUnavailable error={headerQuery.error} retry={() => void headerQuery.refetch()} />;
    return (
      <section data-chat-info-screen="loading" className="flex h-full min-h-0 flex-col bg-surface">
        <InfoBar back={back} onBack={onLinkClick(back)} />
        <p role="status" className="p-6 text-center text-sm text-fg-muted">
          {ct("chatc.loading")}
        </p>
      </section>
    );
  }

  const refreshHeader = () => {
    void qc.invalidateQueries({ queryKey: chatKeys.header(header.id), exact: true });
    scheduleSync(qc);
  };
  const topicCall = (patch: { closed?: boolean; archived?: boolean }) =>
    void callDoor(doors.topic(header.id, patch)).then((result) => {
      if (result.ok) {
        toast?.toast(ct("chath.menu.done"), "success");
        refreshHeader();
      } else toast?.toast(ct(result.message ?? "chatc.menu.failed"), "error");
    });

  return (
    <section data-chat-info-screen="ready" aria-label={ct("chatui.phone.info.label")} className="flex h-full min-h-0 flex-col bg-surface">
      <InfoBar back={back} onBack={onLinkClick(back)} />
      <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <InfoPanel header={header} people={people} onSearch={() => {
            // the search lives in the conversation: leave a note for its pane and go back to it
            markPendingSearch(conversationId);
            go(back);
          }} onTopic={topicCall} onSettingsSaved={refreshHeader} />
      </div>
    </section>
  );
}

/** The bar: under the notch, 56 px, a 44 px back arrow at the start and the screen's name. */
function InfoBar({ back, onBack }: { back: string; onBack: (event: React.MouseEvent) => void }) {
  return (
    <header data-chat-info-bar="" className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-1 px-1">
        <Link href={back} aria-label={ct("chatc.back")} onClick={onBack} className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{ct("chatui.phone.info.label")}</h1>
      </div>
    </header>
  );
}
