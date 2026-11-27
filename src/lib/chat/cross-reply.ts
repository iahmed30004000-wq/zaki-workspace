import { stripFormatting } from "@/lib/chat/format/parse";
import { zakiToWords } from "@/lib/chat/zaki-emoji";
import { articleTitleOf, ARTICLE_KIND } from "@/lib/chat/article";

/**
 * «الرد في محادثة أخرى» — what is carried from the source into the other conversation. PURE, and shared by the server (which takes the snapshot at send time) and the
 * composer (which shows the person, BEFORE sending, exactly what the others will read), so the two can never disagree.
 *
 * Carried: the writer's name and at most `CROSS_TEXT_MAX` characters of the words. Never the source conversation's name, never its id, never a file's name or bytes.
 * The words are stripped of their markers from the WHOLE body first (a spoiler is masked, a link keeps its label) and only then cut. A voice note carries no words
 * (its transcript is not the message), an article only its title.
 */
export const CROSS_TEXT_MAX = 200;

export type CrossKind = "text" | "photo" | "video" | "voice" | "file" | "poll" | "checklist" | "article" | "card";
export const CROSS_KINDS: readonly CrossKind[] = ["text", "photo", "video", "voice", "file", "poll", "checklist", "article", "card"];

export interface CrossSnapshot {
  /** the source writer's name as it was when the reply was sent */
  author: string;
  /** the short text (may be empty: a photo or a voice note with no words) */
  text: string;
  kind: CrossKind;
}

/** What kind of thing was answered: it names a message that has no words («صورة», «رسالة صوتية»). */
export function crossKindOf(kind: string, attachments: readonly { kind: string }[]): CrossKind {
  if (kind === "VOICE") return "voice";
  if (kind === "POLL") return "poll";
  if (kind === "CHECKLIST") return "checklist";
  if (kind === "CARD") return "card";
  if (kind === ARTICLE_KIND) return "article";
  const first = attachments[0]?.kind;
  if (first === "IMAGE") return "photo";
  if (first === "VIDEO") return "video";
  if (first === "AUDIO" || first === "FILE") return "file";
  return "text";
}

export function crossTextOf(kind: string, body: string | null): string {
  if (kind === "VOICE" || !body) return "";
  const source = kind === ARTICLE_KIND ? articleTitleOf(body) : body;
  const words = zakiToWords(stripFormatting(source, { math: true })).replace(/\s+/g, " ").trim();
  const chars = [...words];
  return chars.length <= CROSS_TEXT_MAX ? words : `${chars.slice(0, CROSS_TEXT_MAX - 1).join("").trimEnd()}…`;
}

export function crossSnapshotOf(source: { kind: string; body: string | null; authorName: string; attachments: readonly { kind: string }[] }): CrossSnapshot {
  return { author: source.authorName, text: crossTextOf(source.kind, source.body), kind: crossKindOf(source.kind, source.attachments) };
}

/** What the column holds is only believed after this: a broken value draws no quote. */
export function readCrossSnapshot(raw: unknown): CrossSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["author"] !== "string" || typeof r["text"] !== "string") return null;
  const kind = CROSS_KINDS.find((k) => k === r["kind"]);
  if (!kind) return null;
  return { author: r["author"], text: r["text"].slice(0, CROSS_TEXT_MAX * 2), kind };
}
