import { db } from "@/server/db";
import { log } from "@/server/log";
import { AR } from "@/lib/i18n/dict";
import { resolveTimeZone, zonedParts } from "@/lib/zoned-time";
import { isFeatureOn } from "@/server/services/features";
import { storeAppCard, topicForAuthor } from "@/server/chat/door-message";
import { cardBodyOf, type MessageCard } from "@/server/door/message-payload";
import { COUNTED_EVENTS, OMS_DAILY_SOURCE, OMS_EVENTS_SOURCE, claimInboundDelivery, countEvents, eventsConfigOf } from "@/server/integrations/oms-events";

/**
 * THE DAILY NUMBERS CARD (I1.1a): at the hour the owner set (in the COMPANY's time zone), once a day, one CARD in the topic the owner chose, counted from the events
 * the orders system SENT US in the last 24 hours — confirmed, cancelled, shipped, delivered, returned. No money, no customer data. ⚠️ New orders and the number per product
 * cannot be counted from today's events (`order.created` fires only for an order placed on the shop itself, and most events carry no product): the card says so.
 *
 * Exactly once a day: the day is taken as a delivery of its own source (`InboundDelivery`, the unique triple company + source + day), so two runners, a restart and the
 * 30-second tick cannot make two cards. A runner that was down at the hour still sends the card later the same day. A failure that will not mend by itself (the topic is gone or
 * archived, the person who connected it is no longer here) keeps the day taken and shows ONE failure under «التكاملات»; a failure that may mend (the database) gives the day back,
 * so the next tick tries again, and its failure row is written at most once in ten minutes (a tick every 30 seconds must not become a row every 30 seconds). The delivery rows older than 40 days are removed here, once a day per company (a replay older than 5 minutes is refused by the signature anyway).
 */
export interface OmsDailyCardRun {
  sent: number;
  failed: number;
}

const KEEP_DELIVERIES_DAYS = 40;

export async function runOmsDailyCard(now: Date = new Date()): Promise<OmsDailyCardRun> {
  const out: OmsDailyCardRun = { sent: 0, failed: 0 };
  const rows = await db.integration.findMany({ where: { type: "OMS_EVENTS", connected: true }, select: { id: true, orgId: true, config: true } });
  for (const row of rows) {
    const cfg = eventsConfigOf(row.config);
    if (!cfg?.dailyCard) continue;
    try {
      if (!(await isFeatureOn(row.orgId, "omsEvents"))) continue;
      const org = await db.organization.findUnique({ where: { id: row.orgId }, select: { timezone: true } });
      const parts = zonedParts(now, resolveTimeZone(org?.timezone));
      if (parts.hour < cfg.dailyCard.hour) continue;
      const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      if (!(await claimInboundDelivery(db, { orgId: row.orgId, source: OMS_DAILY_SOURCE, deliveryId: day, event: "daily", now }))) continue;
      try {
        await sendCard(row.orgId, cfg.connectedById, cfg.dailyCard.conversationId, now);
        out.sent += 1;
        // housekeeping AFTER the card is stored: its failure must never reach the catch below (that would give the day back and make a second card at the next tick)
        await db.inboundDelivery.deleteMany({ where: { orgId: row.orgId, source: OMS_EVENTS_SOURCE, receivedAt: { lt: new Date(now.getTime() - KEEP_DELIVERIES_DAYS * 86_400_000) } } }).catch(() => undefined);
      } catch (err) {
        out.failed += 1;
        const permanent = err instanceof PermanentCardError;
        log.warn("oms_daily_card.failed", { name: err instanceof Error ? err.name : "error", permanent });
        // may mend by itself: the day is given back and the next tick tries again; will not: the day stays taken (nothing to retry until tomorrow)
        if (!permanent) await db.inboundDelivery.deleteMany({ where: { orgId: row.orgId, source: OMS_DAILY_SOURCE, deliveryId: day } });
        const recent = await db.integrationEvent.findFirst({ where: { orgId: row.orgId, type: "oms.daily_card", createdAt: { gt: new Date(Date.now() - 10 * 60_000) } }, select: { id: true } });
        if (!recent) {
          await db.integrationEvent.create({ data: { orgId: row.orgId, integrationId: row.id, direction: "IN", type: "oms.daily_card", status: "FAILED", detail: "oms_daily_card.failed" } }).catch(() => undefined);
        }
      }
    } catch (err) {
      out.failed += 1;
      log.warn("oms_daily_card.skipped", { name: err instanceof Error ? err.name : "error" });
    }
  }
  return out;
}

/** A failure that will not mend by itself: the day stays taken. */
class PermanentCardError extends Error {}

async function sendCard(orgId: string, authorId: string, conversationId: string, now: Date): Promise<void> {
  const author = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: authorId, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
  if (!author) throw new PermanentCardError("author_inactive");
  // asked again NOW: the topic may be gone and the person may have left it since the card was set up
  const topic = await topicForAuthor(orgId, author.userId, conversationId);
  if (!topic.ok) throw new PermanentCardError(topic.reason);
  const counts = await countEvents(orgId, new Date(now.getTime() - 86_400_000), now);
  const card: MessageCard = {
    title: AR["oms.daily.title"] ?? "",
    lines: [
      { label: AR["oms.daily.window_label"] ?? "", value: AR["oms.daily.window"] ?? "" },
      ...COUNTED_EVENTS.map((e) => ({ label: AR[`oms.daily.${e.slice("order.".length)}`] ?? e, value: String(counts[e]) })),
      { label: AR["oms.daily.note_label"] ?? "", value: AR["oms.daily.missing"] ?? "" },
    ],
    status: "info",
  };
  const via = AR["oms.events.via"] ?? "";
  await db.$transaction((tx) =>
    storeAppCard(tx, { orgId, conversationId: topic.id, spaceId: topic.spaceId, authorId: author.userId, body: cardBodyOf(card, via), card: { type: "app", title: card.title, lines: card.lines, status: card.status }, viaApp: via }),
  );
}
