/**
 * «المستندات» — the shapes the server hands to the screen. Plain data, no server imports.
 */

export interface DocPerson {
  id: string;
  name: string;
}

/** A row of the space's list. `authorName` is null for an external partner (they read no staff directory). */
export interface DocListItem {
  id: string;
  title: string;
  excerpt: string;
  version: number;
  sharedWithPartners: boolean;
  updatedAt: string;
  authorName: string | null;
}

export interface DocList {
  documents: DocListItem[];
  /** May make a new document here (a writer of the space who is not an external partner). */
  canCreate: boolean;
  spaceId: string;
}

export interface DocItem {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  version: number;
  sharedWithPartners: boolean;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  lastEditorName: string | null;
  archived: boolean;
  /** On the team (not an external partner): reads the history, the staff names and the people an @name can point at. */
  internal: boolean;
  /** May change the words. */
  canWrite: boolean;
  /** May mark it «مشاركة مع الشركاء» or take it off, and delete it: its author, a manager of the space, the owner. */
  canManage: boolean;
  /** A deleted document the OWNER is reading: he may bring it back («رجّع المستند»). */
  canUndelete: boolean;
  /** The people an @name can point at (the space's own staff). Empty for an external partner. */
  people: DocPerson[];
}

/** A deleted document of a space, as the owner's «المستندات المحذوفة» lists it. */
export interface DocDeletedItem {
  id: string;
  title: string;
  excerpt: string;
  deletedAt: string;
  authorName: string;
}

/** A document the search box found (its title), in the space the person is in. */
export interface DocSearchHit {
  id: string;
  title: string;
}

export interface DocRevisionItem {
  version: number;
  title: string;
  size: number;
  cause: "EDIT" | "RESTORE";
  editorName: string;
  createdAt: string;
}

export interface DocRevisionsView {
  currentVersion: number;
  revisions: DocRevisionItem[];
}

export interface DocRevisionFull extends DocRevisionItem {
  content: string;
}
