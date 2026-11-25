import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { chatDirectory } from "@/server/chat/directory";
import { botFatherOffered } from "@/server/services/botfather";
import { getServerT } from "@/lib/i18n/server";
import { ContactsScreen } from "@/components/contacts/contacts-screen";

/**
 * «جهات الاتصال» (S6.3): Telegram's contacts screen, the second tab of the bottom bar. The same people the chat's directory lists (the active non-guests, the last seen the
 * company and each person allow), for whoever may look at the staff directory (`directory.view`); an external partner gets the notice they always had on `/members`.
 */
export default async function ContactsPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (actor.isExternal) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-border bg-surface-1 p-8 text-center">
          <h1 className="text-base font-semibold text-fg">{t("guest.no_access")}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t("orgm.members_only")}</p>
        </div>
      </div>
    );
  }
  if (!actorCan(actor, "directory.view")) return <SectionOffNotice />;
  const everyone = await chatDirectory(actor.orgId, undefined, actor.userId, actor.role);
  const people = everyone.filter((p) => p.userId !== actor.userId);
  const botFather = await botFatherOffered(actor.orgId, actor.role);
  return <ContactsScreen people={people} now={new Date().toISOString()} botFather={botFather} />;
}

export const dynamic = "force-dynamic";
