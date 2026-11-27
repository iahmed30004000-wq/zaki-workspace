import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { actorFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { PROFILE_EDIT_HREF, ProfileScreen } from "@/components/profile/profile-screen";

export const metadata = { title: getServerT().t("profileScreen.title") };

/**
 * «الملف الشخصي». With «شريط تيليجرام السفلي» (`tgTabBar`) it is a page of its own, the last tab of the bar (the owner, 2026-11-27). Without the bar, and for
 * an external partner (who never has it), the old address keeps working as before: «حسابي», the first section of «إعداداتي», so a saved link ends there.
 * A signed-out visitor goes to the sign-in, as before.
 */
export default async function ProfilePage() {
  const { user, actor } = await pageActor();
  if (actor.isExternal || !(await actorFeatureOn(actor, "tgTabBar"))) redirect(PROFILE_EDIT_HREF);
  const [me, withPicture] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, jobTitle: true, bio: true, email: true, avatarUrl: true } }),
    actorFeatureOn(actor, "avatars"),
  ]);
  if (!me) redirect(PROFILE_EDIT_HREF);
  const { t } = getServerT();
  return (
    <ProfileScreen
      person={{ name: me.name, username: user.username ?? null, jobTitle: me.jobTitle, bio: me.bio, email: me.email, avatarUrl: withPicture ? me.avatarUrl : null }}
      withPicture={withPicture}
      words={{
        title: t("profileScreen.title"),
        photo: t("profileScreen.photo"),
        edit: t("profileScreen.edit"),
        settings: t("profileScreen.settings"),
        username: t("profileScreen.username"),
        job: t("profileScreen.job"),
        bio: t("profileScreen.bio"),
        email: t("profileScreen.email"),
      }}
    />
  );
}

export const dynamic = "force-dynamic";
