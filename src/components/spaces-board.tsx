"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreVertical, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Card, CardBody } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SpaceDeleteButton } from "@/components/space-delete-button";
import { fmtNumber } from "@/lib/format";
import { goHref } from "@/lib/space-link";
import { settingsHref } from "@/components/space-settings/tabs";
import { NewSpaceFromTemplate } from "@/components/space-templates/new-space-from-template";

export interface BoardCard {
  id: string;
  name: string;
  emoji: string | null;
  kind: "HQ" | "STANDARD" | "DEPARTMENT";
  open: number;
  overdue: number;
  unread: number;
  members: number;
}

/**
 * The cards of «كل المساحات», managed in place (the owner's asks, 2026-10-26): drag a card by its handle to put the spaces
 * in order (it is the order of the switcher too; «الشركة» stays first and does not move), and a «⋯» on each card: edit
 * the name, archive, delete (the OWNER, a standard space; a department's space says where it is deleted). The server
 * decides again (src/server/services/space-manage.ts, space-delete.ts). `settingsLinks` (A2.2: the switch `controlPanelV2` is ON) adds «إعدادات المساحة» to the
 * menu, the way into the space's own settings page.
 */
export function SpacesBoard({ cards, hereId, manage, owner, settingsLinks = false }: { cards: BoardCard[]; hereId: string | null; manage: boolean; owner: boolean; settingsLinks?: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const hq = cards.filter((c) => c.kind === "HQ");
  const [rest, setRest] = useState(cards.filter((c) => c.kind !== "HQ"));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rest.findIndex((c) => c.id === active.id);
    const to = rest.findIndex((c) => c.id === over.id);
    const next = arrayMove(rest, from, to);
    setRest(next);
    const r = await fetch("/api/workspaces/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: next.map((c) => c.id) }) }).catch(() => null);
    if (r?.ok) {
      toast(t("spaces.order.saved"), "success");
      router.refresh();
    } else {
      toast(t("spaces.order.failed"), "error");
      setRest(rest);
    }
  }

  return (
    <>
      {/* «مساحة من قالب» (I1.2): drawn only to a person who may open a space and only while the switch `spaceTemplates` is on; nothing here otherwise */}
      {manage ? (
        <div className="flex justify-end">
          <NewSpaceFromTemplate />
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hq.map((s) => (
          <li key={s.id} className="relative">
            <SpaceCardView card={s} here={s.id === hereId} />
          </li>
        ))}
        {manage ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={rest.map((c) => c.id)} strategy={rectSortingStrategy}>
              {rest.map((s) => (
                <SortableCard key={s.id} card={s} here={s.id === hereId} owner={owner} settingsLinks={settingsLinks} />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          rest.map((s) => (
            <li key={s.id} className="relative">
              <SpaceCardView card={s} here={s.id === hereId} />
            </li>
          ))
        )}
      </ul>
    </>
  );
}

function SortableCard({ card, here, owner, settingsLinks }: { card: BoardCard; here: boolean; owner: boolean; settingsLinks: boolean }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-20 opacity-80" : "relative"}>
      <div className="absolute end-2 top-2 z-10 flex items-center gap-1">
        {settingsLinks ? <SettingsGear card={card} /> : <CardActions card={card} owner={owner} settingsLinks={settingsLinks} />}
        <button
          type="button"
          aria-label={`${t("spaces.card.drag")}: ${card.name}`}
          className="inline-flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      </div>
      <SpaceCardView card={card} here={here} />
    </li>
  );
}

/**
 * S3.3 — with `settingsLinks` (the board of «إعدادات الشركة», «الإعدادات» is ONE door) the card has ONE action, a gear to the space's own settings page: its name, its people, its archive and its
 * delete are there, once, instead of a second copy in a menu on the card.
 */
function SettingsGear({ card }: { card: BoardCard }) {
  const { t } = useI18n();
  return (
    <Link href={settingsHref(card.id)} data-space-gear="" aria-label={`${t("spset.open")}: ${card.name}`} title={t("spset.open")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg">
      <Settings aria-hidden="true" className="size-4" />
    </Link>
  );
}

function CardActions({ card, owner, settingsLinks }: { card: BoardCard; owner: boolean; settingsLinks: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(card.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${encodeURIComponent(card.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return toast(t("common.error"), "error");
    setRenaming(false);
    toast(t("ws.renamed"), "success");
    router.refresh();
  }

  async function archive() {
    const r = await fetch(`/api/workspaces/${encodeURIComponent(card.id)}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }) }).catch(() => null);
    if (!r?.ok) return toast(t("spaces.archive.failed"), "error");
    toast(t("spaces.archive.done"), "success");
    router.refresh();
  }

  return (
    <>
      {owner && card.kind !== "HQ" ? <SpaceDeleteButton id={card.id} name={card.name} /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${t("spaces.card.actions")}: ${card.name}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2">
            <MoreVertical aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {settingsLinks && <DropdownMenuItem onSelect={() => router.push(settingsHref(card.id))}>⚙️ {t("spset.open")}</DropdownMenuItem>}
          {card.kind !== "DEPARTMENT" && <DropdownMenuItem onSelect={() => setRenaming(true)}>✏️ {t("spaces.card.rename")}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => void archive()}>🗄 {t("spaces.card.archive")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal open={renaming} onClose={() => setRenaming(false)} title={t("ws.editTitle")}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>{t("common.save")}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function SpaceCardView({ card, here }: { card: BoardCard; here: boolean }) {
  const { t } = useI18n();
  return (
    <a href={goHref(card.id)} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <Card className="h-full transition-colors hover:border-accent/40">
        <CardBody className="space-y-3">
          {/* pe-40: room for the three buttons (menu, delete, grip) that sit on the card's end, each 44px wide */}
          <div className="flex items-center gap-2 pe-40">
            <span aria-hidden="true" className="text-xl leading-none">{card.emoji ?? "🗂️"}</span>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              <bdi>{card.name}</bdi>
            </h2>
          </div>
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Stat label={t("spaces.overview.open")} value={card.open} />
            <Stat label={t("spaces.overview.overdue")} value={card.overdue} tone={card.overdue > 0 ? "danger" : undefined} />
            <Stat label={t("spaces.overview.unread")} value={card.unread} tone={card.unread > 0 ? "accent" : undefined} />
            <Stat label={t("spaces.overview.members")} value={card.members} />
          </dl>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-accent">{t("spaces.overview.enter")}</p>
            {here ? <span data-here className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">{t("spaces.overview.here")}</span> : null}
          </div>
        </CardBody>
      </Card>
    </a>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "accent" }) {
  return (
    <div className="flex flex-col-reverse rounded-xl bg-surface-2 px-1 py-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={tone === "danger" ? "text-lg font-bold text-danger" : tone === "accent" ? "text-lg font-bold text-accent" : "text-lg font-bold text-fg"}>{fmtNumber(value)}</dd>
    </div>
  );
}

/** «المساحات المؤرشفة»: what was archived, each with «رجّعها». */
export function ArchivedSpaces({ rows }: { rows: { id: string; name: string; emoji: string | null }[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  if (!rows.length) return null;
  async function restore(id: string) {
    const r = await fetch(`/api/workspaces/${encodeURIComponent(id)}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: false }) }).catch(() => null);
    if (!r?.ok) return toast(t("spaces.archive.failed"), "error");
    toast(t("spaces.archived.restored"), "success");
    router.refresh();
  }
  return (
    <section aria-labelledby="archived-spaces" className="space-y-2 rounded-2xl border border-border bg-surface-1 p-4">
      <h2 id="archived-spaces" className="text-base font-semibold">{t("spaces.archived.title")}</h2>
      <p className="text-sm text-fg-muted">{t("spaces.archived.hint")}</p>
      <ul className="divide-y divide-border">
        {rows.map((s) => (
          <li key={s.id} className="flex min-h-11 items-center gap-2 py-1">
            <span aria-hidden="true">{s.emoji ?? "🗂️"}</span>
            <bdi className="min-w-0 flex-1 truncate text-sm">{s.name}</bdi>
            <Button size="sm" variant="secondary" onClick={() => void restore(s.id)}>{t("spaces.archived.restore")}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
