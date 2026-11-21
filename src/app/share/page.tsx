import type { Metadata } from "next";
import { pageActor } from "@/app/(app)/_access";
import { ShareEmpty, SharePicker } from "@/components/pwa/share-picker";
import { AR } from "@/lib/i18n/dict";
import { firstParam, sharedTextFrom } from "@/lib/pwa/share";

export const metadata: Metadata = { title: AR["mobile.share.title"] ?? "" };

/**
 * M1a — `/share?title=&text=&url=`: where the phone's share sheet lands (the manifest's `share_target`, a GET). Signed-in people only (`pageActor`; the sign-in
 * redirect keeps the query, so a share made while signed out is not lost). The words are cleaned (`sharedTextFrom`) and handed to the picker, which asks WHICH
 * conversation and puts them in its composer as a draft: NOTHING is sent from here. The page lives outside the app frame on purpose (no side menu, no bottom
 * bar: it is a sheet, like the system's own).
 */
export default async function SharePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const text = sharedTextFrom({ title: firstParam(searchParams["title"]), text: firstParam(searchParams["text"]), url: firstParam(searchParams["url"]) });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-surface pt-[env(safe-area-inset-top)] text-fg">
      {text ? <SharePicker userId={actor.userId} text={text} /> : <ShareEmpty />}
    </main>
  );
}

export const dynamic = "force-dynamic";
