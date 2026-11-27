import { notFound } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { GuestNotice, placeRefusedToGuest } from "@/app/(app)/_guest";
import { watchHome } from "@/server/services/watch";
import { WatchHome, type WatchCard } from "@/components/watch/watch-home";

/** «نتفرّج سوا» of the space the person is in: start one, and the sessions they were started for. */
export default async function WatchPage() {
  const { actor } = await pageActor();
  // the sessions are the team's own talk: not an external partner's (the place is not offered to them, /api/watch refuses)
  if (placeRefusedToGuest(actor, "watch")) return <GuestNotice />;
  // switched off in «الميزات»: the feature is not there at all
  if (!(await actorFeatureOn(actor, "watch"))) notFound();
  // the «نتفرّج سوا» row of the person's grid
  if (!actorCan(actor, "watch.view")) return <SectionOffNotice />;

  // the same read the phone's door makes (GET /api/watch/home)
  const { sessions, candidates, canStart } = await watchHome(actor);
  const initial: WatchCard[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    thumbUrl: s.thumbUrl,
    host: s.host,
    peopleCount: s.peopleCount,
    live: s.live,
    createdAt: s.createdAt,
  }));

  return <WatchHome initial={initial} candidates={candidates} canStart={canStart} />;
}

export const metadata = { title: getServerT().t("watch.title") };
export const dynamic = "force-dynamic";
