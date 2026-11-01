export interface MentionQuery {
  query: string;
  /** Index of the `@` token, after any separating whitespace. */
  start: number;
}

/** Find an `@name` query only at the start of a word or after whitespace. */
export function findMentionQuery(value: string): MentionQuery | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(value);
  if (!match) return null;
  const separator = match[1] ?? "";
  return { query: match[2] ?? "", start: match.index + separator.length };
}

/** Replace the active mention query while preserving whitespace before it. */
export function insertMention(value: string, name: string): string {
  const active = findMentionQuery(value);
  if (!active) return value;
  return `${value.slice(0, active.start)}@${name} `;
}

export function selectedMentionIds(value: string, selected: readonly { id: string; name: string }[]): string[] {
  return selected
    .filter(({ name }) => {
      const token = `@${name}`;
      let index = value.indexOf(token);
      while (index >= 0) {
        const before = index === 0 || /\s/.test(value[index - 1] ?? "");
        const next = value[index + token.length];
        const after = next === undefined || /[\s,،.!?؟]/.test(next);
        if (before && after) return true;
        index = value.indexOf(token, index + token.length);
      }
      return false;
    })
    .map(({ id }) => id);
}

/** «@الكل»: the word that reaches everybody the topic reaches. The message stores `MENTION_ALL_ID` among its mentions. */
export const MENTION_ALL_NAME = "الكل";
export const MENTION_ALL_ID = "*";

/**
 * «@المساعد»: the company's AI helper, offered in the «@» list only while «قراءة الدردشات للمساعد» is on. It is not a person: no
 * user row, never stored in a message's `mentions`; the server finds the word in the body (`mentionsAssistant`) and answers once.
 */
export const ASSISTANT_MENTION_NAME = "المساعد";
export const ASSISTANT_MENTION_ID = "assistant";

const MENTION_END = /[\s,،.!?؟:؛;]/;

/** The pieces of a body: plain text, and each `@name` of `names` that stands as a whole word (longest name first). */
export function splitMentions(body: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const ordered = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  const out: { text: string; mention: boolean }[] = [];
  let plain = "";
  let i = 0;
  while (i < body.length) {
    const startsWord = body[i] === "@" && (i === 0 || /\s/.test(body[i - 1] ?? ""));
    const name = startsWord
      ? ordered.find((n) => {
          if (!body.startsWith(n, i + 1)) return false;
          const next = body[i + 1 + n.length];
          return next === undefined || MENTION_END.test(next);
        })
      : undefined;
    if (name === undefined) {
      plain += body[i];
      i += 1;
      continue;
    }
    if (plain) out.push({ text: plain, mention: false });
    plain = "";
    out.push({ text: `@${name}`, mention: true });
    i += 1 + name.length;
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

/** True when the body addresses everybody with «@الكل». */
export function mentionsAll(body: string): boolean {
  return splitMentions(body, [MENTION_ALL_NAME]).some((piece) => piece.mention);
}

/** True when the body addresses the assistant with «@المساعد» as a whole word. */
export function mentionsAssistant(body: string): boolean {
  return splitMentions(body, [ASSISTANT_MENTION_NAME]).some((piece) => piece.mention);
}

/** Does a message's `mentions` reach this person: by name, or by «@الكل»? */
export function isMentioned(mentions: readonly string[], userId: string): boolean {
  return mentions.includes(userId) || mentions.includes(MENTION_ALL_ID);
}

/** Letters compared the way people type them: no marks, one alef, one ya, one ha. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

/** The people the typed letters point at: names that START with them first, then names that contain them; online first inside each. */
export function filterMentionChoices<T extends { name: string; online?: boolean }>(people: readonly T[], query: string): T[] {
  const q = normalizeName(query.trim());
  const online = (p: T) => (p.online ? 0 : 1);
  const ranked = people
    .map((person, index) => ({ person, index, name: normalizeName(person.name) }))
    .filter((row) => q === "" || row.name.includes(q))
    .map((row) => ({ ...row, rank: q === "" || row.name.startsWith(q) || row.name.split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1 }));
  ranked.sort((a, b) => a.rank - b.rank || online(a.person) - online(b.person) || a.index - b.index);
  return ranked.map((row) => row.person);
}
