import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ImapFlow, type MailboxLockObject, type MessageStructureObject } from "imapflow";
import { isPrivateAddress } from "@/server/net-guard";

/**
 * «بريد يصير مهمة» — THE MAILBOX, behind one small interface (`MailSource`) so the job can be tested with a fake one.
 *
 * What the real source (imapflow) does and never does:
 *  - it reads: the envelope (subject, sender, Message-ID) and ONE text part of the body (text/plain, else text/html), at most
 *    `MAX_PART_BYTES`. It never downloads an attachment, an image or any other part: it finds the text part from the BODYSTRUCTURE
 *    first and fetches only that part by number.
 *  - it never deletes, moves or sends anything. The only write it can make is the `\Seen` flag, and only when the owner chose it
 *    (`markSeen`); otherwise the folder is opened read-only.
 *  - the server name is resolved here and refused when it points at a private, loopback or link-local address (the owner types it,
 *    so it must not become a way into the server's own network); the connection then goes to the address that was checked, with the
 *    name kept for the certificate.
 *  - every failure leaves as a `MailSourceError` with a dictionary key; the server's own words never travel.
 */

export const MAX_PART_BYTES = 256 * 1024;

export interface MailAccount {
  host: string;
  port: number;
  /** true: TLS from the first byte (993). false: STARTTLS is required (143); the password never crosses in the clear. */
  secure: boolean;
  username: string;
  password: string;
  folder: string;
  /** Open the folder for writing and set `\Seen` after a task was made. Off: the folder is read-only. */
  markSeen: boolean;
}

export interface MailBoxInfo {
  uidValidity: string;
  uidNext: number;
  exists: number;
}

export interface InboxMail {
  uid: number;
  messageId: string | null;
  subject: string | null;
  /** The sender's address (the first «From»), as the server reports it. */
  from: string | null;
  /** The text part that was fetched: its type and its content already in UTF-8; null when the mail has no text part. */
  bodyType: "text/plain" | "text/html" | null;
  body: string | null;
}

export interface MailSource {
  /** Connects and opens the folder; says where it stands. */
  open(): Promise<MailBoxInfo>;
  /** The UIDs of the UNSEEN mails after `afterUid`, ascending, at most `limit`. */
  listUnseen(afterUid: number, limit: number): Promise<number[]>;
  /** One mail's envelope and text part (never an attachment); null when it vanished. */
  fetch(uid: number): Promise<InboxMail | null>;
  /** Sets `\Seen` (only ever called when the owner chose it). */
  markSeen(uid: number): Promise<void>;
  /** Ends the session. Never throws. */
  close(): Promise<void>;
}

export type MailSourceFactory = (account: MailAccount) => MailSource;

/** A failure with a dictionary key (`mail.err.*`). */
export class MailSourceError extends Error {
  constructor(public readonly key: string) {
    super(key);
    this.name = "MailSourceError";
  }
}

const CONNECT_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "CONNECT_TIMEOUT", "NoConnection", "ETIMEOUT", "TIMEOUT", "GREETING_TIMEOUT", "SocketTimeout"]);
const HOST_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME", "ENODATA"]);
const TLS_CODES = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "HOSTNAME_MISMATCH", "ERR_TLS_CERT_ALTNAME_INVALID", "EPROTO", "ETLS"]);

/** The dictionary key of a failure (never its text). */
export function mailErrorKey(err: unknown): string {
  if (err instanceof MailSourceError) return err.key;
  const e = (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;
  const code = typeof e["code"] === "string" ? (e["code"] as string) : "";
  const responseCode = typeof e["serverResponseCode"] === "string" ? (e["serverResponseCode"] as string) : "";
  if (e["authenticationFailed"] === true || code === "AUTHENTICATIONFAILED" || responseCode === "AUTHENTICATIONFAILED" || code === "EAUTH") return "mail.err.auth";
  if (e["mailboxMissing"] === true || responseCode === "NONEXISTENT" || code === "NONEXISTENT") return "mail.err.folder";
  if (HOST_CODES.has(code)) return "mail.err.host";
  if (TLS_CODES.has(code) || code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS") || code.startsWith("ERR_OSSL")) return "mail.err.tls";
  if (CONNECT_CODES.has(code)) return "mail.err.connect";
  return "mail.err.unknown";
}

/** The name a log line may carry: the error's class name and its machine code, never its message. */
export function mailErrorName(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? `${err.name}.${code}` : err.name;
  }
  return "NonError";
}

// ---------------------------------------------------------------------------
// the text part
// ---------------------------------------------------------------------------

/**
 * Which part of the mail to read: the first `text/plain` that is not an attachment, else the first `text/html` that is not one.
 * Pure (the structure goes in, a part number comes out), so a test can pin that nothing else is ever chosen.
 */
export function pickTextPart(root: MessageStructureObject | undefined): { part: string; type: "text/plain" | "text/html" } | null {
  if (!root) return null;
  const found: { plain: string | null; html: string | null } = { plain: null, html: null };
  const walk = (node: MessageStructureObject, isRoot: boolean): void => {
    if (node.childNodes && node.childNodes.length > 0) {
      for (const child of node.childNodes) walk(child, false);
      return;
    }
    const type = (node.type ?? "").toLowerCase();
    if (node.disposition && node.disposition.toLowerCase() === "attachment") return;
    const part = node.part ?? (isRoot ? "1" : null);
    if (!part) return;
    if (type === "text/plain" && found.plain === null) found.plain = part;
    else if (type === "text/html" && found.html === null) found.html = part;
  };
  walk(root, true);
  if (found.plain) return { part: found.plain, type: "text/plain" };
  if (found.html) return { part: found.html, type: "text/html" };
  return null;
}

// ---------------------------------------------------------------------------
// the address the connection goes to
// ---------------------------------------------------------------------------

/** Resolves the server name and refuses a private address; returns the address to connect to. */
export async function publicAddressOf(host: string): Promise<string> {
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new MailSourceError("mail.err.private_host");
    return host;
  }
  let addresses: string[];
  try {
    const found = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("dns"), { code: "ENOTFOUND" })), 5000).unref?.()),
    ]);
    addresses = found.map((a) => a.address);
  } catch (err) {
    throw new MailSourceError(mailErrorKey(err) === "mail.err.unknown" ? "mail.err.host" : mailErrorKey(err));
  }
  if (addresses.length === 0) throw new MailSourceError("mail.err.host");
  // ONE private answer among the public ones is enough to refuse: a name must not be able to point inside
  if (addresses.some((a) => isPrivateAddress(a))) throw new MailSourceError("mail.err.private_host");
  return addresses[0]!;
}

