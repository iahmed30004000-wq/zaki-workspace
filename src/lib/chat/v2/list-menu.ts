/**
 * The main «⋮» menu of the chat list (S6.6, under `tgLook`): what it offers. «الوضع» (day ⇄ night) is for everybody; the contacts screen, a new group and the saved messages need the
 * private side of the chat (an external partner has none of it); a new group only where the person may open one (the list column decides that).
 */
export type ListMenuItem = "theme" | "contacts" | "group" | "saved";

export function listMenuItemsOf(input: { guest: boolean; canGroup: boolean }): ListMenuItem[] {
  if (input.guest) return ["theme"];
  return ["theme", "contacts", ...(input.canGroup ? (["group"] as const) : []), "saved"];
}
