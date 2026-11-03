/**
 * «بريد يصير مهمة» — the pure rules (no React, no server imports): how a mail's subject, sender and text become the words of a task.
 * The server (src/server/services/mail-to-task.ts) reads the mailbox; everything it decides about WORDS is here, so a test can pin it.
 */

export const MAIL_LIMITS = {
  title: 200,
  /** The excerpt of the body (the «من:» line is added on top). */
  excerpt: 1500,
  /** Mails looked at per run (the job runs every 5 minutes). */
  perRun: 20,
  /** Consecutive failed runs after which the reading stops («تعطّل»). */
  maxFailures: 5,
  /** Minutes between two runs of one mailbox. */
  everyMinutes: 5,
  allowList: 50,
  host: 253,
  field: 254,
  password: 256,
} as const;

/** The folder a mailbox opens when the owner leaves it empty, and the two usual ports (TLS from the first byte, STARTTLS). */
export const DEFAULT_FOLDER = "INBOX";
export const DEFAULT_PORT_SSL = 993;
export const DEFAULT_PORT_STARTTLS = 143;

/**
 * Code points that are not text: the C0 and C1 controls, the line and paragraph separators, the zero-width and direction marks and
 * the direction overrides (they can make a title read differently from what it says), and the byte order mark.
 * Written as numbers on purpose: no invisible character lives in this source file.
 */
const INVISIBLE: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function invisible(cp: number): boolean {
  return INVISIBLE.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** True when the text holds any such code point. */
export function hasInvisible(text: string): boolean {
  for (const ch of text) if (invisible(ch.codePointAt(0)!)) return true;
  return false;
}

/**
 * Replaces every such code point with `replacement`. With `keepLines` a line break (and a tab) survives, and the two Unicode
 * separators become a line break, so a body keeps its lines.
 */
function scrub(text: string, replacement: string, keepLines: boolean): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (keepLines && (cp === 0x0a || cp === 0x09)) out += ch;
    else if (keepLines && (cp === 0x2028 || cp === 0x2029)) out += "\n";
    else out += invisible(cp) ? replacement : ch;
  }
  return out;
}

/** Cuts at `max` characters (code points), never inside a surrogate pair. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("").trimEnd();
}

/** One line of text: invisible characters removed, every run of white space one space, cut to `max` characters. */
export function cleanLine(raw: string | null | undefined, max: number): string {
  return clip(scrub(raw ?? "", " ", false).replace(/\s+/g, " ").trim(), max);
}

/** The task title from a subject; `fallback` when it is empty after cleaning. */
export function titleFromSubject(subject: string | null | undefined, fallback: string): string {
  return cleanLine(subject, MAIL_LIMITS.title) || fallback;
}

/**
 * The body as a short plain-text excerpt: invisible characters removed (the lines stay), runs of blank lines collapsed, spaces at the
 * ends of a line trimmed, cut to `max` characters. HTML is NOT handled here (the parser has already turned it into text).
 */
export function excerptOf(text: string | null | undefined, max: number = MAIL_LIMITS.excerpt): string {
  const lines = scrub((text ?? "").replace(/\r\n?/g, "\n"), " ", true)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim());
  const joined = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return clip(joined, max);
}

/** The sender as `name@host` in lower case, or null when it is not an address. */
export function normalizeAddress(raw: string | null | undefined): string | null {
  const value = scrub(raw ?? "", "", false).trim().toLowerCase();
  if (value.length === 0 || value.length > MAIL_LIMITS.field) return null;
  return /^[^\s@<>"',;()[\]\\]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value) ? value : null;
}

/** The description of the task: «من: <sender>» then the excerpt. */
export function buildDescription(fromLabel: string, sender: string | null, body: string | null | undefined): string {
  const head = sender ? `${fromLabel}: ${sender}` : "";
  const excerpt = excerptOf(body);
  return [head, excerpt].filter((s) => s.length > 0).join("\n\n");
}

// ---------------------------------------------------------------------------
// the allow-list of senders
// ---------------------------------------------------------------------------

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The owner's list as typed (a line, a space or a comma per entry): each entry is a full address («a@b.com») or a domain («b.com» or
 * «@b.com»), lower-cased and de-duplicated; anything else is dropped, never guessed. `bad` holds the entries it refused.
 */
export function parseAllowList(raw: string | readonly string[] | null | undefined): { list: string[]; bad: string[] } {
  const parts = Array.isArray(raw) ? [...raw] : String(raw ?? "").split(/[\s,;]+/);
  const list: string[] = [];
  const bad: string[] = [];
  for (const part of parts) {
    const entry = scrub(String(part), "", false).trim().toLowerCase();
    if (entry === "") continue;
    const leadingAt = entry.startsWith("@");
    const address = entry.includes("@") && !leadingAt ? normalizeAddress(entry) : null;
    const domain = !entry.includes("@") || leadingAt ? (leadingAt ? entry.slice(1) : entry) : null;
    const value = address ?? (domain !== null && DOMAIN.test(domain) ? domain : null);
    if (value === null) bad.push(entry.slice(0, 60));
    else if (!list.includes(value)) list.push(value);
  }
  return { list, bad };
}

/**
 * Is this sender let in? An empty list lets everybody in. An entry with «@» is one exact address; one without is one exact domain
 * (a sub-domain is NOT the domain: «mail.b.com» needs its own entry). A sender that is not an address is never let in by a list.
 * ⚠️ The «From» of a mail can be forged: the list is a filter, not a proof of who wrote it.
 */
export function senderAllowed(sender: string | null, allowList: readonly string[]): boolean {
  if (allowList.length === 0) return true;
  const address = normalizeAddress(sender);
  if (!address) return false;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return allowList.some((entry) => (entry.includes("@") ? entry === address : entry === domain));
}

// ---------------------------------------------------------------------------
// the Message-ID key
// ---------------------------------------------------------------------------

/**
 * The key a mail is remembered by: its Message-ID without the angle brackets (lower case, cut to 300), or — a mail with none — a key
 * made of the mailbox's UIDVALIDITY and the UID, which no other mail of that mailbox shares.
 */
export function messageKey(messageId: string | null | undefined, uidValidity: string, uid: number): string {
  const id = scrub(messageId ?? "", "", false).trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return id.length > 0 ? `mid:${id.slice(0, 300)}` : `uid:${uidValidity}:${uid}`;
}

// ---------------------------------------------------------------------------
// the settings the owner types
// ---------------------------------------------------------------------------

/** A host name or an address, nothing else: no scheme, path, port, space or credentials. */
export function validHost(host: string): boolean {
  if (host.length === 0 || host.length > MAIL_LIMITS.host) return false;
  if (/^[0-9.]+$/.test(host)) return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every((n) => Number(n) <= 255);
  if (host.includes(":")) return /^[0-9a-f:]+$/i.test(host);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
}

/** A mailbox folder name: printable, short, no wildcard. */
export function validFolder(folder: string): boolean {
  return folder.length > 0 && folder.length <= 120 && !hasInvisible(folder) && !/[*%]/.test(folder);
}
