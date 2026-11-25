"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { COMPANY_TIME_ZONES, LANDING_CHOICES } from "@/lib/control-panel";
import { MAX_PINNED_TABS, PLACES_V2, WORK_OPTIONAL_TABS, type PlaceDef } from "@/lib/nav/places";
import { orderKeys, type NavOrder } from "@/lib/nav/order";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { saveCompanySettingsAction } from "./actions";

/**
 * «إعدادات الشركة» — what only the OWNER sets for everybody (A2.1): the company's time zone (its «today»), the page the site opens on (D-N1: the chat is the recommended
 * answer and waits for the owner), the two optional work tools pinned as tabs of «الشغل» (N1.1) and the order of the menu (D-N5: the company's order wins, people hide only the
 * optional things). Each block saves alone through the one action `saveCompanySettingsAction`; the server checks every value again.
 *
 * ⚠️ A company menu order replaces every person's own order on screen. 🔧 Theirs is NOT deleted: it stays stored and comes back the day the company's order is cleared.
 */

export interface CompanySettingsProps {
  initial: { timezone: string; landing: string; workTabs: string[]; dueHour: number | null; menuOrder: NavOrder | null; personalOrders: number };
}

const WORK = PLACES_V2.find((place) => place.key === "work");
const PINNABLE = (WORK?.more ?? []).filter((tab) => (WORK_OPTIONAL_TABS as readonly string[]).includes(tab.key));

