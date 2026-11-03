import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { directoryContext } from "@/app/api/_access";
import { chatDirectory, companyDirectory } from "@/server/chat/directory";
import { currentSpace } from "@/server/services/current-space";
import { lastSeenReader } from "@/server/services/last-seen";
import { assistantContactOffered } from "@/server/services/assistant-chat";

/**
 * GET: chatable org members (recipients picker). It is the staff directory, so it follows the
 * `directory.view` switch; a guest gets 403 `chat.guest_forbidden`.
 *
 * `?scope=company` (the floating quick chat, 2026-10-30): the whole company instead of the space,
 * each person with `inSpace` (can a DM be opened here?) and `online`. Adding a scope and optional
 * fields leaves the picker's answer exactly as it was.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await directoryContext("chat.guest_forbidden");
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    // «آخر ظهور»: decided here once per request; the fields below are simply absent when the switch is off
    const seen = await lastSeenReader(ctx.orgId, ctx.userId);
    const zone = seen.enabled ? { timeZone: seen.timeZone } : {};
    // «المساعد» as the first name of the list: only when its switch is on and «@المساعد» is offered
    const assistant = await assistantContactOffered(ctx.orgId);
    if (new URL(req.url).searchParams.get("scope") === "company") {
      const everyone = await companyDirectory(ctx.orgId, ctx.userId, space?.id ?? null, seen);
      return NextResponse.json({
        ...zone,
        assistant,
        people: everyone
          .filter((p) => p.userId !== ctx.userId)
          .map((p) => ({
            userId: p.userId,
            role: p.role,
            inSpace: p.inSpace,
            online: p.online,
            ...(p.lastSeenAt !== undefined ? { lastSeenAt: p.lastSeenAt } : {}),
            user: { id: p.userId, name: p.name, jobTitle: p.jobTitle, avatarUrl: p.avatarUrl ?? null },
          })),
      });
    }
    // the people of the space the person is in
    const people = await chatDirectory(ctx.orgId, space?.id ?? null, seen);
    return NextResponse.json({
      ...zone,
      assistant,
      people: people
        .filter((p) => p.userId !== ctx.userId)
        .map((p) => ({
          userId: p.userId,
          role: p.role,
          ...(p.lastSeenAt !== undefined ? { lastSeenAt: p.lastSeenAt } : {}),
          user: { id: p.userId, name: p.name, jobTitle: p.jobTitle, avatarUrl: p.avatarUrl ?? null },
        })),
    });
  });
}
