import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import { decryptSecrets, encryptSecrets, hmacHex, safeEqual } from "@/server/crypto";
import { appUrl } from "@/server/env";
import { getIntegration, logEvent, upsertIntegration } from "@/server/services/integrations";
import { isFeatureOn } from "@/server/services/features";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
/**
 * Only the files the app itself creates (the library's): a non-sensitive scope, so Google asks for no
 * review and the owner's published app keeps its connection. The old drive.readonly grant cannot write
 * and is "restricted" (a paid security review to publish); a connection made with it keeps working
 * for the browse list, and the library stays on the server until the owner connects again.
 */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPE = DRIVE_FILE_SCOPE;

export interface GoogleSecrets {
  refreshToken: string;
  accessToken: string | null;
  email?: string;
  [key: string]: unknown;
}

/** Google app credentials from the deployment env (they win when set) — the app never invents them. */
export function googleEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret: clientSecret };
}

/**
 * THE GOOGLE APP ENTERED FROM THE SITE (the owner's ask, 2026-10-27: «بدي ادخلها بالسايت»): the client's id and
 * secret typed on «الأتمتة» instead of the server's settings. Kept on the company (`Organization.settings.googleApp`),
 * the secret encrypted like every integration secret; it never goes back to a screen. The deployment env, when set,
 * still wins.
 */
interface StoredGoogleApp {
  clientId?: unknown;
  secretEnc?: unknown;
}

async function storedApp(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const app = (org?.settings as { googleApp?: StoredGoogleApp } | null)?.googleApp;
  if (!app || typeof app.clientId !== "string" || typeof app.secretEnc !== "string") return null;
  const secret = decryptSecrets<{ clientSecret?: string }>(app.secretEnc)?.clientSecret;
  return secret ? { clientId: app.clientId, clientSecret: secret } : null;
}

/** The app this company connects with: the env's, else the one entered on the site. */
export async function googleApp(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
  return googleEnv() ?? (await storedApp(orgId));
}

/** Where the keys come from, for the screen: the server's settings, the site, or nowhere yet. */
export async function googleAppSource(orgId: string): Promise<"env" | "site" | null> {
  if (googleEnv()) return "env";
  return (await storedApp(orgId)) ? "site" : null;
}

const CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** Saves the app typed on «الأتمتة» (whoever runs integrations: `integrations.manage`, checked by the route). */
export async function saveGoogleApp(orgId: string, userId: string, input: { clientId: string; clientSecret: string }): Promise<void> {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  if (!CLIENT_ID.test(clientId)) throw new ValidationError([{ path: "clientId", message: "google.app.bad_id" }]);
  if (clientSecret.length < 10 || /\s/.test(clientSecret)) throw new ValidationError([{ path: "clientSecret", message: "google.app.bad_secret" }]);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const base = org?.settings && typeof org.settings === "object" ? (org.settings as Record<string, unknown>) : {};
    const next = { ...base, googleApp: { clientId, secretEnc: encryptSecrets({ clientSecret }) } };
    await tx.organization.update({ where: { id: orgId }, data: { settings: next as Prisma.InputJsonValue } });
  });
  await logEvent(orgId, { direction: "OUT", type: "google.app_saved", payload: { by: userId } });
}

/** Forgets the app typed on the site (a connection made with it stops refreshing). */
export async function clearGoogleApp(orgId: string, userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const base = org?.settings && typeof org.settings === "object" ? { ...(org.settings as Record<string, unknown>) } : {};
    delete base["googleApp"];
    await tx.organization.update({ where: { id: orgId }, data: { settings: base as Prisma.InputJsonValue } });
  });
  await logEvent(orgId, { direction: "OUT", type: "google.app_cleared", payload: { by: userId } });
}

/**
 * The callback address registered with Google. Built from the normalised public URL, so a
 * trailing slash in APP_URL cannot produce `//api/...` (Google would answer redirect_uri_mismatch).
 */
function redirectUri(): string {
  return `${appUrl()}/api/integrations/google/callback`;
}

// ---------------------------------------------------------------------------
// OAuth state: `orgId.userId.issuedAt.nonce.signature`
//
// Signed (HMAC over AUTH_SECRET) so it cannot be forged, stamped so it expires, and
// carrying a random nonce so every state is unique. It is NOT secret: the callback also
// checks that the person finishing the flow is the one it was issued to.
// ---------------------------------------------------------------------------

