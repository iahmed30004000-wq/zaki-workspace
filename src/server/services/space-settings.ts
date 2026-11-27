import { NotFoundError } from "@/server/auth";
import { db } from "@/server/db";
import type { Actor } from "@/server/policy/actor";
import { actorFeatureOn, isFeatureOn } from "@/server/services/features";
import { spacesOf } from "@/server/services/current-space";
import { mayOverview } from "@/server/services/spaces-overview";
import { orgTimeZone } from "@/server/services/org-day";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import { SPACE_STARTER_TOPICS } from "@/server/chat/space-topics";
import { isSpaceManager } from "@/server/workspace-role";
import { settingsTabsFor, type SettingsFacts, type SpaceSettingsTab } from "@/components/space-settings/tabs";

/**
 * «إعدادات المساحة» as one answer (A2.2): who the person is to the space (`facts`), the tabs they are offered, and what the read-only tabs show — the
 * space's name, description, emoji and layout, the topics every space starts with, the columns a new board starts with and which work parts are on.
 * ONE function for the page (/spaces/[id]/settings) and the phone's door (GET /api/spaces/[id]/settings); every control behind it decides again on the server.
 *
 * «Not found», never «forbidden», for: the switch `controlPanelV2` off, an external partner, and a space the person cannot open (another company's, one
 * they were never put in, an archived one, one that does not exist). The OWNER opens every space of the company without a row.
 */
export interface SpaceSettings {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  layout: string;
  /** A department's space takes its name and description from the department. */
  department: boolean;
  facts: SettingsFacts;
  tabs: SpaceSettingsTab[];
  starters: { title: string; emoji: string; postingPolicy: "ALL" | "ADMINS" }[];
  work: { timeZone: string; columns: { name: string; stage: string }[]; stagesOn: boolean; parts: { checkins: boolean; customFields: boolean; approvals: boolean } };
}

export async function spaceSettingsFor(actor: Actor, spaceId: string): Promise<SpaceSettings> {
  if (!(await actorFeatureOn(actor, "controlPanelV2"))) throw new NotFoundError("workspace.not_found");
  if (actor.isExternal) throw new NotFoundError("workspace.not_found");
  const entry = (await spacesOf(actor)).find((space) => space.id === spaceId);
  if (!entry) throw new NotFoundError("workspace.not_found");
  const facts: SettingsFacts = {
    external: false,
    manager: isSpaceManager(actor.role, entry.role),
    canArchive: mayOverview(actor) && entry.kind !== "HQ",
    canDelete: actor.role === "OWNER" && entry.kind !== "HQ",
  };
  const info = await db.workspace.findFirst({ where: { id: entry.id, organizationId: actor.orgId }, select: { name: true, description: true, emoji: true } });
  if (!info) throw new NotFoundError("workspace.not_found");
  const [timeZone, stagesOn, checkins, customFields, approvals] = await Promise.all([
    orgTimeZone(actor.orgId),
    isFeatureOn(actor.orgId, "workStages"),
    isFeatureOn(actor.orgId, "checkins"),
    isFeatureOn(actor.orgId, "customFields"),
    isFeatureOn(actor.orgId, "approvals"),
  ]);
  return {
    id: entry.id,
    name: info.name,
    description: info.description,
    emoji: info.emoji,
    layout: entry.layout,
    department: entry.kind === "DEPARTMENT",
    facts,
    tabs: settingsTabsFor(facts),
    starters: SPACE_STARTER_TOPICS.map((topic) => ({ title: topic.title, emoji: topic.emoji, postingPolicy: topic.postingPolicy })),
    work: { timeZone, columns: DEFAULT_BOARD_COLUMNS.map((column) => ({ name: column.name, stage: column.stage })), stagesOn, parts: { checkins, customFields, approvals } },
  };
}
