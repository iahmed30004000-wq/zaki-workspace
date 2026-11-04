import { MAIL_LIMITS, excerptOf } from "@/lib/mail-to-task";

/**
 * «بريد يصير مهمة» — the text of ONE mail part as plain text.
 *
 * The part arrives as UTF-8 text with its type (text/plain or text/html), never as a whole message: the source asks the server for that
 * one part alone. `mailparser` does the one hard thing, turning HTML into readable text (a link stays as its words and its address,
 * styles, scripts and comments are dropped, entities are decoded): the part is wrapped in a two-line header so the parser sees a message
 * with a single text body and no attachment, and attachments are ignored on top of that. Nothing leaves this function but a string.
 */

/** A part this large is not read at all: the parser would spend more time than a task is worth. */
const MAX_PART_CHARS = 300_000;

export async function bodyToText(type: "text/plain" | "text/html" | null, body: string | null): Promise<string> {
  if (!type || !body) return "";
  const text = body.length > MAX_PART_CHARS ? body.slice(0, MAX_PART_CHARS) : body;
  if (type === "text/plain") return excerptOf(text, MAIL_LIMITS.excerpt * 2);
  try {
    // loaded here, never at the top of the file: a Node-only package must not be walked by the bundler
    const { simpleParser } = await import("mailparser");
    const wrapped = Buffer.from(`Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}`, "utf8");
    // `skipHtmlToText` stays off (that is the point); `skipImageLinks`: an inline picture is not text; no attachment is kept
    const parsed = await simpleParser(wrapped, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true, maxHtmlLengthToParse: MAX_PART_CHARS });
    return excerptOf(parsed.text ?? "", MAIL_LIMITS.excerpt * 2);
  } catch {
    // an HTML the parser cannot read: the task is made from the subject alone
    return "";
  }
}
