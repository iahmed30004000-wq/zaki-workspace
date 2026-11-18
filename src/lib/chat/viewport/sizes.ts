import type { AttachmentDto } from "@/server/chat/dto";
import type { Row } from "@/lib/chat/viewport/rows";

/**
 * C1.7 — what the virtual list knows about a row BEFORE it is drawn and measured. Pure.
 *
 * - A picture reserves its box from the attachment's own `width` / `height` (the server sends them); an older row without them gets
 *   ONE fixed fallback box, so nothing moves when the picture loads. The bubble of C2 draws the same box (`imageBox`) with CSS
 *   `aspect-ratio`, so the estimate and the drawing agree.
 * - A voice row has a fixed height (`VOICE_ROW_PX`), whatever its length and waveform: the bubble of C2 is that tall.
 * - Everything else is an estimate for the scrollbar and the first paint; the real height is measured (`measureElement`).
 */

export const IMAGE_MAX_W = 280;
export const IMAGE_MAX_H = 320;
/** width / height of the box of a picture that has no size */
export const FALLBACK_ASPECT = 4 / 3;
export const VOICE_ROW_PX = 72;
export const DAY_ROW_PX = 44;
export const UNREAD_ROW_PX = 44;
/** the chip of a folded run of call lines */
export const CALLS_ROW_PX = 44;

const SYSTEM_ROW_PX = 40;
const DELETED_ROW_PX = 48;
const TEXT_BASE_PX = 56;
const TEXT_LINE_PX = 22;
/** about how many characters a line of a bubble holds */
const CHARS_PER_LINE = 34;
const ATTACHMENT_GAP_PX = 8;
const FILE_ROW_PX = 64;
const POLL_ROW_PX = 180;
const CARD_ROW_PX = 140;
const REPLY_PX = 48;
const REACTIONS_PX = 30;

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** The box a picture (or a video poster) reserves. */
export function imageBox(attachment: Pick<AttachmentDto, "width" | "height">, maxW: number = IMAGE_MAX_W, maxH: number = IMAGE_MAX_H): { width: number; height: number } {
  const { width, height } = attachment;
  if (!valid(width) || !valid(height)) return { width: maxW, height: Math.round(maxW / FALLBACK_ASPECT) };
  const scale = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function attachmentPx(a: AttachmentDto): number {
  if (a.kind === "IMAGE" || a.kind === "VIDEO") return imageBox(a).height + ATTACHMENT_GAP_PX;
  if (a.kind === "AUDIO") return VOICE_ROW_PX;
  return FILE_ROW_PX;
}

export function estimateRowHeight(row: Row): number {
  if (row.type === "day") return DAY_ROW_PX;
  if (row.type === "unread") return UNREAD_ROW_PX;
  if (row.type === "calls") return CALLS_ROW_PX;
  const m = row.message;
  if (m.kind === "VOICE") return VOICE_ROW_PX;
  if (m.kind === "SYSTEM") return SYSTEM_ROW_PX;
  if (m.deleted) return DELETED_ROW_PX;
  if (m.kind === "POLL") return POLL_ROW_PX;
  if (m.kind === "CARD") return CARD_ROW_PX;
  const lines = m.body ? m.body.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0) : 0;
  let px = TEXT_BASE_PX + Math.max(1, lines) * TEXT_LINE_PX;
  for (const a of m.attachments) px += attachmentPx(a);
  if (m.replyTo) px += REPLY_PX;
  if (m.reactions.length) px += REACTIONS_PX;
  return Math.round(px);
}
