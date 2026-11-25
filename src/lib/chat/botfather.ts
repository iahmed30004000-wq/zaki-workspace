/**
 * «بوت فاذر» — the pure part (no database): how the conversation with the bot maker is named and recognised, and how a message to it is read.
 * The conversation is a restricted topic whose `dmKey` is `botfather|<userId>@<spaceId>` (see src/server/services/botfather.ts), like the assistant's.
 */
export const BOTFATHER_PREFIX = "botfather|";
export const BOTFATHER_TITLE = "بوت فاذر";
export const BOTFATHER_EMOJI = "🤖";

export const botFatherChatKey = (userId: string, spaceId: string): string => `${BOTFATHER_PREFIX}${userId}@${spaceId}`;
/** Is it somebody's conversation with «بوت فاذر» (of anybody)? */
export const isBotFatherChatKey = (dmKey: string | null | undefined): boolean => typeof dmKey === "string" && dmKey.startsWith(BOTFATHER_PREFIX);
/** Is it the conversation of this very person? */
export const isBotFatherChatOf = (dmKey: string | null | undefined, userId: string): boolean => typeof dmKey === "string" && dmKey.startsWith(`${BOTFATHER_PREFIX}${userId}@`);

/** A bot's handle, as Telegram's: lower-case letters, digits and underscores, 5 to 32 characters, starting with a letter and ending in «bot». */
export const BOT_USERNAME = /^[a-z][a-z0-9_]{1,28}bot$/;
export const BOT_NAME_MAX = 40;
export const BOT_DESCRIPTION_MAX = 240;
export const BOT_COMMANDS_MAX = 30;
export const BOT_COMMAND_NAME = /^[a-z][a-z0-9_]{0,31}$/;

export function normalizeBotUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}
export const isBotUsername = (value: string): boolean => BOT_USERNAME.test(value);

export interface BotCommandDef {
  command: string;
  description: string;
}

/**
 * The lines of «/setcommands»: «/command - what it does», one per line (the slash is optional, a dash or a colon may separate). A line that is not one is
 * refused with its number (`error`), the commands are unique and at most `BOT_COMMANDS_MAX`.
 */
export function parseBotCommands(text: string): { ok: true; commands: BotCommandDef[] } | { ok: false; line: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const commands: BotCommandDef[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const m = /^\/?([A-Za-z][A-Za-z0-9_]{0,31})\s*[-:–—]\s*(.{1,120})$/.exec(line);
    if (!m) return { ok: false, line: index + 1 };
    const command = m[1]!.toLowerCase();
    if (!BOT_COMMAND_NAME.test(command) || seen.has(command)) return { ok: false, line: index + 1 };
    seen.add(command);
    commands.push({ command, description: m[2]!.trim() });
    if (commands.length > BOT_COMMANDS_MAX) return { ok: false, line: index + 1 };
  }
  return { ok: true, commands };
}

/** The words the dictionary refers to as placeholders (`{c_token}`…): the commands are Latin letters and must never be Arabic text, so the sentences hold the slot, not the word. */
export const BOTFATHER_WORDS: Readonly<Record<string, string>> = {
  c_newbot: "/newbot",
  c_mybots: "/mybots",
  c_token: "/token",
  c_revoke: "/revoke",
  c_setdescription: "/setdescription",
  c_setcommands: "/setcommands",
  c_setwebhook: "/setwebhook",
  c_setavatar: "/setavatar",
  c_deletebot: "/deletebot",
  c_start: "/start",
  c_setname: "/setname",
  c_setabouttext: "/setabouttext",
  c_setuserpic: "/setuserpic",
  c_setjoingroups: "/setjoingroups",
  c_setprivacy: "/setprivacy",
  c_cancel: "/cancel",
  c_empty: "/empty",
  c_help: "/help",
  c_enable: "enable",
  c_disable: "disable",
  c_confirm: "confirm",
  c_bot: "bot",
};

export const BOTFATHER_COMMANDS = ["newbot", "mybots", "setname", "setdescription", "setabouttext", "setuserpic", "setavatar", "setcommands", "setjoingroups", "setprivacy", "setwebhook", "token", "revoke", "deletebot", "cancel", "help", "start"] as const;
export type BotFatherCommand = (typeof BOTFATHER_COMMANDS)[number];

/** «/setabouttext»'s longest line (the profile's own limit is longer; Telegram's about text is this short). */
export const BOT_ABOUT_MAX = 120;

/** The commands that work ON a bot: without a handle they ask «which one?». */
export const BOT_TARGET_COMMANDS = ["setname", "setdescription", "setabouttext", "setuserpic", "setavatar", "setcommands", "setjoingroups", "setprivacy", "setwebhook", "token", "revoke", "deletebot"] as const;
export type BotTargetCommand = (typeof BOT_TARGET_COMMANDS)[number];
export const isBotTargetCommand = (value: string): value is BotTargetCommand => (BOT_TARGET_COMMANDS as readonly string[]).includes(value);

/** Is the chat list's search looking for the bot maker? («بوت», «فاذر», «botfather»…, three letters at least). Pure. */
export function asksForBotFather(query: string): boolean {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (q.length < 3) return false;
  return ["بوت", "فاذر", "بوت فاذر", "botfather"].some((word) => word.startsWith(q) || q.startsWith(word));
}

