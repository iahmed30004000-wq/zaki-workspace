"use client";

import { useId, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, CircleHelp, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { FEATURES, withFeature, type FeatureKey } from "@/lib/features";
import {
  canResetCapabilities,
  capabilityGroups,
  explainAreas,
  explainState,
  permissionAreas,
  SOON_CAPABILITIES,
  type ActorInfo,
  type CapabilityPanelMode,
  type CapabilityRow,
  type ContractMember,
  type ExplainAreaRows,
  type ExplainState,
  type PermissionAreaRows,
  type TFn,
} from "@/lib/members-ui";
import type { Capability, CapabilityExplanation } from "@/server/policy/capabilities";
import { SectionGrid } from "./section-grid";
import { SwitchRow } from "./switch-row";

/**
 * The permissions of one person (A1.2), read by AREA in plain words: «المهام والمشاريع», «الدردشة والمكالمات», «الملفات»,
 * «الزبائن والأسعار», «التقارير واللوحات», «إدارة الناس والمساحات», «التكاملات». Each area is collapsed until opened and holds the
 * grid's «يشوف / يضيف ويعدّل / يحذف» rows of its sections and its single switches, each with a plain title, a one-line
 * explanation and a small label that shows whether it is what the rank gives or something the owner changed. Above them
 * «شو بيقدر يعمل؟» lists every permission with ✓/✗ and WHY, from `explainCapabilities`, which agrees with the server's own
 * `effectiveCapabilities` for every rank and switch. A guest (external partner) shows the sentence that partners hold no
 * capability instead. Only capabilities wired to something are offered: the owner-only archive is listed only on a partner's sheet,
 * and the ones a later phase will wire are named as «قريبًا» under the areas, never as a switch, since a switch that does nothing is a lie.
 * Each flip is saved at once by the caller.
 */
export function CapabilityPanel({
  member,
  actor,
  mode,
  busy,
  pendingCapability,
  onToggle,
  onReset,
}: {
  member: ContractMember;
  actor: ActorInfo;
  mode: CapabilityPanelMode;
  /** A save is in flight: every switch waits for it. */
  busy: boolean;
  pendingCapability: Capability | null;
  onToggle: (capability: Capability, on: boolean) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  // an owner's or a guest's sheet is one sentence: nothing to explain, nothing to fetch
  const company = useCompanySettings(actor.sectionGrid !== false, mode === "editable" || mode === "readonly");

  if (mode === "owner") return <p className="text-sm text-fg-muted">{t("members.caps_owner")}</p>;
  if (mode === "guest") return <p className="rounded-lg bg-surface-2 p-3 text-sm leading-6 text-fg-muted">{t("members.caps_guest")}</p>;

  const editable = mode === "editable";
  const areas = permissionAreas(member, actor, editable);
  // silent oversight: a switch of its own for the primary owner, on a partner's sheet only
  const oversight = capabilityGroups(member, actor, editable).find((group) => group.id === "oversight");

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-fg-muted">{editable ? t("members.caps_intro") : t("members.caps_readonly")}</p>

      <ExplainView member={member} settings={company.settings} ready={company.ready} known={company.known} />

      {oversight ? (
        <section aria-labelledby={`${uid}-oversight`} className="rounded-xl border border-border bg-surface">
          <h4 id={`${uid}-oversight`} className="border-b border-border px-3 py-2 text-xs font-semibold text-fg-muted">
            {t("members.group_oversight")}
          </h4>
          <div className="divide-y divide-border p-1">
            {oversight.rows.map((row) => (
              <CapabilitySwitch key={row.capability} row={row} busy={busy} pendingCapability={pendingCapability} onToggle={onToggle} t={t} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-xs leading-5 text-muted">
        {t("perm.areas_hint")}
        {areas.some((area) => area.grid.length > 0) ? ` ${t("members.sections_intro")}` : ""}
      </p>

      <div className="space-y-2">
        {areas.map((area) => (
          <Area key={area.id} area={area} busy={busy} pendingCapability={pendingCapability} onToggle={onToggle} t={t} />
        ))}
      </div>

      {areas.some((area) => area.grid.length > 0) ? (
        <p className="text-xs leading-5 text-muted">
          <span className="me-1 inline-block size-1.5 rounded-full bg-warn align-middle" aria-hidden="true" />
          {t("members.sections_legend")}
        </p>
      ) : null}

      {SOON_CAPABILITIES.length > 0 ? (
        <section aria-labelledby={`${uid}-soon`} className="rounded-xl border border-dashed border-border p-3">
          <h4 id={`${uid}-soon`} className="text-xs font-semibold text-fg-muted">
            {t("members.caps_soon_title")}
          </h4>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t("members.caps_soon_hint")}</p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {SOON_CAPABILITIES.map((capability) => (
              <li key={capability} className="text-xs text-muted">
                {t(`members.cap.${capability}.title`)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {editable && canResetCapabilities(member, actor) ? (
        <Button
          type="button"
          variant="secondary"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onReset();
          }}
          className={cn("h-11 w-full", busy && "cursor-not-allowed opacity-50")}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {t("members.caps_reset")}
        </Button>
      ) : null}
    </div>
  );
}

/** One area: collapsed by default (a native `<details>`), its name and how many of its boxes are on in the header. */
function Area({
  area,
  busy,
  pendingCapability,
  onToggle,
  t,
}: {
  area: PermissionAreaRows;
  busy: boolean;
  pendingCapability: Capability | null;
  onToggle: (capability: Capability, on: boolean) => void;
  t: TFn;
}) {
  const title = t(`perm.area.${area.id}`);
  return (
    <details data-area={area.id} className="group rounded-xl border border-border bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <h4 className="min-w-0 flex-1 text-sm font-semibold text-fg">{title}</h4>
        <span className="shrink-0 text-xs text-muted">{t("perm.area_count", { on: area.on, total: area.total })}</span>
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border">
        <SectionGrid rows={area.grid} caption={title} busy={busy} pendingCapability={pendingCapability} onToggle={onToggle} />
        {area.rows.length > 0 ? (
          <div className={cn("divide-y divide-border p-1", area.grid.length > 0 && "border-t border-border")}>
            {area.rows.map((row) => (
              <CapabilitySwitch key={row.capability} row={row} busy={busy} pendingCapability={pendingCapability} onToggle={onToggle} t={t} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function CapabilitySwitch({
  row,
  busy,
  pendingCapability,
  onToggle,
  t,
}: {
  row: CapabilityRow;
  busy: boolean;
  pendingCapability: Capability | null;
  onToggle: (capability: Capability, on: boolean) => void;
  t: TFn;
}) {
  return (
    <SwitchRow
      checked={row.on}
      disabled={row.locked !== null}
      busy={pendingCapability === row.capability}
      waiting={busy && pendingCapability !== row.capability}
      title={t(`members.cap.${row.capability}.title`)}
      hint={t(`members.cap.${row.capability}.hint`)}
      tag={rowTag(row, t)}
      note={rowNote(row, t)}
      onChange={(next) => onToggle(row.capability, next)}
    />
  );
}

// ------------------------------------------------------------------------------------------ «شو بيقدر يعمل؟»

/**
 * The company's settings as far as «شو بيقدر يعمل؟» needs them: its switches («الميزات», readable by staff). While they load nothing
 * is claimed; if they can not be read, every switch is taken as on, so the view shows what the person HOLDS (always right) and
 * says nothing about a switch it could not see. «صلاحيات الأقسام» comes from the people list, as the rest of the sheet does.
 */
function useCompanySettings(sectionGrid: boolean, enabled: boolean): { settings: unknown; ready: boolean; known: boolean } {
  const query = useQuery({
    queryKey: ["member-sheet-features"],
    queryFn: () => apiGet<{ features: { key: FeatureKey; on: boolean }[] }>("/api/settings/features"),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  let settings: Record<string, unknown> = {};
  if (query.isSuccess) {
    for (const item of query.data.features) settings = withFeature(settings, item.key, item.on);
  } else {
    for (const key of FEATURES) settings = withFeature(settings, key, key !== "economyMode");
  }
  return { settings: withFeature(settings, "sectionPermissions", sectionGrid), ready: !query.isPending || !enabled, known: query.isSuccess };
}

/** Every permission the screen offers with ✓/✗ and why, by area, collapsed by default. */
function ExplainView({ member, settings, ready, known }: { member: ContractMember; settings: unknown; ready: boolean; known: boolean }) {
  const { t } = useI18n();
  const areas: ExplainAreaRows[] = ready ? explainAreas(member, settings) : [];
  const rows = areas.flatMap((area) => area.rows);
  const usable = rows.filter((row) => explainState(row, known) === "can").length;
  return (
    <details data-explain className="group rounded-xl border border-border bg-surface">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <CircleHelp className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <h4 className="min-w-0 flex-1 text-sm font-semibold text-fg">{t("perm.explain.title")}</h4>
        <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-xs leading-5 text-fg-muted">
          {t("perm.explain.hint")} {ready ? t("perm.explain.count", { on: usable, total: rows.length }) : "…"}
        </p>
        {areas.map((area) => (
          <section key={area.id} aria-label={t(`perm.area.${area.id}`)}>
            <h5 className="text-xs font-semibold text-fg-muted">{t(`perm.area.${area.id}`)}</h5>
            <ul className="divide-y divide-border">
              {area.rows.map((row) => (
                <ExplainItem key={row.capability} row={row} state={explainState(row, known)} t={t} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

function ExplainItem({ row, state, t }: { row: CapabilityExplanation; state: ExplainState; t: TFn }) {
  const unknown = state === "unknown";
  const why = unknown
    ? t("perm.why.feature_unknown", { name: t(`features.${row.feature}.name`) })
    : row.reason === "feature_off" && row.feature
      ? t("perm.why.feature_off", { name: t(`features.${row.feature}.name`) })
      : t(`perm.why.${row.reason}`);
  return (
    <li data-capability={row.capability} data-usable={unknown ? "unknown" : state === "can"} className="flex items-start gap-2 py-2">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
          unknown ? "bg-surface-2 text-muted" : state === "can" ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger",
        )}
      >
        {unknown ? <CircleHelp className="size-3.5" /> : state === "can" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">
          {t(`members.cap.${row.capability}.title`)}
          {unknown ? null : <span className="sr-only"> — {state === "can" ? t("perm.explain.can") : t("perm.explain.cannot")}</span>}
        </span>
        <span className="block text-xs leading-5 text-fg-muted">{why}</span>
      </span>
    </li>
  );
}

/** "حسب الرتبة", or what the owner changed: "أُضيف فوق الرتبة" / "سُحب من الرتبة". */
function rowTag(row: CapabilityRow, t: TFn): ReactNode {
  if (!row.customized) return <span className="text-muted">{t("members.caps_default")}</span>;
  return (
    <span className="font-medium text-warn">
      {row.on ? t("members.caps_added") : t("members.caps_removed")}
    </span>
  );
}

/** The two things worth a second line: you cannot hand this one out, or it is a sensitive extra. */
function rowNote(row: CapabilityRow, t: TFn): ReactNode {
  if (row.locked === "actor_lacks") return <span className="text-muted">{t("members.caps_locked_actor")}</span>;
  if (row.sensitive && row.on && !row.rankDefault) {
    return <span className="text-warn">{t("members.caps_sensitive")}</span>;
  }
  return null;
}
