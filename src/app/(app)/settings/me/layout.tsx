import { pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { isFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import { visibleSections } from "@/components/settings-me/sections";
import { companyAccessFor } from "@/components/settings-me/server-data";
import { soundLibraryOn } from "@/server/services/sounds";
// the sections of «تيليجرام على التلفون» (the sounds library is listed on a phone only)
import "@/components/settings-me/tg-settings.css";

/** The browser tab says «إعداداتي» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("settingsMe.title") };

/**
 * C4.1 — «إعداداتي»: the frame of every `/settings/me/…` page. The person's own settings (what they choose for themselves), never the company's: those stay in
 * `/settings`. Each page still asks for the signed-in person itself (`pageActor`): in Next a page renders beside its layout.
 */
export default async function SettingsMeLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await pageActor();
  const [me, foldersOn, speechOn, soundsOn, company, tabBarOn] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, username: true, jobTitle: true, avatarUrl: true } }),
    isFeatureOn(actor.orgId, "chatFolders"),
    isFeatureOn(actor.orgId, "tgPhone"),
    soundLibraryOn(actor),
    // S3.1: «إعدادات الشركة», the second group, only while «الإعدادات» is ONE door and the person holds a section of the control panel (null: the frame is as it was)
    companyAccessFor(actor),
    isFeatureOn(actor.orgId, "tgTabBar"),
  ]);
  const header = { name: me?.name ?? user.name, username: me?.username ?? user.username, jobTitle: me?.jobTitle ?? null, avatarUrl: me?.avatarUrl ?? null };
  return (
    <SettingsFrame header={header} sections={visibleSections({ foldersOn, speechOn, soundsOn })} company={company?.group ?? null} profileApart={tabBarOn && !actor.isExternal}>
      {children}
    </SettingsFrame>
  );
}

export const dynamic = "force-dynamic";
