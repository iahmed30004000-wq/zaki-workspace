import { z } from "zod";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import { decryptSecrets, encryptSecrets } from "@/server/crypto";
import { dayKeyOf } from "@/lib/owner-board";
import { orgTimeZone } from "@/server/services/org-day";
import { DEFAULT_MODEL, KNOWN_MODELS, isValidLocalModelId, isValidModelId } from "@/server/ai/provider";
import { AssistantError } from "@/server/ai/api";
import { parseLocalBaseUrl } from "@/server/ai/local-host";
import type { ProviderKind } from "@/server/ai/registry";

/**
 * «مساعد المالك» — THE SETTINGS, THE KEY AND THE COUNTERS.
 *
 * THE KEY IS WRITE-ONLY. It is encrypted at rest with `ENCRYPTION_KEY` (the same way the Telegram, n8n and Google secrets are,
 * src/server/crypto.ts) in `AiSettings.keyCipher`. Nothing in this file, and nothing that calls it, ever returns it:
 *   - every public read selects explicit columns and NEVER `keyCipher`;
 *   - the screen is shown `hasKey` and the last four characters, computed at the moment the key was saved and stored apart;
 *   - `readKey` is the only reader of the cipher; it is used by the chat service to hand the key to the provider and by nothing else;
 *   - the key never reaches a log line, an audit row, an error message or a response.
 * The OpenAI-compatible gateway's optional Bearer key (`gatewayKeyCipher`) is held the same way: write-only, encrypted, never selected.
 *
 * «نموذج محلي»: which model each assistant uses (`ownerProvider`, `chatProvider`), the address and model of the Ollama service and of the
 * gateway, the owner's «the model behind the gateway is local» confirmation and the switch that relaxes the privacy filter for a local
 * model. The addresses are judged by `parseLocalBaseUrl` (src/server/ai/local-host.ts) BEFORE they are stored, and again on every call.
 */

export const DEFAULT_DAILY_LIMIT = 50;
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;
export const MAX_DAILY_LIMIT = 10_000;
export const MAX_MONTHLY_BUDGET = 100_000_000;

export interface PublicSettings {
  hasKey: boolean;
  /** The last four characters of the saved key (null: no key). */
  keyLast4: string | null;
  model: string;
  dailyLimit: number;
  monthlyTokenBudget: number;
  allowNames: boolean;
  allowTitles: boolean;
  /** Which model each assistant talks to. */
  ownerProvider: ProviderKind;
  chatProvider: ProviderKind;
  /** Ollama: the address (an origin, already judged) and the model name. */
  localBaseUrl: string | null;
  localModel: string | null;
  /** The OpenAI-compatible gateway: the same, its optional Bearer key (only whether one is saved, and its last four characters) and the confirmation. */
  gatewayBaseUrl: string | null;
  gatewayModel: string | null;
  hasGatewayKey: boolean;
  gatewayKeyLast4: string | null;
  gatewayConfirmedLocal: boolean;
  /** The privacy filter is relaxed for a local model (for the gateway: only with the confirmation). Never for Claude. */
  localRelaxRedaction: boolean;
}

export const PROVIDER_KINDS: readonly ProviderKind[] = ["claude", "ollama", "openai"];
const asProvider = (value: string): ProviderKind => ((PROVIDER_KINDS as readonly string[]).includes(value) ? (value as ProviderKind) : "claude");

export const DEFAULT_SETTINGS: PublicSettings = {
  hasKey: false,
  keyLast4: null,
  model: DEFAULT_MODEL,
  dailyLimit: DEFAULT_DAILY_LIMIT,
  monthlyTokenBudget: DEFAULT_MONTHLY_TOKEN_BUDGET,
  allowNames: false,
  allowTitles: false,
  ownerProvider: "claude",
  chatProvider: "claude",
  localBaseUrl: null,
  localModel: null,
  gatewayBaseUrl: null,
  gatewayModel: null,
  hasGatewayKey: false,
  gatewayKeyLast4: null,
  gatewayConfirmedLocal: false,
  localRelaxRedaction: false,
};

