/**
 * C2.8 — where the person came from, inside the chat, so «back» GOES BACK instead of stacking another entry. A swipe from the start edge, the conversation
 * header's arrow and the info screen's arrow all mean «the screen I came from»: when the screen before this one IS the target, the browser's own history is
 * popped (`router.back()`), so the hardware back button and the browser's back do not bounce between the same two screens; when it is not (a conversation opened
 * from a notification, a link in a message, a reload) the target REPLACES the current entry (`router.replace`), so the person still stays inside the chat.
 * The chat shell tells the trail about every address it shows. Client only: nothing here is read on the server.
 */
export interface NavTrail {
  visit: (path: string) => void;
  previous: () => string | null;
  reset: () => void;
}

export function createNavTrail(): NavTrail {
  let current: string | null = null;
  let before: string | null = null;
  return {
    visit(path) {
      if (path === current) return;
      before = current;
      current = path;
    },
    previous: () => before,
    reset() {
      current = null;
      before = null;
    },
  };
}

/** The one trail of this browser tab. */
export const navTrail = createNavTrail();

export type BackAction = "back" | "replace";

/** `back`: pop the history (the screen before this one is the target). `replace`: swap this entry for the target. */
export function backActionFor(trail: Pick<NavTrail, "previous">, target: string): BackAction {
  return trail.previous() === target ? "back" : "replace";
}
