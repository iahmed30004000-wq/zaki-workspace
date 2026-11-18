import { z } from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError, requireUser } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { allowTyping, broadcastTyping } from "@/server/realtime/hub";
import { typingFacts } from "@/server/chat/typing-gate";

/**
 * POST /api/rt/typing {conversationId} — "يكتب الآن…" for the OTHER viewers of a
 * conversation. Never stored: in-memory only, 6 s expiry in the hub. A person who
 * cannot read the conversation gets 404 (the conversation is invisible, not forbidden).
 * The OWNER in oversight cannot emit typing; once he has joined («شارك بالمحادثة»)
 * he is a normal member and can.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({ conversationId: z.string().min(1) });

export async function POST(req: Request): Promise<NextResponse> {
  return withApi(async () => {
    const actor = await requireActor();
    const body = BODY.parse(await req.json().catch(() => ({})));

    // The policy's facts about (this person, this conversation) are remembered for 30 s (C1.8, `typing-gate.ts`): a refusal never is, and the
    // owner is asked every time. A person who cannot READ the conversation gets 404 (it is invisible, not forbidden); posting is NOT required
    // (a read-only announcements member still sees «يكتب الآن…»).
    const facts = await typingFacts(actor, body.conversationId);
    if (!facts) throw new NotFoundError("chat.not_found");

    // The owner's silent oversight never emits typing: only a JOINED owner (he has a ConversationMember row) may.
    if (!facts.member && actor.isOwner) {
      // oversight read: silent, nothing emitted
      return new NextResponse(null, { status: 204 });
    }

    if (!allowTyping(`${actor.userId}|${body.conversationId}`)) {
      return new NextResponse(null, { status: 204 });
    }

    const user = await requireUser();
    await broadcastTyping(actor.orgId, body.conversationId, actor.userId, user.name);
    return new NextResponse(null, { status: 204 });
  });
}
