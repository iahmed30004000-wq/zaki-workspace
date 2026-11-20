"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { projectTabHref } from "./tabs";

export interface PickableBoard {
  id: string;
  name: string;
  /** The cards of it the person may open (a private card of somebody else is not counted). */
  tasks: number;
}

/**
 * «اللوحة» tab: the picker of the project's boards. Nothing is drawn for one board (one is not a choice); with several, each is a link to
 * `/projects/<id>?board=<board>` (the first board is the plain `/projects/<id>`), the shown one wears `aria-current`.
 */
export function BoardPicker({ projectId, boards, currentId }: { projectId: string; boards: readonly PickableBoard[]; currentId: string }) {
  const { t } = useI18n();
  if (boards.length < 2) return null;
  const firstId = boards[0]?.id;
  return (
    <nav aria-label={t("projpage.boards.label")} data-board-picker>
      <ul className="flex flex-wrap items-center gap-1.5">
        {boards.map((b) => {
          const active = b.id === currentId;
          return (
            <li key={b.id}>
              <Link
                href={projectTabHref(projectId, "board", { boardId: b.id === firstId ? null : b.id })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active ? "border-accent bg-accent/10 font-medium text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {b.name}
                <span className="tabular-nums text-fg-muted">{fmtNumber(b.tasks)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
