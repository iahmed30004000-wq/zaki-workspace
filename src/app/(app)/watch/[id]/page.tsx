import { notFound } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { getServerT } from "@/lib/i18n/server";
import { GuestNotice, placeRefusedToGuest } from "@/app/(app)/_guest";
import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";
import { watchDetail } from "@/server/services/watch";
import { WatchRoom } from "@/components/watch/watch-room";
import { startFromQuery } from "@/lib/watch/convert";

/** One «نتفرّج سوا» session, for the people it was started for (and the owner); anybody else: not found. */
export default async function WatchSessionPage({ params, searchParams = {} }: { params: { id: string }; searchParams?: { t?: string | string[] } }) {
  const { user, actor } = await pageActor();
  if (placeRefusedToGuest(actor, "watch")) return <GuestNotice />;
  // switched off in «الميزات»: the feature is not there at all
  if (!(await actorFeatureOn(actor, "watch"))) notFound();
  // the «نتفرّج سوا» row of the person's grid
  if (!actorCan(actor, "watch.view")) return <SectionOffNotice />;
  // a session of another space of theirs: enter that space first, so the name at the top says where it is
  const where = await db.watchSession.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (!where) notFound();
  // `?t=<second>`: a link from an idea, a task or a project made of a comment opens the video at that moment
  const startAt = startFromQuery(searchParams.t);
  await keepInSpace(actor, where.spaceId, `/watch/${params.id}${startAt !== null ? `?t=${startAt}` : ""}`);

  const ctx = { orgId: actor.orgId, orgRole: actor.role, userId: user.id };
  const session = await watchDetail(ctx, params.id).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  // «حوّل»: what this person's «الأقسام» boxes let them make (each door checks again); none while its switch is off. «الشركة» holds no
  // projects, so a session there offers no «مشروع».
  const convertOn = await actorFeatureOn(actor, "watchConvert");
  const space = convertOn ? await db.workspace.findUnique({ where: { id: session.spaceId }, select: { kind: true } }) : null;
  const convert = {
    idea: convertOn && actorCan(actor, "ideas.edit"),
    task: convertOn && actorCan(actor, "tasks.edit"),
    project: convertOn && actorCan(actor, "projects.edit") && space?.kind !== "HQ",
  };
  return <WatchRoom session={session} viewerId={user.id} startAt={startAt} convert={convert} />;
}

export const metadata = { title: getServerT().t("watch.title") };
export const dynamic = "force-dynamic";
