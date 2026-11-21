/**
 * S5.2 — the forward sheet's shared rules, pure (no database, no React): the shapes of the picker's door (`GET /api/chat/forward-targets`), the caps, the Arabic-aware
 * search, the grouping by space, the pick (up to ten), what a send's answer means and the one request body both flows (a single «حوّل» and the multi-select) post.
 * The server decides every target again on send (`forwardMessages`): nothing here is a permission, it only shapes what the person sees.
 */

/** The most conversations one forward goes to (the server holds the same cap: `MULTI_MAX_TARGETS`). */
export const FORWARD_MAX_TARGETS = 10;
/** The longest comment that travels with a forward. */
export const FORWARD_COMMENT_MAX = 1000;
/** How many recent conversations the sheet shows as the avatar strip. */
export const FORWARD_RECENTS = 6;
/** The id the sheet gives my saved chat while it does not exist yet: it is made by the dm door at the moment of sending. */
export const SAVED_NEW_ID = "saved:new";

export type ForwardTargetKind = "SAVED" | "TOPIC" | "DM" | "GROUP";

/** One place a message may go. `id` is the conversation (or `SAVED_NEW_ID` for a saved chat not made yet). */
export interface ForwardTargetDto {
  id: string;
  kind: ForwardTargetKind;
  /** a topic's title, a person's name, a group's title, «الرسائل المحفوظة» for the saved chat (drawn from the dictionary by the sheet) */
  title: string;
  emoji: string | null;
  /** the person's picture (a private chat only) */
  avatarUrl: string | null;
  /** the space a topic lives in (null for a private chat) */
  spaceId: string | null;
  spaceName: string | null;
  /** when the newest message of it was written (ISO) */
  lastAt: string | null;
}

export interface ForwardTargetsDto {
  /** my saved chat: present when the company's switch is on and I am not a guest; `id` is null until the first time it is used */
  saved: { id: string | null } | null;
  /** every place I may write in, in every space I am in and my private chats (never the saved chat: it is `saved`) */
  targets: ForwardTargetDto[];
  /** the ids of the most recently active ones, newest first */
  recents: string[];
}

const TASHKEEL = /[ً-ٰٟـ]/g;
const ARABIC_DIGITS = /[٠-٩]/g;