/** What the «/» menu of the chat lists, in order (the words that say what each does are the dictionary's `botfather.cmd.<name>`). */
export const BOTFATHER_MENU = ["newbot", "mybots", "setname", "setdescription", "setabouttext", "setuserpic", "setcommands", "setjoingroups", "setprivacy", "setwebhook", "token", "revoke", "deletebot", "cancel", "help"] as const;

/** The «/» menu for what is typed: only while the box holds one word that starts with a slash. Pure. */
export function botFatherSuggestions(text: string): (typeof BOTFATHER_MENU)[number][] {
  const m = /^\/([A-Za-z]*)$/.exec(text);
  if (!m) return [];
  const typed = m[1]!.toLowerCase();
  return BOTFATHER_MENU.filter((c) => c.startsWith(typed) && c !== typed);
}

/** A button under a line of «بوت فاذر»: what it says, and what a press asks for. */
export interface BotButton {
  t: string;
  d: string;
}
export type BotKeyboard = BotButton[][];

/** A line's words are strings and numbers only (`SystemMeta`), so the keyboard travels as one string. */
export const encodeKeyboard = (kb: BotKeyboard): string => JSON.stringify(kb.map((row) => row.map((b) => [b.t, b.d])));
export function decodeKeyboard(raw: unknown): BotKeyboard {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      if (!Array.isArray(row)) return [];
      const buttons = row.flatMap((b) => (Array.isArray(b) && typeof b[0] === "string" && typeof b[1] === "string" ? [{ t: b[0], d: b[1] }] : []));
      return buttons.length ? [buttons] : [];
    });
  } catch {
    return [];
  }
}

/** What a line is waiting to hear: the next message of the person answers it. */
export interface BotAsk {
  /** the command being filled in */
  c: BotFatherCommand;
  /** «which name?», «which handle for the new bot?», «which of your bots?», «the new value?» */
  s: "name" | "username" | "bot" | "value";
  /** the bot the value is for */
  u?: string;
  /** «/newbot»: the name already given */
  n?: string;
}
export const encodeAsk = (ask: BotAsk): string => JSON.stringify(ask);
export function decodeAsk(raw: unknown): BotAsk | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const a = JSON.parse(raw) as Partial<BotAsk> | null;
    if (!a || typeof a.c !== "string" || !(BOTFATHER_COMMANDS as readonly string[]).includes(a.c)) return null;
    if (a.s !== "name" && a.s !== "username" && a.s !== "bot" && a.s !== "value") return null;
    return { c: a.c as BotFatherCommand, s: a.s, ...(typeof a.u === "string" ? { u: a.u } : {}), ...(typeof a.n === "string" ? { n: a.n } : {}) };
  } catch {
    return null;
  }
}

/**
 * Does this message leave the question and start a new command? Every known command does, except while the LIST of commands is being asked for: its lines start with a
 * slash too («/start - …»), so there only a message that is not a valid list can interrupt.
 */
export function interruptsAsk(body: string, ask: BotAsk): boolean {
  if (parseBotFatherCall(body).command === null) return false;
  if (ask.c === "setcommands" && ask.s === "value") {
    const list = parseBotCommands(body);
    return !(list.ok && list.commands.length > 0);
  }
  return true;
}

export interface BotFatherCall {
  command: BotFatherCommand | null;
  /** the first word after the command, when it is a handle («@name» or «name»), lower-case and without the «@» */
  handle: string | null;
  /** everything after the command (and the handle, when there is one), as written, trimmed (new lines kept) */
  rest: string;
  /** the whole text after the command, trimmed */
  args: string;
}

/**
 * Reads a message to «بوت فاذر»: «/command @handle the rest». A message that does not start with a known command is `command: null` (the reply is the help). Pure.
 * The Arabic words of the commands are not accepted: the commands are Telegram's, typed in the keyboard's Latin letters, as every bot's.
 */
export function parseBotFatherCall(body: string): BotFatherCall {
  const text = body.replace(/^\s+/, "");
  const m = /^\/([A-Za-z]+)(?:@[A-Za-z0-9_]+)?(?:[ \t]+([\s\S]*))?$/.exec(text.trim());
  const word = m?.[1]?.toLowerCase();
  const command = (BOTFATHER_COMMANDS as readonly string[]).includes(word ?? "") ? (word as BotFatherCommand) : null;
  const args = (m?.[2] ?? "").trim();
  const first = /^@?([A-Za-z][A-Za-z0-9_]*)(?=\s|$)/.exec(args);
  const handle = first ? first[1]!.toLowerCase() : null;
  const rest = first ? args.slice(first[0].length).trim() : args;
  return { command, handle, rest, args };
}

/** «/newbot الاسم @username»: the name is everything before the last word, which is the handle (with or without «@»). */
export function parseNewBot(args: string): { name: string; username: string } | null {
  const m = /^([\s\S]+?)\s+@?([A-Za-z][A-Za-z0-9_]*)$/.exec(args.trim());
  if (!m) return null;
  return { name: m[1]!.trim().replace(/\s+/g, " "), username: m[2]!.toLowerCase() };
}
