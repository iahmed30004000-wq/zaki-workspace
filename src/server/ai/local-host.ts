import dns from "node:dns";
import { isIP } from "node:net";
import { AiProviderError } from "./provider";

/**
 * «نموذج محلي» — WHERE THE LOCAL MODEL MAY LIVE. The address of the local model is typed by the owner, so it is the one place in the
 * assistant where text from a person becomes part of a URL. That is a server-side request forgery (SSRF) door, and this file is its lock.
 * It is an ALLOW-LIST, not a block-list: an address is accepted only when it is clearly the owner's own machine or network.
 *
 *   syntax    `http:` or `https:` only; no user name or password, no query, no fragment, no path (the address is an origin: the app adds
 *             `/api/chat` and `/api/tags` itself).
 *   the host  one of: `localhost` · an IP address in 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1 or fc00::/7 · a single-label
 *             name (a Docker / Coolify service name such as `ollama`) · a name ending in `.internal` `.local` `.lan` `.localdomain`
 *             `.home.arpa` `.localhost`. Anything else (a public name, a public IP) is refused.
 *   never     link-local 169.254.0.0/16 (the cloud metadata address), 0.0.0.0, multicast, 100.64.0.0/10 (carrier-grade NAT: Alibaba's
 *             metadata lives there), `fd00:ec2::254` (the same on AWS), and the names `metadata`, `metadata.*`, `instance-data`: refused
 *             even where the rule above would accept the shape. Numeric forms (`2130706433`, `0x7f.1`) are normalised by the URL parser to
 *             dotted form first, so they are judged as the address they are.
 *   the call  a NAME is resolved again on EVERY connection, and the address the socket actually connects to is the one that was checked:
 *             every address the name resolves to must be private (`makeGuardedLookup`), so a name that points at a public address, or one
 *             that changes its mind after it was saved (DNS rebinding), cannot reach out. A redirect is never followed.
 *
 * Nothing in this file reads the database or the environment.
 */

export type LocalUrlErrorKey = "assistant.local_url_invalid" | "assistant.local_url_public";

export interface LocalTarget {
  protocol: "http:" | "https:";
  /** Lower-case, IPv6 without brackets. */
  hostname: string;
  port: number;
  /** `http://ollama:11434`: what is stored and shown. */
  origin: string;
  /** The host is an IP address (no DNS question is asked: it was judged here). */
  literal: boolean;
  /** An OUTSIDE https service the owner allowed on purpose (`externalGateway`): its name must resolve to public addresses only. */
  external?: boolean;
}

export type LocalUrlResult = { ok: true; target: LocalTarget } | { ok: false; key: LocalUrlErrorKey };

// ───────────────────────────────────────── addresses ─────────────────────────────────────────

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** The eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail is two groups), or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const v4 = ipv4Parts(tail[1] as string);
    if (!v4) return null;
    const hi = ((v4[0] as number) << 8) | (v4[1] as number);
    const lo = ((v4[2] as number) << 8) | (v4[3] as number);
    text = `${text.slice(0, text.length - (tail[1] as string).length)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const rest = halves.length === 2 && halves[1] ? (halves[1] as string).split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

/** Is `ip` an address of the owner's own machine or private network (and not a metadata address)? */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false; // 0.0.0.0, 169.254/16, 100.64/10, multicast, every public address
  }
  const g = ipv6Groups(ip);
  if (!g) return false;
  // IPv4-mapped (::ffff:a.b.c.d) is judged as the IPv4 address it carries
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPrivateAddress(`${(g[6] as number) >> 8}.${(g[6] as number) & 255}.${(g[7] as number) >> 8}.${(g[7] as number) & 255}`);
  // ::1
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true;
  // AWS's IPv6 metadata address sits inside fc00::/7
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return false;
  // fc00::/7 (unique local)
  return ((g[0] as number) & 0xfe00) === 0xfc00;
}

// ───────────────────────────────────────── names ─────────────────────────────────────────

const INTERNAL_SUFFIXES = [".internal", ".local", ".lan", ".localdomain", ".home.arpa", ".localhost"] as const;
const SINGLE_LABEL = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const NAME_LABEL = /^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/;

function isMetadataName(host: string): boolean {
  const first = host.split(".")[0] ?? "";
  return first === "metadata" || first === "instance-data" || host === "metadata.google.internal";
}

/** The shape rule for a name (an IP address is judged by `isPrivateAddress`). */
export function isInternalName(host: string): boolean {
  if (host.length === 0 || host.length > 253 || isMetadataName(host)) return false;
  if (host === "localhost") return true;
  if (!host.includes(".")) return SINGLE_LABEL.test(host);
  if (!INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return host.split(".").every((label) => NAME_LABEL.test(label));
}

/** Is `ip` a public address: not private, not loopback, not link-local / carrier-grade NAT / multicast / documentation / reserved? */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) {
    const [a, b, c] = v4 as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  const g = ipv6Groups(ip);
  if (!g) return false;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPublicAddress(`${(g[6] as number) >> 8}.${(g[6] as number) & 255}.${(g[7] as number) >> 8}.${(g[7] as number) & 255}`);
  // global unicast 2000::/3 only, minus the documentation range 2001:db8::/32
  if (((g[0] as number) & 0xe000) !== 0x2000) return false;
  return !(g[0] === 0x2001 && g[1] === 0x0db8);
}

/** A public NAME for an outside service: dotted, ordinary labels, never a metadata name. (An IP address is never accepted for one.) */
function isPublicName(host: string): boolean {
  if (host.length === 0 || host.length > 253 || isMetadataName(host) || !host.includes(".")) return false;
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  const labels = host.split(".");
  return labels.every((label) => NAME_LABEL.test(label)) && /[a-z]/.test(labels[labels.length - 1] as string);
}

export interface ParseOptions {
  /**
   * The owner switched `externalGateway` on: an https address with a public NAME is accepted too (the answer then carries
   * `external: true`), and a trailing `/v1` is dropped (the app adds the path itself). The internal rule is judged first, unchanged.
   */
  external?: boolean;
}

/** Parses and judges the address the owner typed. Pure; the answer carries a dictionary key, never the text. */
export function parseLocalBaseUrl(raw: unknown, options: ParseOptions = {}): LocalUrlResult {
  const strict = parseInternalBaseUrl(raw);
  if (strict.ok || !options.external) return strict;
  return parseExternalBaseUrl(raw) ?? strict;
}

function parseExternalBaseUrl(raw: unknown): LocalUrlResult | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\/v1\/?$/i, "");
  if (text.length === 0 || text.length > 200 || /[\s\x00-\x1f\x7f\\?#]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname) !== 0 || !isPublicName(hostname)) return null;
  const port = url.port ? Number(url.port) : 443;
  const origin = `https://${hostname}${port === 443 ? "" : `:${port}`}`;
  return { ok: true, target: { protocol: "https:", hostname, port, origin, literal: false, external: true } };
}

