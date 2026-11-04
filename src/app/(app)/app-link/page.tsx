import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { isFeatureOn } from "@/server/services/features";
import { AppLink } from "@/components/app-link/app-link";

/** The browser tab says «ربط التطبيق» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("appLink.title") };

/**
 * ربط التطبيق — pairs this phone with the Android app (the live line for full-screen rings and instant notifications). The app opens it
 * with `?app=1` the first time, and the pairing happens by itself; everybody else pairs with the button. Off (the switch) = «not found».
 */
export default async function AppLinkPage({ searchParams }: { searchParams: { app?: string } }) {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (!(await isFeatureOn(actor.orgId, "appConnection"))) notFound();
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 p-4 md:p-6">
      <h1 className="text-2xl font-bold text-fg">{t("appLink.title")}</h1>
      <AppLink auto={searchParams.app === "1"} />
    </div>
  );
}

export const dynamic = "force-dynamic";
