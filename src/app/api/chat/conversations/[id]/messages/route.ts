import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendMessage, sendSchema } from "@/server/chat/messages";
import { conversationMessages, messagesQuerySchema } from "@/server/chat/topics";
import { dateJumpQuerySchema, firstMessageOfDay, isDateJumpQuery, messageDays, withoutHidden } from "@/server/chat/hidden-messages";

/**
 * GET: one window of messages (C1.2), oldest first: the newest `limit`, or `before=<id>`, `after=<id>`, `around=<id>` (one of them), cursor
 * `(createdAt, id)`. Answers `{ messages, hasOlder, hasNewer, firstUnreadId, readers }`. The messages the person hid for themselves («حذف عندي», S5.7) are left out.
 * `?days=YYYY-MM&tz=` answers `{ days }` (the days of that month with a message the person can see) and `?onDate=YYYY-MM-DD&tz=` answers `{ id }` (the first message of that day
 * or after it, or null): the calendar of the date jump (S5.7).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const raw = Object.fromEntries(new URL(req.url).searchParams);
    if (isDateJumpQuery(raw)) {
      const d = parse(dateJumpQuerySchema, raw);
      return NextResponse.json(d.days ? await messageDays(ctx, params.id, { days: d.days, tz: d.tz }) : await firstMessageOfDay(ctx, params.id, { onDate: d.onDate as string, tz: d.tz }));
    }
    const q = parse(messagesQuerySchema, raw);
    const page = await conversationMessages(ctx, params.id, q);
    // a window that is all hidden keeps paging UP (the newest window and the `before` ones only: a window after or around a message has its own direction)
    const refill = q.after || q.around ? undefined : (before: string) => conversationMessages(ctx, params.id, { before, ...(q.limit ? { limit: q.limit } : {}) });
    return NextResponse.json(await withoutHidden(ctx.userId, page, refill));
  });
}

/** POST: send a message (optionally as a reply, with attachments, idempotent on `clientId`). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(sendSchema, req);
    const ctx = await activeOrgCtx();
    const msg = await sendMessage(ctx, params.id, input);
    return NextResponse.json(msg, { status: 201 });
  });
}