// ---------------------------------------------------------------------------
// the real source
// ---------------------------------------------------------------------------

async function readAll(stream: AsyncIterable<Buffer | Uint8Array>, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    chunks.push(buf);
    if (size >= max) break;
  }
  return Buffer.concat(chunks).subarray(0, max);
}

export class ImapMailSource implements MailSource {
  private client: ImapFlow | null = null;
  private lock: MailboxLockObject | null = null;

  constructor(private readonly account: MailAccount) {}

  async open(): Promise<MailBoxInfo> {
    const a = this.account;
    const address = await publicAddressOf(a.host);
    const client = new ImapFlow({
      host: address,
      port: a.port,
      secure: a.secure,
      servername: isIP(a.host) === 0 ? a.host : undefined,
      // a mailbox without TLS never sees the password: STARTTLS is required when the port is not an SSL one
      doSTARTTLS: a.secure ? undefined : true,
      auth: { user: a.username, pass: a.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
      clientInfo: { name: "zaki-workspace" },
    });
    // an idle connection that drops must never be an unhandled 'error' event (it would take the process down)
    client.on("error", () => undefined);
    this.client = client;
    await client.connect();
    this.lock = await client.getMailboxLock(a.folder, { readOnly: !a.markSeen, acquireTimeout: 15_000 });
    const box = client.mailbox;
    if (!box) throw new MailSourceError("mail.err.folder");
    return { uidValidity: String(box.uidValidity), uidNext: Number(box.uidNext), exists: Number(box.exists ?? 0) };
  }

  async listUnseen(afterUid: number, limit: number): Promise<number[]> {
    const client = this.need();
    const found = await client.search({ seen: false, uid: `${afterUid + 1}:*` }, { uid: true });
    if (!found) return [];
    // `N:*` answers the newest mail even when it is older than N: filter, order, cut
    return found.filter((uid) => uid > afterUid).sort((x, y) => x - y).slice(0, limit);
  }

  async fetch(uid: number): Promise<InboxMail | null> {
    const client = this.need();
    const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
    if (!msg) return null;
    const env = msg.envelope;
    const picked = pickTextPart(msg.bodyStructure);
    let body: string | null = null;
    if (picked) {
      // ONLY this part, by number, capped: nothing else of the message is ever asked for
      const download = await client.download(String(uid), picked.part, { uid: true, maxBytes: MAX_PART_BYTES });
      if (download.content) body = (await readAll(download.content, MAX_PART_BYTES)).toString("utf8");
    }
    return {
      uid,
      messageId: env?.messageId ?? null,
      subject: env?.subject ?? null,
      from: env?.from?.[0]?.address ?? null,
      bodyType: picked ? picked.type : null,
      body,
    };
  }

  async markSeen(uid: number): Promise<void> {
    if (!this.account.markSeen) return;
    await this.need().messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  }

  async close(): Promise<void> {
    try {
      this.lock?.release();
    } catch {
      // nothing to release
    }
    this.lock = null;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }

  private need(): ImapFlow {
    if (!this.client) throw new MailSourceError("mail.err.connect");
    return this.client;
  }
}

let factoryForTests: MailSourceFactory | null = null;

/** Test hook: every run uses this source instead of the network (never call from server code). */
export function setMailSourceFactoryForTests(factory: MailSourceFactory | null): void {
  factoryForTests = factory;
}

export function createMailSource(account: MailAccount): MailSource {
  return factoryForTests ? factoryForTests(account) : new ImapMailSource(account);
}
