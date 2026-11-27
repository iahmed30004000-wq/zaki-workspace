/**
 * «الأصوات» — the pure words of the sounds library: the five events that make a sound, and what a person may choose for each. No React, no server import:
 * the account's schema (`src/lib/chat/prefs.ts`), the routes and the screens share it.
 *
 * A choice is one string: «none» («بلا صوت»), the id of one of OUR synthesized sounds (`catalog.ts`) or `custom:<file id>` (a sound the person uploaded).
 * NO choice is «افتراضي»: the event sounds exactly as it did before the library existed.
 */
export const SOUND_EVENTS = ["sent", "received", "inChat", "ringback", "ring"] as const;
/**
 * «صوت لكل نوع إشعار» (`chatTypeSounds`): a message sound of its own for each KIND of notification (`NOTIFY_TYPES` of `src/lib/chat/prefs.ts`): a private chat, topics and groups,
 * a mention, a reply to me. Kept in the same section of the account (`User.chatPrefs.sounds`) beside the five events, which stay what they were. A call needs none here:
 * «calls» is the event `ring`. No choice for a kind: it sounds like the app's own event (`received` in the open conversation, `inChat` elsewhere).
 */
export const TYPE_SOUND_EVENTS = ["typePrivate", "typeTopics", "typeMentions", "typeReplies"] as const;
export type TypeSoundEvent = (typeof TYPE_SOUND_EVENTS)[number];
/** Every key a choice may be stored under. */
export const SOUND_KEYS = [...SOUND_EVENTS, ...TYPE_SOUND_EVENTS] as const;
export type SoundEvent = (typeof SOUND_KEYS)[number];

/** The key of a kind's own sound; null for the calls (their sound is `ring`). */
export const TYPE_SOUND_OF = { private: "typePrivate", topics: "typeTopics", mentions: "typeMentions", replies: "typeReplies", calls: null } as const satisfies Record<string, TypeSoundEvent | null>;
export const isTypeSoundEvent = (value: unknown): value is TypeSoundEvent => typeof value === "string" && (TYPE_SOUND_EVENTS as readonly string[]).includes(value);

export type SoundChoices = Partial<Record<SoundEvent, string>>;

export const NO_SOUND = "none";
const CUSTOM_PREFIX = "custom:";
/** «none», a built-in id (small letters, digits, dashes) or `custom:<a plain id>` — never an address, never a path. */
export const SOUND_CHOICE = /^(?:[a-z][a-z0-9-]{0,31}|custom:[A-Za-z0-9][A-Za-z0-9_-]{0,63})$/;

export const isSoundChoice = (value: unknown): value is string => typeof value === "string" && SOUND_CHOICE.test(value);
export const isSoundEvent = (value: unknown): value is SoundEvent => typeof value === "string" && (SOUND_KEYS as readonly string[]).includes(value);

/** The file id of `custom:<id>`, or null. */
export const customIdOf = (choice: string): string | null => (isSoundChoice(choice) && choice.startsWith(CUSTOM_PREFIX) ? choice.slice(CUSTOM_PREFIX.length) : null);
export const customChoice = (fileId: string): string => CUSTOM_PREFIX + fileId;

/** Where an uploaded sound is read from: a route that answers its OWNER only. */
export const customSoundUrl = (fileId: string): string => `/api/me/sounds/${encodeURIComponent(fileId)}`;

/** The upload's limits (the server holds them; the screen says them). */
export const SOUND_MAX_BYTES = 1024 * 1024;
export const SOUND_MAX_COUNT = 20;
