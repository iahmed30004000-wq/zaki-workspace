"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, ListTodo, Pencil, Pin, PinOff, RotateCcw, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { CardItem } from "@/lib/cards/shared";
import type { CardPageData, GalleryItem } from "@/lib/cards/page";
import type { CardStatus } from "@/lib/cards/status";
import { browserStorage, clearDraft, draftKey, loadDraft, saveDraft, type StoredDraft } from "@/lib/cards/draft";
import type { CardSnapshot } from "@/lib/cards/versions";
import { snapshotOfItem } from "@/lib/cards/texts";
import { CardBody } from "./card-tile";
import { CardEditorForm, type CardPayload } from "./card-editor";
import { CardToTaskDialog, SendCardDialog } from "./card-dialogs";
import { CardPageHeader } from "./card-page-header";
import { ConflictDialog, type ConflictState } from "./conflict-dialog";
import { GallerySection } from "./gallery-section";
import { LinksSection } from "./links-section";
import { LogSection } from "./log-section";
import { NotesSection } from "./notes-section";
import { RevisionsSection } from "./revisions-section";
import { cardErrorKey } from "./errors";

export const pageKey = (cardId: string) => ["card-page", cardId] as const;

type TabId = "notes" | "gallery" | "versions" | "log";
const TABS: readonly TabId[] = ["notes", "gallery", "versions", "log"];

/** What is sent to save the card: the editor's values, the file only for a FILE card (any other kind has none). */
function patchOf(payload: CardPayload, kind: CardItem["kind"]): Record<string, unknown> {
  const { kind: _kind, fileId, ...rest } = payload;
  void _kind;
  return kind === "FILE" ? { ...rest, fileId } : rest;
}

function snapshotOfPayload(payload: CardPayload, base: CardItem): CardSnapshot {
  return {
    title: payload.title,
    body: payload.body,
    data: payload.data,
    color: payload.color,
    category: payload.category,
    tags: payload.tags,
    fileId: base.kind === "FILE" ? payload.fileId : base.fileId,
  };
}

interface Conflict {
  state: ConflictState;
  mine: CardPayload;
  theirs: CardItem;
}

/**
 * «صفحة اللوحة»: a card opened on a page of its own. The server decided what the viewer may do (`abilities`) and left out
 * what they may not see; this component only draws that and asks the server again for every change.
 *
 * Editing is protected by versions: the editor sends the version it started from, and a card that moved on answers 409,
 * which opens «اللوحة تغيّرت» (the difference, a choice per field); nothing is overwritten silently. What a person types
 * is kept on this device as they go, so a closed tab or a lost network does not lose it.
 */