/** What the search compares: no vowel marks, one shape of alef / ya / ta marbuta, Western digits, lower case. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the target answer the search (its title or its space's name; every word of the search must be found)? An empty search matches everything. */
export function matchesTarget(target: Pick<ForwardTargetDto, "title" | "spaceName">, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalizeSearch(`${target.title} ${target.spaceName ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/** The targets the search keeps, never the conversation the message is in (`from`). */
export function visibleTargets(targets: readonly ForwardTargetDto[], query: string, from: string | null): ForwardTargetDto[] {
  return targets.filter((t) => t.id !== from && matchesTarget(t, query));
}

export interface TargetGroup {
  /** the space's id, or null for the private chats and groups */
  spaceId: string | null;
  /** the space's name, or null for the private chats (the sheet draws its own heading) */
  spaceName: string | null;
  items: ForwardTargetDto[];
}

/** The list under the recents: one group per space in the order the server gave, the private chats and groups last. */
export function groupBySpace(targets: readonly ForwardTargetDto[]): TargetGroup[] {
  const groups: TargetGroup[] = [];
  const bySpace = new Map<string, TargetGroup>();
  const privateGroup: TargetGroup = { spaceId: null, spaceName: null, items: [] };
  for (const t of targets) {
    if (t.kind === "DM" || t.kind === "GROUP" || !t.spaceId) {
      privateGroup.items.push(t);
      continue;
    }
    let g = bySpace.get(t.spaceId);
    if (!g) {
      g = { spaceId: t.spaceId, spaceName: t.spaceName, items: [] };
      bySpace.set(t.spaceId, g);
      groups.push(g);
    }
    g.items.push(t);
  }
  if (privateGroup.items.length) groups.push(privateGroup);
  return groups;
}

/** The recents strip: the ids the server named, in its order, that are still on the list and not the conversation the message is in. */
export function recentTargets(dto: Pick<ForwardTargetsDto, "targets" | "recents">, from: string | null, query = ""): ForwardTargetDto[] {
  const byId = new Map(dto.targets.map((t) => [t.id, t]));
  return dto.recents
    .map((id) => byId.get(id))
    .filter((t): t is ForwardTargetDto => !!t && t.id !== from && matchesTarget(t, query))
    .slice(0, FORWARD_RECENTS);
}

/** The saved chat as a row of the sheet (always first), or null when the company's switch is off / the person is a guest. */
export function savedTarget(dto: Pick<ForwardTargetsDto, "saved">, title: string): ForwardTargetDto | null {
  if (!dto.saved) return null;
  return { id: dto.saved.id ?? SAVED_NEW_ID, kind: "SAVED", title, emoji: null, avatarUrl: null, spaceId: null, spaceName: null, lastAt: null };
}

/** Pick or unpick: one more up to the cap, never more (a tenth is the last one that is taken). */
export function togglePick(picked: readonly string[], id: string, max = FORWARD_MAX_TARGETS): string[] {
  if (picked.includes(id)) return picked.filter((x) => x !== id);
  return picked.length >= max ? [...picked] : [...picked, id];
}

/** The comment as it travels: trimmed, cut at the cap, nothing when it is empty. */
export function cleanComment(text: string): string | undefined {
  const t = text.trim().slice(0, FORWARD_COMMENT_MAX);
  return t.length ? t : undefined;
}

export interface ForwardRequest {
  messageIds: string[];
  targetIds: string[];
  withoutAuthor: boolean;
  comment?: string;
}

/** The ONE body of `POST /api/chat/messages/forward` (the single «حوّل» and the multi-select send the same). */
export function forwardBody(input: { messageIds: readonly string[]; targetIds: readonly string[]; withoutAuthor: boolean; comment: string }): ForwardRequest {
  const comment = cleanComment(input.comment);
  return { messageIds: [...input.messageIds], targetIds: [...input.targetIds], withoutAuthor: input.withoutAuthor, ...(comment ? { comment } : {}) };
}

export type ForwardResult = { targetId: string; ok: boolean; ids?: string[]; error?: string };

export interface ForwardOutcome {
  /** the targets that got their copies */
  ok: string[];
  /** how many did not */
  failed: number;
  /** "all": every target; "some": at least one; "none" */
  state: "all" | "some" | "none";
  /** the one conversation «افتح» jumps to: only when exactly one target was asked and it worked */
  openId: string | null;
}

/** After a partial answer: the picks that did NOT get their copies (the saved chat's placeholder counts as the id it was made under), so a retry never copies twice. */
export function remainingPicks(picked: readonly string[], okIds: readonly string[], savedId: string | null): string[] {
  return picked.filter((id) => !okIds.includes(id === SAVED_NEW_ID && savedId ? savedId : id));
}

/** The saved chat's row, unless it is the conversation the message is in (never offered, like every other one). */
export function savedRowFor(dto: Pick<ForwardTargetsDto, "saved">, title: string, from: string | null): ForwardTargetDto | null {
  const row = savedTarget(dto, title);
  return row && row.id !== from ? row : null;
}

/** What a send's answer means (the door answers per target; a door that refused as a whole is `null`). */
export function outcomeOf(results: readonly ForwardResult[] | null): ForwardOutcome {
  if (!results || results.length === 0) return { ok: [], failed: 0, state: "none", openId: null };
  const ok = results.filter((r) => r.ok).map((r) => r.targetId);
  const failed = results.length - ok.length;
  const state = ok.length === 0 ? "none" : failed === 0 ? "all" : "some";
  return { ok, failed, state, openId: results.length === 1 && ok.length === 1 ? (ok[0] ?? null) : null };
}
