import { Suspense } from "react";
import { pageActor, presentedRole } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { AutomationView } from "@/components/automation-view";
import { ApiDoorCard } from "@/components/api-door-card";
import { actorCan } from "@/server/policy/actor";

export default async function AutomationPage() {
  const { actor } = await pageActor();
  // staff only on the map (its routes already refuse a guest): the notice, not an empty automation view
  if (refusedToGuest(actor, "automation")) return <GuestNotice />;

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  // «باب الربط الخارجي»: the tokens card, for whoever holds the switch. While the owner's «الميزات» switch is off the card only lists
  // and revokes (the list answer says `switchOn`): a leaked token must stay killable.
  const showDoor = actorCan(actor, "integrations.manage");

  return (
    <Suspense fallback={null}>
      <AutomationView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} doorCard={showDoor ? <ApiDoorCard /> : null} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