export function CardPage({ initial, userId, approvalsSlot = null }: { initial: CardPageData; userId: string; approvalsSlot?: React.ReactNode }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const cardId = initial.card.id;
  const key = pageKey(cardId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => apiGet<CardPageData>(`/api/cards/${cardId}/page`),
    initialData: initial,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  const { card, abilities } = data;

  const [tab, setTab] = React.useState<TabId>("notes");
  const [editing, setEditing] = React.useState<{ base: CardItem; draft: StoredDraft<CardPayload> | null; nonce: number } | null>(null);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);
  const [sending, setSending] = React.useState(false);
  const [tasking, setTasking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const storageKey = draftKey(userId, cardId);
  const refreshAll = React.useCallback(() => qc.invalidateQueries({ queryKey: ["card", cardId] }), [qc, cardId]);
  const reloadPage = React.useCallback(() => qc.invalidateQueries({ queryKey: key }), [qc, key]);
  const fail = React.useCallback((err: unknown) => toast(t(cardErrorKey(err)), "error"), [toast, t]);
  const putCard = React.useCallback(
    (next: CardItem) => qc.setQueryData<CardPageData>(key, (prev) => (prev ? { ...prev, card: { ...next, coverFileId: prev.card.coverFileId } } : prev)),
    [qc, key],
  );

  // ---- editing ----
  function openEditor(base: CardItem = card, mine: CardPayload | null = null) {
    const stored = mine ? { baseVersion: base.version ?? 1, savedAt: new Date().toISOString(), payload: mine } : loadDraft<CardPayload>(browserStorage(), storageKey);
    setEditing({ base, draft: stored, nonce: Date.now() });
  }
  /** Closing keeps what was typed on this device (only saving it, or «تجاهل المسودة», removes it). */
  function closeEditor() {
    setEditing(null);
  }

  async function save(payload: CardPayload) {
    if (!editing) return;
    const base = editing.base;
    try {
      const { card: saved } = await apiPatch<{ card: CardItem }>(`/api/cards/${cardId}`, { ...patchOf(payload, base.kind), version: base.version });
      putCard(saved);
      clearDraft(browserStorage(), storageKey);
      setEditing(null);
      toast(t("cards.saved"), "success");
      void refreshAll();
    } catch (err) {
      const theirs = err instanceof ApiError && err.status === 409 ? (err.body as { card?: CardItem } | undefined)?.card : undefined;
      if (!theirs) throw err;
      // a colleague saved first: the draft stays on this device and the person decides, field by field
      saveDraft(browserStorage(), storageKey, { baseVersion: base.version ?? 1, savedAt: new Date().toISOString(), payload });
      setConflict({ state: { original: snapshotOfItem(base), mine: snapshotOfPayload(payload, base), theirs: snapshotOfItem(theirs) }, mine: payload, theirs });
      putCard(theirs);
      setEditing(null);
    }
  }

  const conflictActions = {
    keep: async (patch: Partial<CardSnapshot>) => {
      if (!conflict) return;
      const theirs = conflict.theirs;
      if (Object.keys(patch).length === 0) return conflictActions.takeTheirs();
      const body: Record<string, unknown> = { ...patch };
      if (theirs.kind !== "FILE" || !body["fileId"]) delete body["fileId"];
      try {
        const { card: saved } = await apiPatch<{ card: CardItem }>(`/api/cards/${cardId}`, { ...body, version: theirs.version });
        putCard(saved);
        clearDraft(browserStorage(), storageKey);
        setConflict(null);
        toast(t("cards.p.conflict_saved"), "success");
        void refreshAll();
      } catch (err) {
        const again = err instanceof ApiError && err.status === 409 ? (err.body as { card?: CardItem } | undefined)?.card : undefined;
        if (again) {
          putCard(again);
          setConflict({ ...conflict, theirs: again, state: { ...conflict.state, theirs: snapshotOfItem(again) } });
        } else fail(err);
      }
    },
    takeTheirs: () => {
      clearDraft(browserStorage(), storageKey);
      setConflict(null);
      void refreshAll();
    },
    backToEditor: () => {
      if (!conflict) return;
      const { theirs, mine } = conflict;
      setConflict(null);
      openEditor(theirs, mine);
    },
  };

  // ---- the actions ----
  async function pin() {
    setBusy(true);
    try {
      const { card: saved } = await apiPatch<{ card: CardItem }>(`/api/cards/${cardId}`, { pinned: !card.pinned });
      putCard(saved);
      void refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function duplicate() {
    setBusy(true);
    try {
      const made = await apiPost<{ card: CardItem }>(`/api/cards/${cardId}/duplicate`);
      toast(t("cards.duplicated"), "success");
      router.push(`/cards/${made.card.id}`);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }
  async function archive() {
    if (!window.confirm(t("cards.p.confirm_delete"))) return;
    setBusy(true);
    try {
      await apiDelete(`/api/cards/${cardId}`);
      toast(t("cards.deleted"), "success");
      router.push("/cards");
      router.refresh();
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }
  async function restoreDeleted() {
    setBusy(true);
    try {
      await apiPost(`/api/cards/${cardId}/restore`);
      toast(t("cards.restored"), "success");
      await reloadPage();
      void refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function toggleItem(index: number) {
    if (!card.data || !("items" in card.data)) return;
    const items = card.data.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    try {
      const { card: saved } = await apiPatch<{ card: CardItem }>(`/api/cards/${cardId}`, { data: { items }, version: card.version });
      putCard(saved);
      void refreshAll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast(t("cards.p.updated_toast"), "error");
      else fail(err);
      void reloadPage();
    }
  }
  async function setStatus(status: CardStatus) {
    setBusy(true);
    try {
      const { card: saved } = await apiPut<{ card: CardItem }>(`/api/cards/${cardId}/status`, { status });
      putCard(saved);
      toast(t("cards.p.status_changed"), "success");
      await reloadPage();
      void refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function rate(stars: number) {
    setBusy(true);
    try {
      await apiPut(`/api/cards/${cardId}/rating`, { stars });
      toast(t("cards.p.stars_saved"), "success");
      await reloadPage();
      void refreshAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }
  async function restoreVersion(version: number) {
    try {
      const { card: saved } = await apiPost<{ card: CardItem }>(`/api/cards/${cardId}/revisions/${version}/restore`, { version: card.version });
      putCard(saved);
      toast(t("cards.p.version_restored", { n: version }), "success");
      void refreshAll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(t("cards.p.updated_toast"), "error");
        void reloadPage();
      } else fail(err);
    }
  }

  const actionClass = "min-h-11";
  const gallery: GalleryItem[] = data.gallery;
  const draftInfo = editing?.draft ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <CardPageHeader data={data} onStatus={(s) => void setStatus(s)} onRate={(n) => void rate(n)} busy={busy} />

      {card.archivedAt ? (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm font-medium text-fg">{t("cards.p.deleted_banner")}</p>
      ) : null}
      {abilities.oversight && !card.archivedAt ? <p role="note" className="rounded-lg border border-info/40 bg-info/10 p-2 text-sm text-fg">{t("cards.p.oversight")}</p> : null}
      {!abilities.write && !abilities.oversight && !card.archivedAt ? <p className="text-xs text-fg-muted">{t("cards.p.read_only")}</p> : null}

      <div role="group" aria-label={t("cards.p.actions")} className="flex flex-wrap gap-2">
        {abilities.write ? (
          <>
            <Button type="button" className={actionClass} onClick={() => openEditor()} disabled={busy}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("cards.edit")}
            </Button>
            <Button type="button" variant="secondary" className={actionClass} onClick={() => void duplicate()} disabled={busy}>
              <Copy className="size-4" aria-hidden="true" />
              {t("cards.duplicate")}
            </Button>
            <Button type="button" variant="secondary" className={actionClass} onClick={() => void pin()} disabled={busy}>
              {card.pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
              {card.pinned ? t("cards.unpin") : t("cards.pin")}
            </Button>
            <Button type="button" variant="secondary" className={actionClass} onClick={() => setSending(true)} disabled={busy}>
              <Send className="size-4" aria-hidden="true" />
              {t("cards.send")}
            </Button>
            <Button type="button" variant="secondary" className={actionClass} onClick={() => setTasking(true)} disabled={busy}>
              <ListTodo className="size-4" aria-hidden="true" />
              {t("cards.to_task")}
            </Button>
            <Button type="button" variant="secondary" className={cn(actionClass, "text-danger")} onClick={() => void archive()} disabled={busy}>
              <Archive className="size-4" aria-hidden="true" />
              {t("cards.delete")}
            </Button>
          </>
        ) : null}
        {abilities.restore ? (
          <Button type="button" className={actionClass} onClick={() => void restoreDeleted()} disabled={busy}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("cards.restore")}
          </Button>
        ) : null}
      </div>

      <section aria-label={card.title} className="rounded-2xl border border-border bg-surface-1 p-3 md:p-4">
        <CardBody card={card} clamp={false} canWrite={abilities.write} onToggleItem={(i) => void toggleItem(i)} />
      </section>

      {abilities.internal ? <LinksSection cardId={cardId} version={card.version} /> : null}

      {/* «طلب موافقة»: the button and the requests about this card (drawn by the page only while the switch is on) */}
      {approvalsSlot}

      {abilities.internal ? (
        <section className="flex flex-col gap-3">
          <div role="tablist" aria-label={t("cards.p.sections")} className="flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`card-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`card-panel-${id}`}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium motion-reduce:transition-none",
                  tab === id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t(`cards.p.tab.${id}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`card-panel-${tab}`} aria-labelledby={`card-tab-${tab}`}>
            {tab === "notes" ? <NotesSection cardId={cardId} userId={userId} abilities={abilities} /> : null}
            {tab === "gallery" ? (
              <GallerySection cardId={cardId} gallery={gallery} canEdit={abilities.gallery} hasLibrary={abilities.gallery} onChanged={() => { void reloadPage(); void refreshAll(); }} />
            ) : null}
            {tab === "versions" ? <RevisionsSection card={card} canWrite={abilities.write} onRestore={restoreVersion} /> : null}
            {tab === "log" ? <LogSection cardId={cardId} version={card.version} /> : null}
          </div>
        </section>
      ) : null}

      <Modal open={editing !== null} title={t("cards.edit")} onClose={() => closeEditor()}>
        {editing ? (
          <div className="flex flex-col gap-3">
            {draftInfo ? (
              <div role="status" className="flex flex-col gap-1 rounded-lg border border-info/40 bg-info/10 p-2 text-xs text-fg">
                <p>{t("cards.p.draft_found", { date: fmtDateTime(draftInfo.savedAt) })}</p>
                {draftInfo.baseVersion !== (editing.base.version ?? 1) ? <p>{t("cards.p.draft_stale")}</p> : null}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center self-start text-info underline"
                  onClick={() => {
                    clearDraft(browserStorage(), storageKey);
                    setEditing({ ...editing, draft: null, nonce: Date.now() });
                  }}
                >
                  {t("cards.p.draft_discard")}
                </button>
              </div>
            ) : null}
            <CardEditorForm
              key={`${editing.base.id}:${editing.base.version ?? 1}:${editing.nonce}`}
              card={editing.base}
              categories={[]}
              draft={draftInfo?.payload ?? null}
              onDraft={(payload) => saveDraft(browserStorage(), storageKey, { baseVersion: editing.base.version ?? 1, savedAt: new Date().toISOString(), payload })}
              onSave={save}
              onCancel={() => closeEditor()}
            />
          </div>
        ) : null}
      </Modal>
      <ConflictDialog state={conflict?.state ?? null} actions={conflictActions} onClose={() => setConflict(null)} />
      <SendCardDialog card={sending ? card : null} spaceId={data.spaceId} onClose={() => setSending(false)} onDone={() => void refreshAll()} />
      <CardToTaskDialog card={tasking ? card : null} spaceId={data.spaceId} onClose={() => setTasking(false)} onDone={() => void refreshAll()} />
    </div>
  );
}