/** A place's tabs and the tabs of «المزيد» are not reordered here (the pins decide «المزيد»): only the visible tabs of each place. */
const placesWithTabs = PLACES_V2.filter((place) => place.tabs.length > 1);

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const to = index + by;
  if (to < 0 || to >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function CompanySettingsForm({ initial }: CompanySettingsProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [timezone, setTimezone] = useState(initial.timezone);
  const [landing, setLanding] = useState(initial.landing);
  const [pins, setPins] = useState<string[]>(initial.workTabs);
  // "" is «no default date»
  const [dueHour, setDueHour] = useState(initial.dueHour === null ? "" : String(initial.dueHour));

  const defaultPlaces = PLACES_V2.map((place) => place.key as string);
  const startPlaces = orderKeys(defaultPlaces, saved.menuOrder?.places, (key) => key);
  const [places, setPlaces] = useState<string[]>(startPlaces);
  const tabsOf = (place: PlaceDef, source: NavOrder | null) =>
    orderKeys(
      place.tabs.map((tab) => tab.key as string),
      source?.tabs[place.key],
      (key) => key,
    );
  const [tabs, setTabs] = useState<Record<string, string[]>>(() => Object.fromEntries(placesWithTabs.map((place) => [place.key, tabsOf(place, initial.menuOrder)])));

  async function save(block: string, input: Record<string, unknown>) {
    if (busy) return;
    setBusy(block);
    setError(null);
    try {
      const result = await saveCompanySettingsAction(input);
      if (result.ok) {
        setSaved({ timezone: result.view.timezone, landing: result.view.landing, workTabs: result.view.workTabs, dueHour: result.view.dueHour, menuOrder: result.view.menuOrder, personalOrders: result.view.personalOrders });
        toast(t("cpv2.company.saved"), "success");
        router.refresh();
      } else setError(t(result.key) === result.key ? t("common.error") : t(result.key));
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(null);
    }
  }

  const orderChanged =
    !sameOrder(places, startPlaces) || placesWithTabs.some((place) => !sameOrder(tabs[place.key] ?? [], tabsOf(place, saved.menuOrder)));
  const orderSet = saved.menuOrder !== null;
  const zoneKnown = COMPANY_TIME_ZONES.some((zone) => zone.id === timezone);
  const section = "rounded-card border border-border bg-surface-1 p-4 shadow-card";

  return (
    <div className="space-y-4" data-testid="company-settings">
      {error ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <section className={section} aria-labelledby="cs-tz" data-block="timezone">
        <h3 id="cs-tz" className="text-sm font-semibold">
          {t("cpv2.company.tz.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.company.tz.hint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select aria-labelledby="cs-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-auto min-w-48">
            {zoneKnown ? null : <option value={timezone}>{t("cpv2.tz.other")}</option>}
            {COMPANY_TIME_ZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {t(`cpv2.tz.${zone.key}`)}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" disabled={busy !== null || timezone === saved.timezone} onClick={() => void save("timezone", { timezone })}>
            {t("cpv2.company.save")}
          </Button>
        </div>
      </section>

      <section className={section} aria-labelledby="cs-due" data-block="duehour">
        <h3 id="cs-due" className="text-sm font-semibold">
          {t("cpv2.company.due.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.company.due.hint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select aria-labelledby="cs-due" value={dueHour} onChange={(e) => setDueHour(e.target.value)} className="w-auto min-w-48">
            <option value="">{t("cpv2.company.due.none")}</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={String(hour)}>
                {`${String(hour).padStart(2, "0")}:00`}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || dueHour === (saved.dueHour === null ? "" : String(saved.dueHour))}
            onClick={() => void save("duehour", { defaultDueHour: dueHour === "" ? null : Number(dueHour) })}
          >
            {t("cpv2.company.save")}
          </Button>
        </div>
      </section>

      <section className={section} aria-labelledby="cs-landing" data-block="landing">
        <h3 id="cs-landing" className="text-sm font-semibold">
          {t("cpv2.company.landing.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.company.landing.hint")}</p>
        <div className="mt-3 space-y-1" role="radiogroup" aria-labelledby="cs-landing">
          {LANDING_CHOICES.map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
              <input type="radio" name="landing" className="size-4" checked={landing === value} onChange={() => setLanding(value)} />
              <span>{t(`cpv2.company.landing.${value}`)}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{t("cpv2.company.landing.pending")}</p>
        <Button type="button" size="sm" className="mt-2" disabled={busy !== null || landing === saved.landing} onClick={() => void save("landing", { landing })}>
          {t("cpv2.company.save")}
        </Button>
      </section>

      <section className={section} aria-labelledby="cs-tabs" data-block="worktabs">
        <h3 id="cs-tabs" className="text-sm font-semibold">
          {t("cpv2.company.tabs.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.company.tabs.hint", { max: MAX_PINNED_TABS })}</p>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t("cpv2.company.tabs.slots")}</p>
        <ul className="mt-3 grid gap-1 sm:grid-cols-2">
          {PINNABLE.map((tab) => {
            const on = pins.includes(tab.key);
            const full = !on && pins.length >= MAX_PINNED_TABS;
            return (
              <li key={tab.key}>
                <label className={cn("flex min-h-11 items-center gap-2 text-sm md:min-h-9", full ? "text-fg-muted" : "")}>
                  <input type="checkbox" className="size-4" checked={on} disabled={full} onChange={(e) => setPins((list) => (e.target.checked ? [...list, tab.key] : list.filter((key) => key !== tab.key)))} />
                  <span>{t(tab.labelKey)}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <Button type="button" size="sm" className="mt-2" disabled={busy !== null || sameOrder(pins, saved.workTabs)} onClick={() => void save("worktabs", { workTabs: pins })}>
          {t("cpv2.company.save")}
        </Button>
      </section>

      <section className={section} aria-labelledby="cs-order" data-block="menuorder">
        <h3 id="cs-order" className="text-sm font-semibold">
          {t("cpv2.company.order.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.company.order.hint")}</p>
        <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          <p className="text-fg">{t("cpv2.company.order.warn", { n: saved.personalOrders })}</p>
          <p className="mt-0.5 text-fg-muted">{t("cpv2.company.order.fix")}</p>
        </div>
        <p className="mt-2 text-xs text-fg-muted">{orderSet ? t("cpv2.company.order.is_set") : t("cpv2.company.order.not_set")}</p>
        <ol className="mt-2 divide-y divide-border rounded-lg border border-border" data-testid="order-places">
          {places.map((key, index) => {
            const place = PLACES_V2.find((p) => p.key === key);
            if (!place) return null;
            const inner = placesWithTabs.some((p) => p.key === key) ? (tabs[key] ?? []) : [];
            return (
              <li key={key} className="p-2" data-order-place={key}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{t(place.labelKey)}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("cpv2.company.order.up")} disabled={index === 0} onClick={() => setPlaces((list) => move(list, index, -1))}>
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("cpv2.company.order.down")} disabled={index === places.length - 1} onClick={() => setPlaces((list) => move(list, index, 1))}>
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </Button>
                </div>
                {inner.length > 0 ? (
                  <ol className="ms-4 mt-1 space-y-0.5">
                    {inner.map((tabKey, i) => {
                      const tab = place.tabs.find((x) => x.key === tabKey);
                      if (!tab) return null;
                      return (
                        <li key={tabKey} className="flex items-center gap-2" data-order-tab={tabKey}>
                          <span className="min-w-0 flex-1 text-xs text-fg-muted">{t(tab.labelKey)}</span>
                          <Button type="button" variant="ghost" size="icon" aria-label={t("cpv2.company.order.up")} disabled={i === 0} onClick={() => setTabs((all) => ({ ...all, [key]: move(all[key] ?? [], i, -1) }))}>
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" aria-label={t("cpv2.company.order.down")} disabled={i === inner.length - 1} onClick={() => setTabs((all) => ({ ...all, [key]: move(all[key] ?? [], i, 1) }))}>
                            <ArrowDown aria-hidden="true" className="size-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || !orderChanged}
            onClick={() => void save("menuorder", { menuOrder: { places, tabs: Object.fromEntries(placesWithTabs.map((place) => [place.key, tabs[place.key] ?? []])) } })}
          >
            {t("cpv2.company.order.save")}
          </Button>
          {orderSet ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setPlaces(defaultPlaces);
                setTabs(Object.fromEntries(placesWithTabs.map((place) => [place.key, place.tabs.map((tab) => tab.key as string)])));
                void save("menuorder", { menuOrder: null });
              }}
            >
              {t("cpv2.company.order.clear")}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
