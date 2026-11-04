import crypto from "node:crypto";
import webpush from "web-push";
import { db } from "@/server/db";
import { appUrl } from "@/server/env";
import { log } from "@/server/log";
import { deliverToDevices } from "@/server/devices/hub";

/**
 * RINGING WHEN THE SITE IS CLOSED — Web Push (the owner's «اشعار بالمكالمة او رنين»). The browser's own push service
 * (Google's for Chrome and Android, Apple's for Safari) carries one short message — «فلان عم يرنّ عليك» or a missed
 * call — to the service worker (public/sw.js), which shows it and opens the call on a tap. Nothing else crosses it.
 *
 * The keys (VAPID) need no new setting: they are derived from the server's own secret (ENCRYPTION_KEY, else
 * AUTH_SECRET), the same on every start. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment override them.
 * Changing the secret changes the keys; the browsers then subscribe again by themselves (push-client.ts compares).
 */

export interface PushKeys {
  publicKey: string;
  privateKey: string;
}

/** The P-256 key pair of this server, from its secret (or the environment), base64url like the browsers want. */
export function vapidKeys(source: NodeJS.ProcessEnv = process.env): PushKeys {
  const pub = (source["VAPID_PUBLIC_KEY"] ?? "").trim();
  const priv = (source["VAPID_PRIVATE_KEY"] ?? "").trim();
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const secret = (source["ENCRYPTION_KEY"] ?? "").trim() || (source["AUTH_SECRET"] ?? "").trim();
  if (!secret) throw new Error("vapid keys: no ENCRYPTION_KEY or AUTH_SECRET to derive them from");
  for (let round = 0; round < 8; round++) {
    const scalar = Buffer.from(crypto.hkdfSync("sha256", secret, "zaki-workspace", `web-push-vapid-${round}`, 32));
    try {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.setPrivateKey(scalar);
      return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: scalar.toString("base64url") };
    } catch {
      // the scalar fell outside the curve's range (about one chance in 2^32): the next round takes another
    }
  }
  throw new Error("vapid keys: could not derive a key pair");
}

export interface PushMessage {
  /** «ring»: somebody is ringing; «missed»: nobody answered; «note»: one of the bell's notifications */
  kind: "ring" | "missed" | "note";
  title: string;
  body: string;
  /** the page a tap opens */
  url: string;
  /** one notification per call: a second ring replaces the first */
  tag: string;
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>;

let sender: Sender | null = null;

/** Test hook: send through this instead of the real push services (never call from server code). */
export function setPushSenderForTests(next: Sender | null): void {
  sender = next;
}

/**
 * Sends one message to every browser these people subscribed. Best effort: a push service that is down never stops a
 * call; a browser the service no longer knows (404 / 410) is forgotten.
 */
export async function pushTo(userIds: string[], message: PushMessage): Promise<void> {
  if (userIds.length === 0) return;
  // the Android app's live line first (src/server/devices/hub.ts): a ring or a note reaches the phone as its own full-screen call or notification
  const onPhone = deliverToDevices(userIds, { kind: message.kind, title: message.title, body: message.body, url: message.url, tag: message.tag });
  const all = await db.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true, userAgent: true } });
  // while the app is connected it shows the message itself: the browser of the same phone (an Android one) stays quiet, so nothing shows twice.
  // Laptops, other browsers and a phone whose app is not connected are reached by Web Push as before.
  const subs = all.filter((s) => !(onPhone.has(s.userId) && /android/i.test(s.userAgent ?? "")));
  if (subs.length === 0) return;
  let keys: PushKeys;
  try {
    keys = vapidKeys();
  } catch (err) {
    log.warn("push.no_keys", { message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const options: webpush.RequestOptions = {
    vapidDetails: { subject: appUrl().startsWith("https://") ? appUrl() : "mailto:calls@zakiai.io", publicKey: keys.publicKey, privateKey: keys.privateKey },
    // a ring is worth nothing a minute later; a note still matters the next day
    TTL: message.kind === "ring" ? 45 : message.kind === "note" ? 86400 : 3600,
    urgency: message.kind === "ring" ? "high" : "normal",
  };
  const payload = JSON.stringify(message);
  const send: Sender = sender ?? ((sub, body, opts) => webpush.sendNotification(sub, body, opts));
  await Promise.all(
    subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
        await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else log.warn("push.failed", { status, message: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
}

/** This browser of this person agrees to be rung (one row per browser; a browser that changed hands moves). */
export async function subscribe(userId: string, sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }): Promise<void> {
  const userAgent = sub.userAgent ? sub.userAgent.slice(0, 300) : null;
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent },
    update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent },
  });
}

/** This browser no longer wants to be rung. Only its own person removes it. */
export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId } });
}
