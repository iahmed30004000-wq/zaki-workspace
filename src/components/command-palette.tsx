"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FilePen, FileText, FolderKanban, MessageSquareText, MessagesSquare, Search, SquareCheck, UserRound } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { rankEntries } from "@/lib/guide/match";
import type { NavIconKey, NavModel } from "@/lib/nav/places";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NavIcon } from "@/components/shell/nav-icons";

interface SearchResponse {
  tasks: { id: string; key: string; title: string; priority: string; projectId: string; projectName: string }[];
  projects: { id: string; name: string; workspaceId: string; workspaceName: string }[];
  /** the space's chat, people and library (src/app/api/search/route.ts) */
  topics?: { id: string; title: string; emoji: string | null }[];
  messages?: { id: string; conversationId: string; conversationTitle: string; authorName: string; snippet: string }[];
  people?: { id: string; name: string }[];
  files?: { id: string; name: string }[];
  /** the space's text documents, by title */
  documents?: { id: string; title: string }[];
}

/** One way to jump somewhere: a place, a tab, the guide or the person's account. */
export interface PaletteCommand {
  id: string;
  labelKey: string;
  /** The place a tab belongs to, shown as a quiet second line (and searched too). */
  subKey?: string;
  href: string;
  icon: NavIconKey | "guide" | "account";
}

/** There for everybody, whatever their map: the guide and their own account. */
const ALWAYS: readonly PaletteCommand[] = [
  { id: "guide", labelKey: "guide.title", href: "/guide", icon: "guide" },
  { id: "account", labelKey: "shell.avatar.account", href: "/profile", icon: "account" },
];

/**
 * The palette's places and tabs, from the person's own map (src/lib/nav/places.ts): nothing they are
 * not offered in the menus, in the order of the menus. A place that is one page is one entry; a
 * place with tabs is its tabs, each with the place underneath (unless the place is called by its tab).
 */
export function paletteCommands(nav: NavModel): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const seen = new Set<string>();
  const add = (command: PaletteCommand) => {
    if (seen.has(command.href)) return;
    seen.add(command.href);
    out.push(command);
  };
  for (const place of nav.places) {
    if (place.tabs.length === 0) add({ id: place.key, labelKey: place.labelKey, href: place.href, icon: place.icon });
    for (const tab of place.tabs) {
      add({
        id: `${place.key}.${tab.key}`,
        labelKey: tab.labelKey,
        ...(tab.labelKey === place.labelKey ? {} : { subKey: place.labelKey }),
        href: tab.href,
        icon: place.icon,
      });
    }
  }
  for (const command of ALWAYS) add(command);
  return out;
}

