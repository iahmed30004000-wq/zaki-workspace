import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { ChatScreen } from "@/components/owner-assistant/chat";
import { NotFoundError } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { db } from "@/server/db";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { getConversation, listConversations } from "@/server/services/owner-assistant-chat";
import { providerReady, relaxApplies } from "@/server/services/assistant-provider";
import { getSettings, usageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — /owner/assistant. The OWNER alone (the owner and his partners); everybody else, and everybody while the switch is
 * off, gets «not found» and the menu never offers it. `?c=<id>` opens one of the owner's own conversations (somebody else's, or one
 * that does not exist, opens an empty one: the page never says it exists). Reading writes nothing.
 */
export default async function OwnerAssistantPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  const access = await assistantAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const wanted = typeof searchParams?.["c"] === "string" ? (searchParams["c"] as string) : null;
  const [settings, conversations, spaces, opened] = await Promise.all([
    getSettings(access.orgId),
    listConversations(access),
    db.workspace.findMany({ where: { organizationId: access.orgId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    wanted ? getConversation(access, wanted).catch((err: unknown) => (err instanceof AssistantError ? null : Promise.reject(err))) : Promise.resolve(null),
  ]);
  const usage = await usageSummary(access.orgId, settings);
  return <ChatScreen conversationId={opened?.id ?? null} title={opened?.title ?? ""} messages={opened?.messages ?? []} conversations={conversations} spaces={spaces} hasKey={providerReady(settings, "owner")} usage={usage} local={localOf(settings)} />;
}

/** What the screen needs to know when a local model answers («محلي» or the gateway): its name and whether the filter is loosened. */
function localOf(settings: Awaited<ReturnType<typeof getSettings>>): { model: string; relaxed: boolean } | null {
  if (settings.ownerProvider === "ollama") return { model: settings.localModel ?? "", relaxed: relaxApplies(settings, "ollama") };
  if (settings.ownerProvider === "openai") return { model: settings.gatewayModel ?? "", relaxed: relaxApplies(settings, "openai") };
  return null;
}

export const dynamic = "force-dynamic";
