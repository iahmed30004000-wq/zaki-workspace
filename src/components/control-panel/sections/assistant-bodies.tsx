import { notFound } from "next/navigation";
import { ChatScreen } from "@/components/owner-assistant/chat";
import { SettingsForm } from "@/components/owner-assistant/settings-form";
import { NotFoundError } from "@/server/auth";
import { AssistantError } from "@/server/ai/api";
import { db } from "@/server/db";
import { assistantAccess, type AssistantAccess } from "@/server/services/owner-assistant-access";
import { getConversation, listConversations } from "@/server/services/owner-assistant-chat";
import { providerReady, relaxApplies } from "@/server/services/assistant-provider";
import { MODEL_CHOICES, getSettings, usageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — the bodies of /owner/assistant (the chat) and /owner/assistant/settings (the key, the model, the limits, the local model and the gateway: the
 * ONE place of the AI connection, `AiSettings`), MOVED (A2.1) so the control panel draws the same screens. The OWNER alone (the owner and his partners); everybody
 * else, and everybody while the switch is off, gets «not found». `?c=<id>` opens one of the owner's own conversations (somebody else's, or one that does not exist,
 * opens an empty one: the screen never says it exists). Reading writes nothing; the key is write-only (the screen is handed `hasKey` and four characters).
 */
/** The access of the assistant, or «not found» (what the pages and the section both ask first). */
export const assistantOrMiss = (actor: Parameters<typeof assistantAccess>[0]): Promise<AssistantAccess> =>
  assistantAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });

/** What the screen needs to know when a local model answers («محلي» or the gateway): its name and whether the filter is loosened. */
function localOf(settings: Awaited<ReturnType<typeof getSettings>>): { model: string; relaxed: boolean } | null {
  if (settings.ownerProvider === "ollama") return { model: settings.localModel ?? "", relaxed: relaxApplies(settings, "ollama") };
  if (settings.ownerProvider === "openai") return { model: settings.gatewayModel ?? "", relaxed: relaxApplies(settings, "openai") };
  return null;
}

export async function AssistantBody({ access, searchParams }: { access: AssistantAccess; searchParams?: Record<string, string | string[] | undefined> }) {
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

export async function AssistantSettingsBody({ access }: { access: AssistantAccess }) {
  const settings = await getSettings(access.orgId);
  return <SettingsForm settings={settings} usage={await usageSummary(access.orgId, settings)} models={MODEL_CHOICES} />;
}
