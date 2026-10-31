import { createHash } from "node:crypto";
import { z } from "zod";
import { priorities } from "@/server/validation";

/**
 * «الباب»: what a sender may put in a request. The contract is docs/contracts/workspace-door.v1.md; this file IS its
 * validation. Pure (no database): tests/api-door-payload.test.ts.
 *
 *  - STRICT: a field nobody declared is refused (422), never ignored, so nothing the contract does not name is stored.
 *  - NO CUSTOMER DATA crosses it (AGENTS.md, "Integration contract rules"): identifiers are opaque, and a field whose NAME
 *    says name / phone / address / e-mail / customer / price ... is refused with its own code before anything else is
 *    looked at, so a sender that starts adding a customer to the payload learns it at once, in its tests.
 *    The title and the description are free text and the SENDER is responsible for what it writes there: they are
 *    not scanned.
 */

/** A body bigger than this is refused (413) before it is parsed. */
export const DOOR_MAX_BODY_BYTES = 32 * 1024;

// ---------- customer-data keys ----------

/** Whole words (a key is split at camelCase, `_`, `-`, `.`): a key made of one of them names a person, a place or money. */
const FORBIDDEN_WORDS = new Set([
  "name", "names", "fullname", "firstname", "lastname", "surname", "nickname", "username",
  "phone", "phones", "mobile", "msisdn", "whatsapp", "tel", "telephone", "fax",
  "address", "addresses", "street", "city", "zip", "postcode", "country", "location", "lat", "lng", "latitude", "longitude",
  "email", "emails", "mail",
  "customer", "customers", "client", "clients", "buyer", "recipient", "receiver", "consignee",
  "price", "prices", "amount", "total", "cost", "balance", "iban", "salary", "cod", "discount",
]);

/** Parts that name customer data even when the key is one lower-case word ("customername", "phonenumber"). */
const FORBIDDEN_PARTS = ["customer", "phone", "mobile", "whatsapp", "address", "email", "fullname", "firstname", "lastname", "recipient", "buyer", "iban", "price"];

export function isCustomerDataKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => FORBIDDEN_WORDS.has(w))) return true;
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FORBIDDEN_PARTS.some((part) => compact.includes(part));
}

/** The paths (`a.b`) of every key, at any depth, whose name says customer data. */
export function findCustomerDataKeys(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => findCustomerDataKeys(item, `${prefix}${i}.`, depth + 1));
  const out: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (isCustomerDataKey(key)) out.push(`${prefix}${key}`);
    out.push(...findCustomerDataKeys(inner, `${prefix}${key}.`, depth + 1));
  }
  return out;
}

// ---------- fields ----------

/** The sender's own opaque reference: letters, digits and `. _ : - /` (no spaces, no `@`), so a name or an e-mail cannot ride in it. */
export const EXTERNAL_REF = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]{0,127}$/;
const externalRef = z.string().regex(EXTERNAL_REF, "door.field.external_ref");

const tag = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u, "door.field.tag");
const tags = z
  .array(tag)
  .max(10)
  .transform((all) => [...new Set(all)]);

export const ideaBodySchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().max(2000).nullable().optional(),
    tags: tags.optional(),
    externalRef: externalRef.optional(),
  })
  .strict();
export type IdeaBody = z.infer<typeof ideaBodySchema>;

export const taskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(280),
    description: z.string().max(10_000).nullable().optional(),
    /** The board of the token's space the task goes to (an opaque id; it is read back from the answer of a list of boards, or given by the owner). */
    boardId: z.string().min(1).max(64),
    priority: z.enum(priorities).optional(),
    /** `YYYY-MM-DD` (noon in the company's zone) or a full ISO instant with an offset. */
    dueDate: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
    externalRef: externalRef.optional(),
  })
  .strict();
export type TaskBody = z.infer<typeof taskBodySchema>;

export interface FieldIssue {
  path: string;
  message: string;
}

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; code: "door.customer_data_rejected"; keys: string[] }
  | { ok: false; code: "door.validation_failed"; issues: FieldIssue[] };

/** The customer-data check first, then the strict schema. */
export function parseDoorBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): ParsedBody<T> {
  const keys = findCustomerDataKeys(body);
  if (keys.length) return { ok: false, code: "door.customer_data_rejected", keys };
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    code: "door.validation_failed",
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.code === "unrecognized_keys" ? `unknown field: ${i.keys.join(", ")}` : i.message,
    })),
  };
}

// ---------- idempotency ----------

/** The sender's `Idempotency-Key`: 8..128 of letters, digits and `. _ : -`. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export type IdempotencyType = "idea.create" | "task.create";

/** The stored key: the COMPANY first (one company's retry can never replace another's), then the sender (the token), the kind, the key. */
export function storedIdempotencyKey(input: { organizationId: string; tokenId: string; type: IdempotencyType; key: string }): string {
  return `${input.organizationId}:${input.tokenId}:${input.type}:${input.key}`;
}

/** Keys sorted at every level, so two bodies that say the same thing hash the same whatever order the sender wrote them in. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function requestHash(type: IdempotencyType, body: unknown): string {
  return createHash("sha256").update(`${type}\n${stableStringify(body)}`, "utf8").digest("hex");
}

/** How long a record is kept: the window in which a retry gets the same answer. */
export const IDEMPOTENCY_TTL_MS = 48 * 60 * 60 * 1000;
