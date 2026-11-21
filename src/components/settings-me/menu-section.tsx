"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { OrderLockedNote } from "@/components/shell/nav-options";
import { Grip, SortableItem, SortableList } from "@/components/shell/nav-sort";
import { apiDelete, apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Group } from "@/components/settings-me/parts";

/**
 * C4.1 — «القائمة»: today's «ترتيب» of the menu (`User.navOrder`, `/api/me/nav-order`) as a screen of its own: each place a row that is DRAGGED by its grip (finger or
 * mouse; the same sortable list as the menu's own), with «ارفع» and «نزّل» beside it as the buttons for the keyboard. When the COMPANY has set the order (D-N5) the rows are not offered: the same ⚠️ + 🔧 note
 * as the menu's own is drawn, and the person's own order stays stored (it is used again if the company order is switched off).
 */
export interface MenuPlace {
  key: string;
  labelKey: string;
}

/** `keys` with the item at `from` moved by `step` (-1 up, +1 down); the same list at the ends. */
export function moveKey(keys: readonly string[], from: number, step: -1 | 1): string[] {
  const to = from + step;
  if (from < 0 || from >= keys.length || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function MenuSection({ places, tabs, locked }: { places: readonly MenuPlace[]; tabs: Record<string, string[]>; locked: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [keys, setKeys] = useState(() => places.map((p) => p.key));
  const [busy, setBusy] = useState(false);
  const byKey = new Map(places.map((p) => [p.key, p]));

  async function move(from: number, step: -1 | 1) {
    await save(moveKey(keys, from, step));
  }

  async function save(next: string[]) {
    const before = keys;
    setKeys(next);
    setBusy(true);
    try {
      await apiPut("/api/me/nav-order", { places: next, tabs });
      toast(t("settingsMe.m.saved"), "success");
    } catch {
      setKeys(before);
      toast(t("settingsMe.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await apiDelete("/api/me/nav-order");
      setKeys(places.map((p) => p.key));
      toast(t("settingsMe.m.saved"), "success");
    } catch {
      toast(t("settingsMe.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div data-section-body="menu" className="px-3 md:px-0">
        <OrderLockedNote />
        <p className="mt-3 text-[13px] text-fg-muted">{t("settingsMe.m.locked_hint")}</p>
      </div>
    );
  }

  return (
    <div data-section-body="menu">
      <p className="px-3 pb-3 text-[13px] text-fg-muted md:px-0">{t("settingsMe.m.intro")}</p>
      <SortableList id="settings-menu-places" axis="vertical" entries={keys.map((key) => ({ id: key, label: t(byKey.get(key)?.labelKey ?? key) }))} onReorder={(next) => void save(next)}>
      <ul className="mx-3 divide-y divide-border overflow-hidden rounded-[14px] bg-surface-1 md:mx-0">
        {keys.map((key, at) => {
          const place = byKey.get(key);
          if (!place) return null;
          const label = t(place.labelKey);
          return (
            <SortableItem key={key} id={key} className="bg-surface-1">
              {({ props }) => (
            <div data-menu-place={key} className="flex min-h-14 items-center gap-2 px-3.5">
              <Grip handle={props} label={label} className="h-11 w-8" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{label}</span>
              <Button type="button" size="icon" variant="ghost" aria-label={t("settingsMe.m.up", { label })} disabled={busy || at === 0} onClick={() => void move(at, -1)}>
                <ArrowUp aria-hidden="true" className="size-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label={t("settingsMe.m.down", { label })} disabled={busy || at === keys.length - 1} onClick={() => void move(at, 1)}>
                <ArrowDown aria-hidden="true" className="size-4" />
              </Button>
            </div>
              )}
            </SortableItem>
          );
        })}
      </ul>
      </SortableList>
      <Group>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void reset()}>
          {t("settingsMe.m.reset")}
        </Button>
      </Group>
    </div>
  );
}
