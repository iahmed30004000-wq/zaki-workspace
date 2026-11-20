import { Suspense } from "react";
import { presentedRole } from "@/app/(app)/_access";
import { AutomationView } from "@/components/automation-view";
import { ApiDoorCard } from "@/components/api-door-card";
import { DbBackupCard } from "@/components/db-backup-card";
import { MailToTaskCard } from "@/components/mail-to-task-card";
import { OmsLinkCard } from "@/components/oms-link-card";
import { TelegramView } from "@/components/telegram-view";
import { actorCan, type Actor } from "@/server/policy/actor";
import { listChats } from "@/server/services/telegram";

/**
 * The bodies of /automation and /telegram, MOVED (A2.1) so the section «التكاملات» of the control panel draws the very same cards: n8n and the workflows, Google Drive,
 * the API door's tokens, the encrypted backup, mail → task, the link to the orders system, and the Telegram bot. The caller decided who may look (a guest never; the panel:
 * `integrations.manage`); the owner-only cards stay owner-only here (the owner's alone: the backup, the mailbox, the orders system's token), and every route behind them decides again.
 */
export function AutomationBody({ actor }: { actor: Actor }) {
  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  // «باب الربط الخارجي»: the tokens card, for whoever holds the switch. While the owner's «الميزات» switch is off the card only lists
  // and revokes (the list answer says `switchOn`): a leaked token must stay killable.
  const showDoor = actorCan(actor, "integrations.manage");
  // «نسخ احتياطي لقاعدة البيانات»: the OWNER alone (a space admin never sees the card; its routes answer 403 anyway)
  const showBackup = actor.isOwner;
  // «بريد يصير مهمة»: the OWNER's card too (the mailbox password is his alone to type)
  // «ربط نظام الطلبات»: the OWNER's card too (the system token is his alone to paste)
  return (
    <Suspense fallback={null}>
      <AutomationView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} doorCard={showDoor ? <ApiDoorCard /> : null} backupCard={showBackup ? <DbBackupCard /> : null} mailCard={showBackup ? <MailToTaskCard /> : null} omsCard={showBackup ? <OmsLinkCard /> : null} />
    </Suspense>
  );
}

export async function TelegramBody({ actor }: { actor: Actor }) {
  const chats = await listChats(actor.orgId);
  const initial = chats
    ? {
        chats: {
          chats: chats.chats.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
          lastSyncAt: chats.lastSyncAt?.toISOString() ?? null,
        },
        botUsername: (chats.config as { botUsername?: string })?.botUsername ?? null,
      }
    : { chats: null, botUsername: null };

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  return <TelegramView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} initial={initial} />;
}
