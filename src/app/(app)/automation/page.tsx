import { Suspense } from "react";
import { pageActor, presentedRole } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { AutomationView } from "@/components/automation-view";
import { ApiDoorCard } from "@/components/api-door-card";
import { actorCan } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";

export default async function AutomationPage() {
  const { actor } = await pageActor();
  // staff only on the map (its routes already refuse a guest): the notice, not an empty automation view
  if (refusedToGuest(actor, "automation")) return <GuestNotice />;

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  // «باب الربط الخارجي»: the tokens card, only for whoever holds the switch, and only while the owner's «الميزات» switch is on
  const showDoor = actorCan(actor, "integrations.manage") && (await isFeatureOn(actor.orgId, "apiDoor"));

  return (
    <>
      <Suspense fallback={null}>
        <AutomationView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} />
      </Suspense>
      {showDoor ? (
        <div className="mx-auto max-w-5xl px-6 pb-6">
          <ApiDoorCard />
        </div>
      ) : null}
    </>
  );
}

export const dynamic = "force-dynamic";
