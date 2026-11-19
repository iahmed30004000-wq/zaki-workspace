import { arabicPlural } from "@/lib/format";
import { ct } from "@/lib/chat/text";

/**
 * C2.4 — the two counted phrases of the pane, in their Arabic number forms, with the FULL key of every form written out (so a key that nothing uses is
 * visible to the dead-key guard, and a form that is missing is a type error here instead of a raw key on screen).
 */
type Forms = Readonly<Record<"one" | "two" | "few" | "many", string>>;

export const CALLS_FORMS: Forms = {
  one: "chatui.pane.calls.one",
  two: "chatui.pane.calls.two",
  few: "chatui.pane.calls.few",
  many: "chatui.pane.calls.many",
};

export const MENTIONS_FORMS: Forms = {
  one: "chatui.pane.mentions.one",
  two: "chatui.pane.mentions.two",
  few: "chatui.pane.mentions.few",
  many: "chatui.pane.mentions.many",
};

export function counted(forms: Forms, n: number): string {
  return ct(forms[arabicPlural(n)], { n });
}