/** The columns a read may take: NOT the cipher. */
const PUBLIC_COLUMNS = {
  keyLast4: true,
  model: true,
  dailyLimit: true,
  monthlyTokenBudget: true,
  allowNames: true,
  allowTitles: true,
  ownerProvider: true,
  chatProvider: true,
  localBaseUrl: true,
  localModel: true,
  gatewayBaseUrl: true,
  gatewayModel: true,
  gatewayKeyLast4: true,
  gatewayConfirmedLocal: true,
  localRelaxRedaction: true,
} as const;

export async function getSettings(orgId: string): Promise<PublicSettings> {
  const row = await db.aiSettings.findUnique({ where: { orgId }, select: PUBLIC_COLUMNS });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    hasKey: row.keyLast4 !== null,
    keyLast4: row.keyLast4,
    model: row.model,
    dailyLimit: row.dailyLimit,
    monthlyTokenBudget: row.monthlyTokenBudget,
    allowNames: row.allowNames,
    allowTitles: row.allowTitles,
    ownerProvider: asProvider(row.ownerProvider),
    chatProvider: asProvider(row.chatProvider),
    localBaseUrl: row.localBaseUrl,
    localModel: row.localModel,
    gatewayBaseUrl: row.gatewayBaseUrl,
    gatewayModel: row.gatewayModel,
    hasGatewayKey: row.gatewayKeyLast4 !== null,
    gatewayKeyLast4: row.gatewayKeyLast4,
    gatewayConfirmedLocal: row.gatewayConfirmedLocal,
    localRelaxRedaction: row.localRelaxRedaction,
  };
}

/** The key as plain text, for the provider call ONLY. Null: no key saved, or it can no longer be read (the owner enters it again). */
export async function readKey(orgId: string): Promise<string | null> {
  const row = await db.aiSettings.findUnique({ where: { orgId }, select: { keyCipher: true } });
  if (!row?.keyCipher) return null;
  const plain = decryptSecrets<{ apiKey?: unknown }>(row.keyCipher);
  return typeof plain?.apiKey === "string" && plain.apiKey.length > 0 ? plain.apiKey : null;
}

/** The gateway's Bearer key as plain text, for the provider call ONLY. Null: none saved (a gateway may want none). */
export async function readGatewayKey(orgId: string): Promise<string | null> {
  const row = await db.aiSettings.findUnique({ where: { orgId }, select: { gatewayKeyCipher: true } });
  if (!row?.gatewayKeyCipher) return null;
  const plain = decryptSecrets<{ apiKey?: unknown }>(row.gatewayKeyCipher);
  return typeof plain?.apiKey === "string" && plain.apiKey.length > 0 ? plain.apiKey : null;
}

// ───────────────────────────────────────── writing ─────────────────────────────────────────

const providerSchema = z.enum(["claude", "ollama", "openai"], { errorMap: () => ({ message: "assistant.provider_invalid" }) });

/** An address field: empty clears it; anything else must be an INTERNAL origin (the stored text is the normalised origin). */
const addressSchema = z
  .string()
  .max(200, "assistant.local_url_invalid")
  .nullable()
  .transform((value, ctx): string | null => {
    const text = value === null ? "" : value.trim();
    if (text === "") return null;
    const parsed = parseLocalBaseUrl(text);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.key });
      return z.NEVER;
    }
    return parsed.target.origin;
  });

const modelNameSchema = z
  .string()
  .max(160, "assistant.local_model_invalid")
  .nullable()
  .transform((value, ctx): string | null => {
    const text = value === null ? "" : value.trim();
    if (text === "") return null;
    if (!isValidLocalModelId(text)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "assistant.local_model_invalid" });
      return z.NEVER;
    }
    return text;
  });