function parseInternalBaseUrl(raw: unknown): LocalUrlResult {
  const invalid: LocalUrlResult = { ok: false, key: "assistant.local_url_invalid" };
  const publicHost: LocalUrlResult = { ok: false, key: "assistant.local_url_public" };
  if (typeof raw !== "string") return invalid;
  const text = raw.trim();
  if (text.length === 0 || text.length > 200 || /[\s\x00-\x1f\x7f\\]/.test(text)) return invalid;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return invalid;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return invalid;
  if (/[?#]/.test(text)) return invalid; // an empty query or fragment is dropped by the parser: it is still not an origin
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname.length === 0) return invalid;
  const literal = isIP(hostname) !== 0;
  if (literal ? !isPrivateAddress(hostname) : !isInternalName(hostname)) return publicHost;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const shownHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  const origin = `${url.protocol}//${shownHost}${port === defaultPort ? "" : `:${port}`}`;
  return { ok: true, target: { protocol: url.protocol, hostname, port, origin, literal } };
}

// ───────────────────────────────────────── resolving at call time ─────────────────────────────────────────

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** The addresses a name resolves to (all of them). Tests inject their own. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
  const rows = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Every address of a name must be private, and ALL of them are returned (IPv4 first, then IPv6, each group in the order the system gave them). A
 * service on a Docker network usually has both, and a program that listens on `0.0.0.0` answers only the IPv4 one: the socket layer tries them
 * in turn, and every one of them was judged here. A refusal is `assistant.err_local_host`.
 */
export async function resolveAllPrivate(hostname: string, resolver: Resolver = systemResolver, external = false): Promise<ResolvedAddress[]> {
  let rows: ResolvedAddress[];
  try {
    rows = await resolver(hostname);
  } catch {
    // a name that does not resolve is a service that is not there: «down», not «forbidden»
    throw new AiProviderError("assistant.err_local_down");
  }
  // an outside service (the owner allowed it) must resolve to PUBLIC addresses only: a name that points inside is refused
  const allowed = external ? isPublicAddress : isPrivateAddress;
  if (rows.length === 0 || rows.some((r) => !allowed(r.address))) throw new AiProviderError("assistant.err_local_host");
  return [...rows.filter((r) => r.family === 4), ...rows.filter((r) => r.family !== 4)];
}

/** The one address a single-address caller uses: the first of `resolveAllPrivate` (an IPv4 one when the name has one). */
export async function resolvePrivate(hostname: string, resolver: Resolver = systemResolver): Promise<ResolvedAddress> {
  return (await resolveAllPrivate(hostname, resolver))[0] as ResolvedAddress;
}

type LookupCallback = (err: Error | null, address?: string | ResolvedAddress[], family?: number) => void;

/**
 * The `lookup` option of `http.request`: the socket connects to the address that was checked, not to one resolved a second time. It
 * answers both shapes of the callback (`all: true` as an array, otherwise address and family).
 */
export function makeGuardedLookup(resolver: Resolver = systemResolver, external = false) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    const wantAll = typeof options === "object" && options !== null && options.all === true;
    void resolveAllPrivate(hostname, resolver, external).then(
      (found) => (wantAll ? callback(null, found) : callback(null, (found[0] as ResolvedAddress).address, (found[0] as ResolvedAddress).family)),
      (err: unknown) => callback(err instanceof Error ? err : new Error("lookup")),
    );
  };
}
