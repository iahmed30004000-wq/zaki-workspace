import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { canReadConversation } from "@/server/policy/conversation";
import { findUnclaimedUpload, readAttachment } from "@/server/chat/attachments";
import { parseByteRange } from "@/server/files/range";

/**
 * GET /api/chat/attachments/[id] — the bytes of one attachment. A viewer may read it only
 * when they may read the conversation of its message (the OWNER's oversight reads silently),
 * or when they are the uploader and the upload is not claimed by a message yet (the message
 * does not exist during the upload). Anything the viewer may not read is 404, never 403.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const notFound = () => new NextResponse(null, { status: 404 });

    // The attachment row exists only after the message claims the file. Before that, the
    // uploader may still see his own upload (the message does not exist yet); for anyone
    // else — and for anything this org cannot see — the answer is 404, never 403.
    let att: Awaited<ReturnType<typeof readAttachment>> | null = null;
    try {
      att = await readAttachment(actor.orgId, params.id);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const unclaimed = await findUnclaimedUpload(actor.orgId, params.id, actor.userId);
      if (!unclaimed) return notFound();
      const { openStored } = await import("@/server/services/files");
      return bytesResponse(req, await openStored(actor.orgId, unclaimed.id));
    }

    const claimed = Boolean(att.attachment.messageId);
    const mayRead = claimed
      ? await canReadConversation(actor.userId, att.attachment.message!.conversationId)
      : att.file.uploaderId === actor.userId;
    if (!mayRead) return notFound();
    // the file of a deleted message is gone for everybody but the OWNER (redact.ts drops it from the DTO too)
    if (att.attachment.message?.deletedAt && !actor.isOwner) return notFound();

    return bytesResponse(req, att);
  });
}

/** The bytes as a stream (the server's disk, or proxied from Drive: only the asked range is fetched). Never a Drive link. */
async function bytesResponse(
  req: Request,
  file: { mimeType: string; name: string; size: number; stream: (range: { start: number; end: number } | null) => Promise<ReadableStream<Uint8Array>> },
): Promise<NextResponse> {
  const mime = file.mimeType;
  const inline = mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/");
  const base: Record<string, string> = {
    "content-type": mime,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=3600",
    "accept-ranges": "bytes",
  };
  const range = parseByteRange(req.headers.get("range"), file.size);
  if (range.kind === "unsatisfiable") {
    return new NextResponse(null, { status: 416, headers: { ...base, "content-range": `bytes */${file.size}` } });
  }
  if (range.kind === "partial") {
    return new NextResponse(await file.stream(range), {
      status: 206,
      headers: { ...base, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${file.size}` },
    });
  }
  return new NextResponse(await file.stream(null), { status: 200, headers: { ...base, "content-length": String(file.size) } });
}