/** The part of a keyboard event the shortcut reads. */
export interface ShortcutEvent {
  key?: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Ctrl+K (⌘K on a Mac). The PHYSICAL key decides (`code === "KeyK"`): with the Arabic layout the same
 * key types «ن», so `key` alone never matched. Not with Alt (AltGr is Ctrl+Alt on some layouts) and not
 * with Shift (Ctrl+Shift+K belongs to the browser's own tools).
 */
export function isPaletteShortcut(e: ShortcutEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  return e.code === "KeyK" || e.key === "k" || e.key === "K";
}

function PaletteIcon({ icon }: { icon: PaletteCommand["icon"] }) {
  if (icon === "guide") return <BookOpen aria-hidden="true" className="size-4" />;
  if (icon === "account") return <UserRound aria-hidden="true" className="size-4" />;
  return <NavIcon icon={icon} className="size-4" />;
}

interface Row {
  key: string;
  main: string;
  sub?: string;
  href: string;
  icon: React.ReactNode;
}

/**
 * Global quick navigation: Ctrl/⌘+K anywhere, or the search button in the top bar. Jumps to the places
 * and tabs of the person's map and searches the tasks and projects they may open — and, in the space they are
 * in, its topics, messages, people, files and documents (the server decides which). A Radix dialog: focus moves into the search box and stays inside, Escape or a tap outside
 * closes it, and focus goes back to whoever opened it.
 *
 * `defaultOpen` and `portal={false}` are for server-render tests (a portal draws nothing on the server).
 */
export function CommandPalette({ nav, defaultOpen = false, portal = true }: { nav: NavModel; defaultOpen?: boolean; portal?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
      setQ("");
      setCursor(0);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const query = q.trim();

  // spelling-tolerant, like the guide's search: «مشاريع» finds «المشاريع», a hamza or not
  const commands = useMemo(
    () => paletteCommands(nav).map((c) => ({ ...c, title: t(c.labelKey), keywords: c.subKey ? [t(c.subKey)] : [] })),
    [nav, t],
  );
  const shown = useMemo(() => rankEntries(commands, query), [commands, query]);

  const search = useQuery({
    queryKey: ["palette", query],
    queryFn: () => apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.length >= 2,
  });

  const rows: Row[] = [
    ...shown.map((c) => ({
      key: `c:${c.id}`,
      main: c.title,
      ...(c.subKey ? { sub: t(c.subKey) } : {}),
      href: c.href,
      icon: <PaletteIcon icon={c.icon} />,
    })),
    ...(search.data?.tasks ?? []).map((task) => ({
      key: `t:${task.id}`,
      main: `${task.key} ${task.title}`,
      sub: task.projectName,
      href: `/tasks/${task.id}`,
      icon: <SquareCheck aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.projects ?? []).map((p) => ({
      key: `p:${p.id}`,
      main: p.name,
      sub: p.workspaceName,
      href: `/projects/${p.id}`,
      icon: <FolderKanban aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.topics ?? []).map((topic) => ({
      key: `tp:${topic.id}`,
      main: `${topic.emoji ? `${topic.emoji} ` : ""}${topic.title}`,
      sub: t("pal.topic"),
      href: `/chat/${topic.id}`,
      icon: <MessagesSquare aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.messages ?? []).map((m) => ({
      key: `m:${m.id}`,
      main: m.snippet,
      sub: `${m.conversationTitle} · ${m.authorName}`,
      // opened around the message, scrolled to it
      href: `/chat/${m.conversationId}?m=${encodeURIComponent(m.id)}`,
      icon: <MessageSquareText aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.people ?? []).map((person) => ({
      key: `u:${person.id}`,
      main: person.name,
      sub: t("pal.person"),
      href: `/u/${person.id}`,
      icon: <UserRound aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.files ?? []).map((file) => ({
      key: `f:${file.id}`,
      main: file.name,
      sub: t("pal.file"),
      href: `/files#file-${file.id}`,
      icon: <FileText aria-hidden="true" className="size-4" />,
    })),
    ...(search.data?.documents ?? []).map((d) => ({
      key: `d:${d.id}`,
      main: d.title,
      sub: t("pal.document"),
      href: `/documents/${d.id}`,
      icon: <FilePen aria-hidden="true" className="size-4" />,
    })),
  ];
  const total = rows.length;
  const active = Math.min(cursor, Math.max(total - 1, 0));

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setQ("");
      setCursor(0);
    }
  }

  function go(index: number) {
    const row = rows[index];
    if (!row) return;
    changeOpen(false);
    router.push(row.href);
  }

  // the highlighted row stays in view while the arrows move it
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t("pal.open")}
        className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border-muted bg-surface-1 px-3 text-sm text-muted transition-colors hover:border-accent/50 hover:text-fg-muted"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">{t("pal.open")}</span>
        <kbd dir="ltr" className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted md:inline">
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent portal={portal} size="lg" aria-describedby={undefined} className="mb-auto mt-[10dvh]">
          <DialogTitle className="sr-only">{t("pal.open")}</DialogTitle>
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border pe-14 ps-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor(Math.min(active + 1, Math.max(total - 1, 0)));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor(Math.max(active - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (total > 0) go(active);
                }
              }}
              role="combobox"
              aria-expanded={total > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={total > 0 ? optionId(active) : undefined}
              aria-label={t("pal.placeholder")}
              placeholder={t("pal.placeholder")}
              autoComplete="off"
              enterKeyHint="go"
              className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-sm"
            />
            <kbd dir="ltr" className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted md:inline">
              Esc
            </kbd>
          </div>

          <div id={listId} role="listbox" aria-label={t("pal.open")} className="max-h-[min(60dvh,24rem)] overflow-y-auto overscroll-contain p-1.5">
            {rows.map((row, i) => (
              <PaletteRow
                key={row.key}
                id={optionId(i)}
                active={active === i}
                onPick={() => go(i)}
                onHover={() => setCursor(i)}
                icon={row.icon}
                main={row.main}
                sub={row.sub}
              />
            ))}
          </div>
          {total === 0 ? (
            <p role="status" className="px-4 pb-6 pt-2 text-center text-sm text-muted">
              {search.isLoading ? t("common.loading") : query.length >= 2 ? t("common.noResults") : t("pal.hint")}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaletteRow({
  id,
  active,
  onPick,
  onHover,
  icon,
  main,
  sub,
}: {
  id: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  icon: React.ReactNode;
  main: string;
  sub?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg border-s-4 px-3 py-2 text-start text-sm transition-colors",
        active ? "border-s-accent bg-accent/10 text-fg" : "border-s-transparent text-fg-muted hover:bg-surface-2",
      )}
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{main}</span>
      {sub ? <span className="max-w-32 shrink-0 truncate text-xs text-muted">{sub}</span> : null}
    </button>
  );
}
