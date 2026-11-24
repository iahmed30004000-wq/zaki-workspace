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
  c_deletebot: "/deletebot",
  c_start: "/start",
  c_confirm: "confirm",
  c_bot: "bot",
};

export const BOTFATHER_COMMANDS = ["newbot", "mybots", "token", "revoke", "setdescription", "setcommands", "setwebhook", "setavatar", "deletebot", "help"] as const;
export type BotFatherCommand = (typeof BOTFATHER_COMMANDS)[number];

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
