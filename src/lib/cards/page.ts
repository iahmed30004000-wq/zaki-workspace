/** «صفحة اللوحة»: the shapes the page inside a card travels in (JSON between the server and the screen). Types only. */

import type { CardItem } from "./shared";
import type { CardStatus } from "./status";
import type { RatingSummary } from "./rating";

/** What the viewer may do on this card's page, decided on the server from the session. */
export interface CardAbilities {
  /** Edit, pin, duplicate, send, make a task, archive, manage the gallery. */
  write: boolean;
  /** Leave stars and notes: a person IN the space (the owner reading silently is not). */
  participate: boolean;
  /** Move the approval status. */
  moderate: boolean;
  /** Add pictures to the gallery (needs the library). */
  gallery: boolean;
  /** See who rated what: the owner and the card's creator. */
  seeRaters: boolean;
  /** Internal sections (notes, versions, log, links) are for the team, never an external partner. */
  internal: boolean;
  /** The owner reading a card he is not a member of: silent, so no stars and no notes from him. */
  oversight: boolean;
  /** Bring a deleted card back (the owner). */
  restore: boolean;
  /** The statuses this person may move the card to from where it is. */
  statusMoves: CardStatus[];
}

export interface GalleryItem {
  id: string;
  fileId: string;
  position: number;
  caption: string | null;
  isCover: boolean;
  file: { name: string; mimeType: string; size: number };
}

export interface RaterRow {
  userId: string;
  name: string;
  stars: number;
}

export interface RatingView extends RatingSummary {
  /** The viewer's own stars. */
  mine: number | null;
  /** Everybody's stars: only for the owner and the card's creator. */
  raters: RaterRow[] | null;
}

export interface CardPageData {
  card: CardItem;
  abilities: CardAbilities;
  rating: RatingView | null;
  gallery: GalleryItem[];
  /** The space this card lives in (its name heads the page). */
  spaceId: string;
  spaceName: string;
}

export type NoteVisibility = "PUBLIC" | "PRIVATE";

export interface NoteItem {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  visibility: NoteVisibility;
  createdAt: string;
  editedAt: string | null;
}

export interface NotesView {
  /** The space's thread (null: an external partner does not read it). */
  publicNotes: NoteItem[] | null;
  /** The viewer's own private notes. */
  privateNotes: NoteItem[];
}

export interface RevisionItem {
  /** The version number this snapshot had. */
  version: number;
  title: string;
  body: string | null;
  data: unknown;
  color: string;
  category: string | null;
  tags: string[];
  fileId: string | null;
  editorId: string;
  editorName: string;
  createdAt: string;
}

export interface RevisionsView {
  currentVersion: number;
  revisions: RevisionItem[];
}

export type LogAction =
  | "created"
  | "edited"
  | "restored"
  | "status"
  | "pinned"
  | "sent"
  | "task"
  | "archived"
  | "unarchived"
  | "rated"
  | "image_added"
  | "image_removed"
  | "cover"
  | "copied";

export interface LogEntry {
  id: string;
  action: LogAction;
  at: string;
  /** Who did it (null for a rating seen by somebody who may not know who rated). */
  actorName: string | null;
  /** The small facts a line needs: from/to of a status, a version number, a file's name. Never anybody's stars. */
  detail: Record<string, string | number | boolean | null>;
}

export interface LinkedTask {
  id: string;
  title: string;
  key: string;
}

export interface LinkedTopic {
  conversationId: string;
  messageId: string | null;
  title: string;
  emoji: string | null;
}

export interface LinksView {
  tasks: LinkedTask[];
  topics: LinkedTopic[];
}