const settingsSchema = z
  .object({
    model: z.string().trim().refine(isValidModelId, "assistant.model_invalid").optional(),
    dailyLimit: z.number().int().min(1, "assistant.limit_invalid").max(MAX_DAILY_LIMIT, "assistant.limit_invalid").optional(),
    monthlyTokenBudget: z.number().int().min(0, "assistant.budget_invalid").max(MAX_MONTHLY_BUDGET, "assistant.budget_invalid").optional(),
    allowNames: z.boolean().optional(),
    allowTitles: z.boolean().optional(),
    ownerProvider: providerSchema.optional(),
    chatProvider: providerSchema.optional(),
    localBaseUrl: addressSchema.optional(),
    localModel: modelNameSchema.optional(),
    gatewayBaseUrl: addressSchema.optional(),
    gatewayModel: modelNameSchema.optional(),
    gatewayConfirmedLocal: z.boolean().optional(),
    localRelaxRedaction: z.boolean().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsSchema>;

function invalid(path: string, message: string): never {
  throw new ValidationError([{ path, message }]);
}

/** The settings screen's save (never the key). Only the fields sent change; the audit row names the fields, not their values. */
export async function updateSettings(ctx: { orgId: string; userId: string }, body: unknown): Promise<PublicSettings> {
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    invalid(first?.path.join(".") || "body", first && first.message.startsWith("assistant.") ? first.message : "validation.failed");
  }
  const patch = { ...(parsed.data as SettingsPatch) };
  const fields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) invalid("body", "validation.failed");

  // an assistant can be pointed at a local model only once that model's address and name are saved
  const current = await getSettings(ctx.orgId);
  const merged = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as PublicSettings;
  for (const slot of ["ownerProvider", "chatProvider"] as const) {
    if (patch[slot] === undefined) continue;
    if (!providerConfigured(merged, merged[slot])) invalid(slot, "assistant.local_incomplete");
  }
  // the confirmation belongs to ONE address: a new gateway address starts unconfirmed unless it is confirmed in the same request
  if (patch.gatewayBaseUrl !== undefined && patch.gatewayBaseUrl !== current.gatewayBaseUrl && patch.gatewayConfirmedLocal === undefined) patch.gatewayConfirmedLocal = false;
  if (patch.gatewayConfirmedLocal === true && !merged.gatewayBaseUrl) invalid("gatewayConfirmedLocal", "assistant.local_incomplete");
  await db.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, ...patch }, update: patch });
    await tx.auditLog.create({ data: { action: "ai.settings_changed", actorId: ctx.userId, orgId: ctx.orgId, meta: { fields } } });
  });
  return getSettings(ctx.orgId);
}

/** Is the provider usable as far as the settings go (Claude: a key is saved; a local one: its address and model are)? */
export function providerConfigured(settings: PublicSettings, kind: ProviderKind): boolean {
  if (kind === "ollama") return settings.localBaseUrl !== null && settings.localModel !== null;
  if (kind === "openai") return settings.gatewayBaseUrl !== null && settings.gatewayModel !== null;
  return true;
}

/** A key is one header-safe token: printable ASCII with no space, 20 to 400 characters. */
export function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[\x21-\x7E]{20,400}$/.test(key);
}

