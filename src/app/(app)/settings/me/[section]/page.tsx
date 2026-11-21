import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import type { SectionCtx } from "@/components/control-panel/sections/board-sections";
import { CompanySection } from "@/components/control-panel/sections/company-section";
import { FeaturesSection } from "@/components/control-panel/sections/features-section";
import { IntegrationsSection } from "@/components/control-panel/sections/integrations-section";
import { SpacesSection } from "@/components/control-panel/sections/small-sections";
import { pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { actorCan } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { myHideLastSeen } from "@/server/services/last-seen";
import { avatarHue } from "@/lib/format";
import { ChatFoldersSettings } from "@/components/chat/v2/list/folder-editor";
import { ProfileForm } from "@/components/profile-form";
import { ChatSection } from "@/components/settings-me/chat-section";
import { DataSection } from "@/components/settings-me/data-section";
import { DevicesSection } from "@/components/settings-me/devices-section";
import { HelpSection } from "@/components/settings-me/help-section";
import { LanguageSection } from "@/components/settings-me/language-section";
import { MenuSection } from "@/components/settings-me/menu-section";
import { NotificationsSection } from "@/components/settings-me/notifications-section";
import { BackLink, SectionHead, Group } from "@/components/settings-me/parts";
import { PrivacySection } from "@/components/settings-me/privacy-section";
import { companyAccessFor, contactOwnerId, menuFor } from "@/components/settings-me/server-data";
import { isCompanySectionKey, isSectionKey, PANEL_SECTION_OF, type CompanySectionKey } from "@/components/settings-me/sections";
import { ShortcutsSection } from "@/components/settings-me/shortcuts-section";

/**
 * C4.1 — one section of «إعداداتي» (`/settings/me/<section>`). Everything here is the person's OWN: the company's switches are not (they are A2's, in `/settings`).
 * An unknown section, and «المجلدات» while the company's switch `chatFolders` is off, are «not found».
 */
export default async function SettingsMeSectionPage({ params, searchParams }: { params: { section: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { user, actor } = await pageActor();
  const section = params.section;
  // S3.1: a section of «إعدادات الشركة» (the control panel's own body, MOVED here): only while «الإعدادات» is ONE door, only a section the panel offers this person (its own
  // capability checks), and the body decides again on its own. Anything else is «not found» (with the switch off the address does not exist at all).
  if (isCompanySectionKey(section)) return CompanySectionPage({ actor, section, searchParams: searchParams ?? {} });
  if (!isSectionKey(section)) notFound();

  let body: React.ReactNode;
  switch (section) {
    case "account": {
      const me = await db.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true, jobTitle: true, bio: true, locale: true, avatarUrl: true } });
      if (!me) notFound();
      // «الصورة الشخصية» switched off: the form does not offer it, and the upload route answers «not found»
      const withPicture = await actorFeatureOn(actor, "avatars");
      body = (
        <ProfileForm
          embedded
          me={{ ...me, hue: avatarHue(me.name) }}
          withPicture={withPicture}
          identity={{ username: user.username, usernameManaged: actorCan(actor, "users.manage") }}
        />
      );
      break;
    }
    case "notifications":
      body = <NotificationsSection />;
      break;
    case "privacy": {
      // «إخفاء آخر ظهوري»: offered while the company's switch is on, never to an external partner (the same rule as the old profile page)
      const lastSeen = !actor.isExternal && (await actorFeatureOn(actor, "lastSeen")) ? { hide: await myHideLastSeen(actor.orgId, actor.userId) } : null;
      body = <PrivacySection lastSeen={lastSeen} />;
      break;
    }
    case "chat":
      body = <ChatSection />;
      break;
    case "folders":
      if (!(await actorFeatureOn(actor, "chatFolders"))) notFound();
      body = (
        <Group>
          <ChatFoldersSettings guest={actor.isExternal} />
        </Group>
      );
      break;
    case "data":
      body = <DataSection />;
      break;
    case "devices":
      body = <DevicesSection appConnection={await actorFeatureOn(actor, "appConnection")} />;
      break;
    case "language":
      body = <LanguageSection />;
      break;
    case "menu": {
      const menu = await menuFor(actor);
      body = <MenuSection places={menu.places} tabs={menu.tabs} locked={menu.locked} />;
      break;
    }
    case "shortcuts":
      body = <ShortcutsSection />;
      break;
    case "help":
      body = <HelpSection ownerId={await contactOwnerId(actor)} />;
      break;
  }

  return (
    <div data-settings-section={section} className="pb-8">
      <SectionHead section={section} />
      {body}
    </div>
  );
}

/** The section bodies of the control panel, one per company section (src/components/control-panel/sections/*: reused as they are). */
async function companyBody(section: CompanySectionKey, ctx: SectionCtx) {
  switch (section) {
    case "company":
      return CompanySection({ ctx });
    case "features":
      return FeaturesSection({ ctx });
    case "integrations":
      return IntegrationsSection({ ctx });
    case "spaces":
      return SpacesSection({ ctx });
  }
}

async function CompanySectionPage({ actor, section, searchParams }: { actor: Awaited<ReturnType<typeof pageActor>>["actor"]; section: CompanySectionKey; searchParams: Record<string, string | string[] | undefined> }) {
  const found = await companyAccessFor(actor);
  if (!found || !found.group.sections.includes(section) || !found.access.sections.includes(PANEL_SECTION_OF[section])) notFound();
  const { t } = getServerT();
  // `oneDoor`: the body is drawn inside the settings frame, so its own links point at the frame (S3.3)
  const ctx: SectionCtx = { actor, userId: actor.userId, access: found.access, searchParams, t, oneDoor: true };
  return (
    <div data-settings-section={section} data-settings-company="" className="pb-8">
      <BackLink />
      <div className="p-3 md:p-0">{await companyBody(section, ctx)}</div>
    </div>
  );
}

export const dynamic = "force-dynamic";
