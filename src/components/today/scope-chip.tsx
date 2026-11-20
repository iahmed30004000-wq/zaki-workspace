import { getServerT } from "@/lib/i18n/server";
import type { TeamScopeInfo } from "@/server/policy/people-scope";

/**
 * What a team number was counted over, in words (A2.3: every KPI shows its scope). «كل الشركة» (the OWNER rank), «فريقي» (the people under
 * the person in the reporting line), and the space when the numbers were narrowed to the one the person is in.
 */
export function scopeInfoLabel(info: TeamScopeInfo): string {
  const { t } = getServerT();
  if (info.spaceName) return info.who === "company" ? t("today.team.scope_space", { name: info.spaceName }) : t("today.team.scope_mine_space", { name: info.spaceName });
  return info.who === "company" ? t("today.team.scope_company") : t("today.team.scope_mine");
}

/** The chip. `data-today-scope` carries the kind for tests and styles; the text is the only thing a person reads. */
export function ScopeChip({ info }: { info: TeamScopeInfo }) {
  return (
    <span data-today-scope={info.who} className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-muted">
      <bdi>{scopeInfoLabel(info)}</bdi>
    </span>
  );
}
