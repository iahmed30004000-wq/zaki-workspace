/**
 * C2.6 — what the list column and the open pane tell the keyboard module (`src/lib/chat/shortcuts.ts`), which is mounted ONCE from the chat shell, above
 * both. The list knows its rows (in the folder the person is looking at) and its folders; the pane knows how to open its search and close its panel. Each
 * registers while it is on screen and the shortcuts read the current one — no file of the list or the pane imports the other, and nothing is stored.
 *
 * A source removes only ITSELF when it goes (a newer source registered meanwhile — a list that was rebuilt, a pane of the next conversation — stays).
 */
export interface ChatListEntry {
  id: string;
  unread: boolean;
}

export interface ListSource {
  /** the conversation rows in the order they are drawn (a space row is not a conversation) */
  entries: () => readonly ChatListEntry[];
  folderCount: () => number;
  selectFolder: (index: number) => void;
}

export interface PaneSource {
  conversationId: string;
  openSearch: () => void;
  closeSearch: () => void;
  closeInfo: () => void;
  infoOpen: () => boolean;
  searchOpen: () => boolean;
}

let list: ListSource | null = null;
let pane: PaneSource | null = null;

export const shortcutBridge = {
  setList(source: ListSource): () => void {
    list = source;
    return () => {
      if (list === source) list = null;
    };
  },
  setPane(source: PaneSource): () => void {
    pane = source;
    return () => {
      if (pane === source) pane = null;
    };
  },
  list: (): ListSource | null => list,
  pane: (): PaneSource | null => pane,
};
