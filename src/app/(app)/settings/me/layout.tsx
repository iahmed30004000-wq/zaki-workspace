import { pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { isFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import { visibleSections } from "@/components/settings-me/sections";
import { companyAccessFor } from "@/components/settings-me/server-data";

/** The browser tab says «إعداداتي» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("settingsMe.title") };

/**
 * C4.1 — «إعداداتي»: the frame of every `/settings/me/…` page. The person's own settings (what they choose for themselves), never the company's: those stay in
 * `/settings`. Each page still asks for the signed-in person itself (`pageActor`): in Next a page renders beside its layout.
 */
export default async function SettingsMeLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await pageActor();
  const [me, foldersOn, company] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, username: true, jobTitle: true, avatarUrl: true } }),
    isFeatureOn(actor.orgId, "chatFolders"),
    // S3.1: «إعدادات الشركة», the second group, only while «الإعدادات» is ONE door and the person holds a section of the control panel (null: the frame is as it was)
    companyAccessFor(actor),
  ]);
  const header = { name: me?.name ?? user.name, username: me?.username ?? user.username, jobTitle: me?.jobTitle ?? null, avatarUrl: me?.avatarUrl ?? null };
  return (
    <SettingsFrame header={header} sections={visibleSections({ foldersOn })} company={company?.group ?? null}>
      {children}
    </SettingsFrame>
  );
}

export const dynamic = "force-dynamic";
