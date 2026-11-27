import { NextResponse } from "next/server";
import { parseByteRange } from "@/server/files/range";

/**
 * The bytes of a stored file as an answer (the server's disk, or proxied from Drive: only the asked range is fetched). Never a Drive link. WHO may have them is the caller's
 * to decide, before this is called. Used by the attachment door and by the door of a kept GIF.
 */
export async function bytesResponse(
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
