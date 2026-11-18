import { z } from "zod";
import { isOrderNumber } from "@/lib/oms/order-ref";
import { PHONE_PATTERN, normalizeDigits } from "@/server/ai/redact";
import { hasNul } from "./payload";

/**
 * «باب الرسائل» (I1.1b): what a sender may put in `POST /api/v2/messages`. The contract is docs/contracts/workspace-door.v2.md; this file IS its
 * validation. Pure (no database).
 *
 *  - STRICT: a field nobody declared is refused (422), never ignored.
 *  - The key-name check of v1 (`parseDoorBody`) runs first, so a field NAMED like customer data is refused with its own code.
 *  - Every TEXT of the card (title, line labels and values, button labels and addresses) except `ref` is checked with the EXISTING phone pattern of
 *    src/server/ai/redact.ts (`PHONE_PATTERN`): a run of seven or more digits is refused as `door.customer_data_rejected`. `ref` is an order number, which is
 *    an opaque id and has its own shape (Q1.4).
 *  - A button points at https only, no credentials, no custom port, and only at a host the OWNER allowed on that token.
 */

export const CARD_STATUSES = ["info", "ok", "warn", "danger"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TOPIC_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const CARD_LIMITS = { title: 120, lines: 8, label: 40, value: 200, buttons: 3, buttonLabel: 24, url: 500 } as const;

const text = (max: number) =>
  z
    .string()
    .refine((v) => !hasNul(v), "door.field.nul")
    .pipe(z.string().trim().min(1).max(max));

/** A button address: https, a real host, no credentials, the default port. The host is judged against the token's list later (`hostAllowed`). */
const buttonUrl = z
  .string()
  .max(CARD_LIMITS.url)
  .refine((v) => !hasNul(v), "door.field.nul")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.username === "" && u.password === "" && u.port === "" && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "door.field.button_url");

const line = z.object({ label: text(CARD_LIMITS.label), value: text(CARD_LIMITS.value) }).strict();
const button = z.object({ label: text(CARD_LIMITS.buttonLabel), url: buttonUrl }).strict();

export const messageBodySchema = z
  .object({
    topicKey: z.string().regex(TOPIC_KEY, "door.field.topic_key"),
    card: z
      .object({
        title: text(CARD_LIMITS.title),
        lines: z.array(line).max(CARD_LIMITS.lines).optional(),
        status: z.enum(CARD_STATUSES).optional(),
        /** an order number in the shape of Q1.4: shown as a chip, never scanned for a phone number */
        ref: z.string().refine((v) => isOrderNumber(v), "door.field.ref").optional(),
        buttons: z.array(button).max(CARD_LIMITS.buttons).optional(),
      })
      .strict(),
    /** «لازم ينقرأ» (Q1.6): honoured only where the switch is on and the token's person may mark a message */
    mustRead: z.boolean().optional(),
  })
  .strict();
export type MessageBody = z.infer<typeof messageBodySchema>;
export type MessageCard = MessageBody["card"];

/** Does this text hold a phone number or any long number (the pattern of Q1.5 and the chat filter, digits normalised to 0-9)? */
export function hasPhoneNumber(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // a malformed escape is looked at as written
  }
  const re = new RegExp(PHONE_PATTERN.source, "g");
  return [value, decoded].some((t) => {
    re.lastIndex = 0;
    return re.test(normalizeDigits(t));
  });
}

/** The paths of every card text (never `ref`) that holds a phone number. The values are never returned. */
export function phoneFieldsOf(card: MessageCard): string[] {
  const hits: string[] = [];
  const check = (path: string, value: string | undefined) => {
    if (value !== undefined && hasPhoneNumber(value)) hits.push(path);
  };
  check("card.title", card.title);
  (card.lines ?? []).forEach((l, i) => {
    check(`card.lines.${i}.label`, l.label);
    check(`card.lines.${i}.value`, l.value);
  });
  (card.buttons ?? []).forEach((b, i) => {
    check(`card.buttons.${i}.label`, b.label);
    check(`card.buttons.${i}.url`, b.url);
  });
  return hits;
}

/** A host list entry: a bare lower-case host name. Anything else (a scheme, a path, a port, a wildcard) is no entry. */
export function cleanHosts(input: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const h = raw.trim().toLowerCase();
    if (/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) out.add(h);
  }
  return [...out].slice(0, 20);
}

/** The buttons whose host is NOT on the token's list (their paths), e.g. `["card.buttons.1.url"]`. */
export function disallowedButtonHosts(card: MessageCard, allowed: readonly string[]): string[] {
  const set = new Set(allowed.map((h) => h.toLowerCase()));
  const bad: string[] = [];
  (card.buttons ?? []).forEach((b, i) => {
    let host = "";
    try {
      host = new URL(b.url).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (!set.has(host)) bad.push(`card.buttons.${i}.url`);
  });
  return bad;
}

/**
 * The words of the message as it is stored in `ChatMessage.body` (the chat shows this line until its screen draws the card): who sent it, the title, the
 * lines, the order number and the buttons with their addresses. At most 4000 characters (the title, eight lines and three buttons come to far less).
 */
export function cardBodyOf(card: MessageCard, via: string): string {
  const out = [via, card.title];
  for (const l of card.lines ?? []) out.push(`${l.label}: ${l.value}`);
  if (card.ref) out.push(card.ref);
  for (const b of card.buttons ?? []) out.push(`${b.label}: ${b.url}`);
  return out.join("\n");
}

/** What `ChatMessage.card` keeps for such a message. Texts only, no author, no token. */
export function storedCardOf(card: MessageCard): Record<string, unknown> {
  return {
    type: "app",
    title: card.title,
    ...(card.lines?.length ? { lines: card.lines } : {}),
    ...(card.status ? { status: card.status } : {}),
    ...(card.ref ? { ref: card.ref } : {}),
    ...(card.buttons?.length ? { buttons: card.buttons } : {}),
  };
}
