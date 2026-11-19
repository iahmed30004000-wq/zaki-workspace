"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { templateProblem, type RoleTemplate } from "@/lib/permission-templates";
import { cn } from "@/lib/utils";
import type { ActorInfo, ContractMember, OrgRoleName } from "@/lib/members-ui";
import { CAPABILITIES } from "@/server/policy/capabilities";
import { membersApi } from "./api";
import { Field } from "./field";

/**
 * «قوالب» (A1.1) on the people screen: the picker of the create-account sheet and the section of a person's sheet.
 * Everything here is only about what to OFFER (the server judges every application again): a template the person looking cannot give is
 * greyed out with the reason, never hidden. Behind the company's switch `permissionTemplates`: while it is off the templates door answers
 * «not found» and nothing here is drawn.
 */

/** The company's templates, or `enabled: false` while the switch is off (or the person may not list them). */
export function useRoleTemplates(orgId: string): { enabled: boolean; templates: RoleTemplate[] } {
  const query = useQuery({
    queryKey: ["role-templates", orgId],
    queryFn: () => membersApi.templates(orgId),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return query.isSuccess ? { enabled: true, templates: query.data.templates } : { enabled: false, templates: [] };
}

/** What the person looking holds as far as handing out goes (the primary owner holds everything, whatever list the page was given). */
function holderOf(actor: ActorInfo) {
  return { role: actor.role, caps: new Set<string>(actor.role === "OWNER" && actor.primaryOwner !== false ? CAPABILITIES : actor.caps) };
}

/** Why this person may not give this template (a dictionary key), or null. */
function unavailable(actor: ActorInfo, template: RoleTemplate, targetRole?: OrgRoleName): string | null {
  const problem = templateProblem(holderOf(actor), template, targetRole);
  if (!problem) return null;
  return problem === "ptemplates.exceeds_applier" ? "ptemplates.unavailable_exceeds" : problem === "orgm.role_denied" ? "ptemplates.unavailable_rank" : problem;
}

export function TemplatePicker({
  id,
  templates,
  actor,
  value,
  onChange,
  targetRole,
  disabled = false,
  hint,
}: {
  id: string;
  templates: readonly RoleTemplate[];
  actor: ActorInfo;
  /** The chosen template's id; "" = none. */
  value: string;
  onChange: (templateId: string, template: RoleTemplate | null) => void;
  /** The rank of the person it would be applied to, when they already exist. */
  targetRole?: OrgRoleName;
  disabled?: boolean;
  hint?: string;
}) {
  const { t } = useI18n();
  const chosen = templates.find((x) => x.id === value) ?? null;
  return (
    <Field id={id} label={t("ptemplates.label")} hint={hint}>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value, templates.find((x) => x.id === e.target.value) ?? null)}
        className="h-11"
      >
        <option value="">{t("ptemplates.none")}</option>
        {templates.map((template) => {
          const why = unavailable(actor, template, targetRole);
          return (
            <option key={template.id} value={template.id} disabled={why !== null}>
              {template.name}
              {why !== null ? ` — ${t(why)}` : ""}
            </option>
          );
        })}
      </Select>
      {chosen ? (
        <p className="text-xs leading-5 text-fg-muted">
          {t("ptemplates.summary", {
            rank: t(ROLE_KEYS[chosen.rank] ?? "role.member"),
            adds: chosen.caps.length,
            removes: chosen.revoked.length,
          })}
        </p>
      ) : null}
    </Field>
  );
}

/**
 * The body of the «القالب» section of a person's sheet: «القالب: X» (and «معدّل» once changed by hand), the picker, and the button that applies it
 * with the ⚠️ and its 🔧. `onApply` runs the call and the sheet's busy state; this part only chooses.
 */
export function MemberTemplateSection({
  id,
  member,
  actor,
  templates,
  busy,
  applying,
  onApply,
}: {
  id: string;
  member: ContractMember;
  actor: ActorInfo;
  templates: readonly RoleTemplate[];
  /** Some action of the sheet is running. */
  busy: boolean;
  /** THIS action is running. */
  applying: boolean;
  onApply: (templateId: string) => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState("");
  const current = member.template ?? null;
  const pickedTemplate = templates.find((x) => x.id === picked) ?? null;
  const canApply = pickedTemplate !== null && unavailable(actor, pickedTemplate, member.role) === null;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
      {current ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <span>{t("ptemplates.current", { name: current.name })}</span>
          {current.modified ? (
            <span title={t("ptemplates.modified_hint")} className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">
              {t("ptemplates.modified")}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs leading-5 text-fg-muted">{t("ptemplates.none_applied")}</p>
      )}
      <TemplatePicker id={id} templates={templates} actor={actor} value={picked} onChange={(next) => setPicked(next)} targetRole={member.role} />
      <div role="note" className="space-y-1 rounded-lg bg-warn/10 p-3 text-xs leading-6 text-warn">
        <p>{t("ptemplates.warn")}</p>
        <p>{t("ptemplates.fix")}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        aria-disabled={!canApply || busy || undefined}
        onClick={() => {
          if (canApply && !busy) onApply(picked);
        }}
        className={cn("h-11 w-full", (!canApply || busy) && "cursor-not-allowed opacity-50")}
      >
        {applying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t("ptemplates.apply")}
      </Button>
    </div>
  );
}