/** Saves (or replaces) the owner's key: encrypted, with its last four characters stored apart. Returns only what the screen may show. */
export async function saveKey(ctx: { orgId: string; userId: string }, key: unknown): Promise<PublicSettings> {
  const plain = typeof key === "string" ? key.trim() : key;
  if (!validKey(plain)) invalid("key", "assistant.key_invalid");
  const keyCipher = encryptSecrets({ apiKey: plain as string });
  const keyLast4 = (plain as string).slice(-4);
  await db.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, keyCipher, keyLast4 }, update: { keyCipher, keyLast4 } });
    await tx.auditLog.create({ data: { action: "ai.key_saved", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

/** «احذف المفتاح»: the cipher and the last four are erased. Everything else stays. */
export async function removeKey(ctx: { orgId: string; userId: string }): Promise<PublicSettings> {
  await db.$transaction(async (tx) => {
    await tx.aiSettings.updateMany({ where: { orgId: ctx.orgId }, data: { keyCipher: null, keyLast4: null } });
    await tx.auditLog.create({ data: { action: "ai.key_removed", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

/** The gateway's key: printable ASCII with no space, 8 to 400 characters (a local gateway's key may be short). */
export function validGatewayKey(key: unknown): key is string {
  return typeof key === "string" && /^[\x21-\x7E]{8,400}$/.test(key);
}

export async function saveGatewayKey(ctx: { orgId: string; userId: string }, key: unknown): Promise<PublicSettings> {
  const plain = typeof key === "string" ? key.trim() : key;
  if (!validGatewayKey(plain)) invalid("key", "assistant.key_invalid");
  const gatewayKeyCipher = encryptSecrets({ apiKey: plain as string });
  const gatewayKeyLast4 = (plain as string).slice(-4);
  await db.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, gatewayKeyCipher, gatewayKeyLast4 }, update: { gatewayKeyCipher, gatewayKeyLast4 } });
    await tx.auditLog.create({ data: { action: "ai.gateway_key_saved", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

export async function removeGatewayKey(ctx: { orgId: string; userId: string }): Promise<PublicSettings> {
  await db.$transaction(async (tx) => {
    await tx.aiSettings.updateMany({ where: { orgId: ctx.orgId }, data: { gatewayKeyCipher: null, gatewayKeyLast4: null } });
    await tx.auditLog.create({ data: { action: "ai.gateway_key_removed", actorId: ctx.userId, orgId: ctx.orgId } });
  });
  return getSettings(ctx.orgId);
}

// ───────────────────────────────────────── the counters ─────────────────────────────────────────

export interface UsageSummary {
  /** The company's day (YYYY-MM-DD). */
  day: string;
  requestsToday: number;
  dailyLimit: number;
  tokensThisMonth: number;
  monthlyTokenBudget: number;
}

/** The sums, in SQL: today's requests and this month's tokens of the whole company. */
export async function usageSummary(orgId: string, settings: PublicSettings, now: Date = new Date()): Promise<UsageSummary> {
  const day = dayKeyOf(now, await orgTimeZone(orgId));
  const [today, month] = await Promise.all([
    db.aiUsage.aggregate({ where: { orgId, day }, _sum: { requests: true } }),
    db.aiUsage.aggregate({ where: { orgId, day: { startsWith: day.slice(0, 7) } }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  return {
    day,
    requestsToday: today._sum.requests ?? 0,
    dailyLimit: settings.dailyLimit,
    tokensThisMonth: (month._sum.inputTokens ?? 0) + (month._sum.outputTokens ?? 0),
    monthlyTokenBudget: settings.monthlyTokenBudget,
  };
}

/** Refuses a call that would go over the daily message limit or the monthly token budget. The refusals are Arabic sentences. */
export function assertWithinQuota(usage: UsageSummary): void {
  if (usage.requestsToday >= usage.dailyLimit) throw new AssistantError("assistant.daily_limit", "rate_limited");
  if (usage.tokensThisMonth >= usage.monthlyTokenBudget) throw new AssistantError("assistant.monthly_budget", "rate_limited");
}

/** Counts one answered call (counters only: no content). */
export async function recordUsage(ctx: { orgId: string; userId: string }, day: string, tokens: { inputTokens: number; outputTokens: number }): Promise<void> {
  await db.aiUsage.upsert({
    where: { orgId_userId_day: { orgId: ctx.orgId, userId: ctx.userId, day } },
    create: { orgId: ctx.orgId, userId: ctx.userId, day, inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens, requests: 1 },
    update: { inputTokens: { increment: tokens.inputTokens }, outputTokens: { increment: tokens.outputTokens }, requests: { increment: 1 } },
  });
}

export const MODEL_CHOICES: readonly string[] = KNOWN_MODELS;
