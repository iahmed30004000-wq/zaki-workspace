"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * C2.1 — how the chat's list column reaches the ONE rail. The rail (and the old side menu, with the switch `navV2` off) is drawn by `AppShell`, which is
 * ABOVE the chat's layout in the tree; the layout cannot pass a prop up. So the shell offers this setter through a context, and the chat shell hands it the
 * column to draw beside the rail (`listSlot` of `src/components/shell/rail.tsx`; N1.2). There is no second rail and no second drawer: the column is
 * drawn by the frame that is already there, and it stays mounted while `/chat/a` becomes `/chat/b` because the setter belongs to the frame, not to the page.
 *
 * Outside the frame (a test, a page rendered on its own) there is no setter and the registration does nothing.
 */
type RegisterListSlot = (node: ReactNode) => void;

const ListSlotContext = createContext<RegisterListSlot | null>(null);

export const ListSlotProvider = ListSlotContext.Provider;

export function useRegisterListSlot(): RegisterListSlot | null {
  return useContext(ListSlotContext);
}