/** A state older than this is refused: consent takes a minute, not a day. */
const STATE_MAX_AGE_SEC = 10 * 60;
/** Slack for clocks that disagree by a moment; a state further in the future is refused. */
const STATE_FUTURE_SKEW_SEC = 5;
const STATE_LABEL = "zaki:google-oauth-state:v2";
const STATE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function stateMac(orgId: string, userId: string, issuedAt: string, nonce: string): string {
  return hmacHex(process.env["AUTH_SECRET"] ?? "", `${STATE_LABEL}|${orgId}|${userId}|${issuedAt}|${nonce}`);
}

/** `now` is injectable so tests can mint a state at any moment. */
export function signState(orgId: string, userId: string, now: Date = new Date()): string {
  const issuedAt = String(Math.floor(now.getTime() / 1000));
  const nonce = randomBytes(16).toString("hex");
  return [orgId, userId, issuedAt, nonce, stateMac(orgId, userId, issuedAt, nonce)].join(".");
}

export function verifyState(state: string, now: Date = new Date()): { orgId: string; userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [orgId, userId, issuedAt, nonce, sig] = parts as [string, string, string, string, string];
  if (!STATE_ID.test(orgId) || !STATE_ID.test(userId)) return null;
  if (!/^\d{9,12}$/.test(issuedAt) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!safeEqual(stateMac(orgId, userId, issuedAt, nonce), sig)) return null;
  const age = Math.floor(now.getTime() / 1000) - Number(issuedAt);
  if (age > STATE_MAX_AGE_SEC || age < -STATE_FUTURE_SKEW_SEC) return null;
  return { orgId, userId };
}

export async function buildAuthUrl(orgId: string, userId: string): Promise<string> {
  const cfg = await googleApp(orgId);
  if (!cfg) throw new Error("google.not_configured");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: signState(orgId, userId),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Exchanges the consent code for tokens; store result via connectGoogle. */
export async function exchangeCode(
  orgId: string,
  code: string,
): Promise<{ ok: true; access: string; refresh: string | null; scope: string | null } | { ok: false; error: string }> {
  const cfg = await googleApp(orgId);
  if (!cfg) return { ok: false, error: "google.not_configured" };
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!json?.access_token) return { ok: false, error: json?.error_description ?? json?.error ?? "google.token_failed" };
    return { ok: true, access: json.access_token, refresh: json.refresh_token ?? null, scope: json.scope ?? null };
  } catch {
    return { ok: false, error: "google.unreachable" };
  }
}

export async function connectGoogle(
  orgId: string,
  userId: string,
  tokens: { access: string; refresh: string | null; scope?: string | null },
): Promise<void> {
  // First connection supplies the refresh token; later consents only refresh access.
  const previous = await getIntegration(orgId, "GOOGLE_DRIVE");
  const prev = decryptSecrets<GoogleSecrets>(previous?.secretEnc);
  const secrets: GoogleSecrets = {
    refreshToken: tokens.refresh ?? prev?.refreshToken ?? "",
    accessToken: tokens.access,
  };
  await upsertIntegration(orgId, "GOOGLE_DRIVE", {
    connected: Boolean(secrets.refreshToken || secrets.accessToken),
    secrets,
    // the granted scopes decide whether the library may store on Drive (`libraryOnDrive`)
    config: { connectedBy: userId, scope: tokens.scope ?? "" },
  });
  await logEvent(orgId, { direction: "IN", type: "google.connected" });
}

export async function disconnectGoogle(orgId: string): Promise<void> {
  await upsertIntegration(orgId, "GOOGLE_DRIVE", { connected: false, secrets: null });
  await logEvent(orgId, { direction: "OUT", type: "google.disconnected" });
}

/** Drive can hold the library: connected, configured, and the grant includes `drive.file`. */
function grantsLibrary(row: { connected: boolean; config: unknown } | null, configured: boolean): boolean {
  if (!row?.connected || !configured) return false;
  const scope = (row.config as { scope?: unknown } | null)?.scope;
  return typeof scope === "string" && scope.split(" ").includes(DRIVE_FILE_SCOPE);
}

