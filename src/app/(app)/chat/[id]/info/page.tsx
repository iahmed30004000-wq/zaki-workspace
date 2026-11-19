import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { PhoneInfoScreen } from "@/components/chat/v2/phone/info-screen";
import { paneSwitch } from "@/lib/chat/v2/pane/switch";
import { chatHref } from "@/lib/chat/v2/routes";

/**
 * C2.8 — the phone's info screen of one conversation (the panel body of C2.7, full screen). It exists only with the owner's switch «شاشة الدردشة الجديدة»
 * (`chatLayoutV2`) ON; OFF — as merged — the address goes to today's conversation page, which has no such screen. A computer never stays here: the panel is
 * its side column, so the client sends it back to the conversation. Who may read the conversation is decided again by the chat API (404 for anyone outside
 * its audience), exactly as for the conversation page; nothing is read on the server here.
 */
export default async function ChatInfoPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  if (!(await paneSwitch(actor))) redirect(chatHref.conversation(params.id));
  return <PhoneInfoScreen conversationId={params.id} />;
}

export const dynamic = "force-dynamic";
