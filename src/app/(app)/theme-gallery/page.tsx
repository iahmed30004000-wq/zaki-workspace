import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice } from "@/app/(app)/_guest";
import { ThemeGalleryLoader } from "@/components/theme/gallery/gallery-loader";
import { getServerT } from "@/lib/i18n/server";
import { actorFeatureOn, isEconomyOn } from "@/server/services/features";

/** The browser tab says «معرض مفاتيح المظهر» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("gallery.title") };

/**
 * «معرض مفاتيح المظهر» — the six showcase variants of the day/night switch, full screen.
 *
 * The page decides nothing about data (there is none: every number in it is fake). WHO may open it: staff only (an external partner
 * gets the notice), and only while the company's `themeSwitchFx` switch is on — off, the page is «not found» and no effect code is
 * ever sent. The scenes are lazy chunks of the gallery component, fetched one at a time.
 */
export default async function ThemeGalleryPage() {
  const { actor } = await pageActor();
  if (actor.isExternal) return <GuestNotice />;
  if (!(await actorFeatureOn(actor, "themeSwitchFx"))) notFound();
  return <ThemeGalleryLoader economy={await isEconomyOn(actor.orgId)} />;
}

export const dynamic = "force-dynamic";
