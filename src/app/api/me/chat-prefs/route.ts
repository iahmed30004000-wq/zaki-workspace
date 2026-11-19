import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { requireActor } from "@/server/policy/actor";
import { parse } from "@/server/validation";
import { CHAT_PREFS_MAX_BYTES, chatPrefsPatchSchema } from "@/lib/chat/prefs";
import { getMyChatPrefs, saveMyChatPrefs } from "@/server/services/chat-prefs";

/**
 * C3a.2 — the caller's own chat preferences (`User.chatPrefs`: folders, hidden tabs, the sections C4.1 fills, the voice speed of C3b.4).
 * Always the CALLER's: there is no id in the address and the body may not carry one, so there is no way to name somebody else.
 *
 *   GET  → { prefs, orgId, foldersOn }   `prefs` is `{}` for somebody who never saved (all defaults); `orgId` is the company the folders of the screen
 *                                        are keyed by; with the switch `chatFolders` off `foldersOn` is false and `prefs` carries no folders or tabs
 *   PUT  → { prefs, orgId, foldersOn }   a PATCH: each section named is replaced, the others stay, `null` puts one back to its default; the folders
 *                                        merge per company. 422 for a bad shape or more than 64 KB, 403 `chatprefs.not_your_company` for folders keyed
 *                                        by a company the person is not in, 404 for the folders or tabs while `chatFolders` is off
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await getMyChatPrefs(actor));
  });
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    // read with the ceiling, not after it: a body bigger than the cap is never held in memory
    let text: string;
    try {
      text = await readTextLimited(req, CHAT_PREFS_MAX_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw new ValidationError([{ path: "body", message: "chatprefs.too_big" }]);
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError([{ path: "body", message: "invalid JSON" }]);
    }
    const patch = parse(chatPrefsPatchSchema, body);
    return NextResponse.json(await saveMyChatPrefs(actor, patch));
  });
}

export const dynamic = "force-dynamic";