/** Drive can take a file from the app now: connected, configured and the grant includes `drive.file` (the database backup needs this, not the library's switch). */
export async function driveCanStore(orgId: string): Promise<boolean> {
  return grantsLibrary(await getIntegration(orgId, "GOOGLE_DRIVE"), Boolean(await googleApp(orgId)));
}

/** New library files go to Drive: the grant allows it and «الميزات» → «المكتبة على Google Drive» is on. */
export async function libraryOnDrive(orgId: string): Promise<boolean> {
  return grantsLibrary(await getIntegration(orgId, "GOOGLE_DRIVE"), Boolean(await googleApp(orgId))) && (await isFeatureOn(orgId, "libraryDrive"));
}

/**
 * `library`: the grant lets the library store on Drive (connected without it means «connect again»);
 * `libraryOff`: the owner switched the feature off, so new files stay on the server whatever the grant.
 */
export async function getGoogleStatus(orgId: string): Promise<{
  connected: boolean;
  configured: boolean;
  library: boolean;
  libraryOff: boolean;
  /** Where the app's keys come from: the server's settings («env»), typed on the site («site»), or not yet. */
  appSource: "env" | "site" | null;
  /** The address to give Google as the app's redirect URI (shown on «الأتمتة» to copy). */
  redirectUri: string;
}> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  const appSource = await googleAppSource(orgId);
  return {
    connected: Boolean(row?.connected),
    configured: appSource !== null,
    library: grantsLibrary(row, appSource !== null),
    libraryOff: !(await isFeatureOn(orgId, "libraryDrive")),
    appSource,
    redirectUri: redirectUri(),
  };
}

async function accessToken(orgId: string, opts?: { forceRefresh?: boolean }): Promise<string | null> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  const secrets = decryptSecrets<GoogleSecrets>(row?.secretEnc);
  if (!row?.connected || !secrets) return null;
  const cfg = await googleApp(orgId);
  if (!cfg) return null;

  if (secrets.accessToken && !opts?.forceRefresh) return secrets.accessToken;

  if (!secrets.refreshToken) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: secrets.refreshToken,
    grant_type: "refresh_token",
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!json?.access_token) return null;
    // persist the fresh access token so the next call reuses it
    await db.integration.update({
      where: { orgId_type: { orgId, type: "GOOGLE_DRIVE" } },
      data: { secretEnc: encryptSecrets({ ...secrets, accessToken: json.access_token }) },
    });
    return json.access_token;
  } catch {
    return null;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  link: string | null;
}

interface DriveListResponse {
  files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }>;
}

/**
 * A Drive request as the org's connected account: the stored access token, refreshed once when Google
 * answers 401. Null when there is no usable connection. `init` must be repeatable (no stream body).
 */
export async function driveRequest(orgId: string, url: string, init: RequestInit = {}): Promise<Response | null> {
  const send = (token: string) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  let token = await accessToken(orgId);
  if (!token) return null;
  let res = await send(token);
  if (res.status === 401) {
    token = await accessToken(orgId, { forceRefresh: true });
    if (!token) return null;
    res = await send(token);
  }
  return res;
}

async function listJson(orgId: string, params: URLSearchParams): Promise<DriveListResponse | null> {
  const res = await driveRequest(orgId, `${DRIVE_FILES_URL}?${params.toString()}`);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as DriveListResponse | null;
}

/** Read-only browse across the connected Drive for the org-known account. */
export async function listDriveFiles(orgId: string, limit = 25): Promise<{ ok: true; files: DriveFile[] } | { ok: false; error: string }> {
  const row = await getIntegration(orgId, "GOOGLE_DRIVE");
  if (!row?.connected) return { ok: false, error: "google.not_connected" };
  const params = new URLSearchParams({
    pageSize: String(limit),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    q: "trashed=false",
    orderBy: "modifiedTime desc",
  });
  try {
    const json = await listJson(orgId, params);
    if (!json) return { ok: false, error: "google.request_failed" };
    return {
      ok: true,
      files: (json.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime ?? null,
        link: f.webViewLink ?? null,
      })),
    };
  } catch {
    return { ok: false, error: "google.unreachable" };
  }
}
