import { NOTIFY_TYPES, type NotifyType } from "@/lib/chat/prefs";
import { isSoundEvent, type SoundEvent } from "./choice";

/**
 * The addresses of the two kinds of sub-page the sounds work added inside «إعداداتي»: one event's radio list (`/settings/me/sounds?kind=ring`) and one
 * notification type's page (`/settings/me/notifications?type=private`). A query, not a new route: the section's own page draws them, back and reload work.
 */
export const SOUNDS_HREF = "/settings/me/sounds";
export const NOTIFICATIONS_HREF = "/settings/me/notifications";

export const soundsSubHref = (event: SoundEvent): string => `${SOUNDS_HREF}?kind=${event}`;
export const notifySubHref = (type: NotifyType): string => `${NOTIFICATIONS_HREF}?type=${type}`;

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export function soundKindOf(value: string | string[] | undefined): SoundEvent | null {
  const kind = one(value);
  return isSoundEvent(kind) ? kind : null;
}

export function notifyKindOf(value: string | string[] | undefined): NotifyType | null {
  const type = one(value);
  return (NOTIFY_TYPES as readonly string[]).includes(type ?? "") ? (type as NotifyType) : null;
}
