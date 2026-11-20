"use client";

import { useId, useState } from "react";
import { ChevronDown, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import {
  EMPTY_ADD_FORM,
  JOB_TITLE_MAX,
  NAME_MAX,
  USERNAME_MAX,
  creatableRoles,
  managerCandidates,
  normalizeUsername,
  type ActorInfo,
  type AddFormField,
  type AddFormValues,
  type ContractMember,
  type ContractSpace,
} from "@/lib/members-ui";
import { createMember, type CreatedPerson } from "./api";
import { CredentialsCard } from "./credentials-card";
import { Field } from "./field";
import { ManagerPicker } from "./manager-picker";
import { Sheet } from "./sheet";
import { SwitchRow } from "./switch-row";
import { TemplatePicker, useRoleTemplates } from "./template-picker";

/**
 * Add a person in ONE short form: name, username, rank, job title, the spaces they will see and a
 * switch that generates the temporary password (on by default; off lets the owner type one). When
 * it succeeds the same panel turns into the result card with the username and the password to copy:
 * no second screen and no reload.
 */
export function AddMemberSheet({
  orgId,
  actor,
  members,
  spaces,
  onClose,
  onCreated,
}: {
  orgId: string;
  actor: ActorInfo;
  members: readonly ContractMember[];
  spaces: readonly ContractSpace[];
  onClose: () => void;
  /** The list should be refreshed: a person now exists. */
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const ranks = creatableRoles(actor.role);
  const [values, setValues] = useState<AddFormValues>(() => ({
    ...EMPTY_ADD_FORM,
    role: ranks.includes("MEMBER") ? "MEMBER" : (ranks[0] ?? "GUEST"),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPerson | null>(null);
  // A1.1: «القالب» appears only while the company's switch is on (the templates door answers «not found» otherwise)
  const templates = useRoleTemplates(orgId);

  const fieldId = (name: string) => `${uid}-${name}`;
  const set = <K extends keyof AddFormValues>(key: K, value: AddFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const managers = managerCandidates(members, "");
  const allSpaces = spaces.length > 0 && spaces.every((s) => values.workspaceIds.includes(s.id));
  const secretOnScreen = created !== null && created.password !== null;
  const started = Boolean(
    values.name || values.username || values.email || values.jobTitle || values.password || values.workspaceIds.length > 0,
  );

  function focusField(field: AddFormField | undefined) {
    if (field) document.getElementById(fieldId(field))?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await createMember(orgId, values, t);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      focusField(result.field ?? (result.messageKey === "accounts.username_taken" ? "username" : undefined));
      return;
    }
    setCreated(result.value);
    onCreated();
  }

  function addAnother() {
    setCreated(null);
    setError(null);
    setValues({ ...EMPTY_ADD_FORM, role: values.role, workspaceIds: values.workspaceIds, templateId: values.templateId });
  }

  function toggleSpace(id: string, on: boolean) {
    set("workspaceIds", on ? [...values.workspaceIds, id] : values.workspaceIds.filter((x) => x !== id));
  }

  return (
    <Sheet
      title={t("members.add_title")}
      onClose={() => {
        if (!busy) onClose();
      }}
      // a stray tap on the dim area must not throw away what was typed (Escape and the X still close it)
      dismissOnBackdrop={!busy && !secretOnScreen && !started}
    >
      {created ? (
        <CredentialsCard
          heading={t("members.created_title")}
          name={created.name}
          username={created.username}
          password={created.password}
          onDone={onClose}
          secondary={{ label: t("members.add_another"), onClick: addAnother }}
        />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
          <Field id={fieldId("name")} label={t("orgm.name")}>
            <Input
              id={fieldId("name")}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              autoComplete="off"
              maxLength={NAME_MAX}
              required
              className="h-11"
            />
          </Field>

          <Field id={fieldId("username")} label={t("members.f_username")} hint={t("members.f_username_hint")}>
            <Input
              id={fieldId("username")}
              value={values.username}
              onChange={(e) => set("username", normalizeUsername(e.target.value))}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={USERNAME_MAX}
              required
              data-lpignore="true"
              data-1p-ignore="true"
              className="h-11 text-start"
            />
          </Field>

          {templates.enabled ? (
            <TemplatePicker
              id={fieldId("template")}
              templates={templates.templates}
              actor={actor}
              value={values.templateId}
              // a template carries its rank: the person is made with it
              onChange={(templateId, template) => setValues((v) => ({ ...v, templateId, ...(template ? { role: template.rank } : {}) }))}
              hint={t("ptemplates.hint_create")}
            />
          ) : null}

          <Field id={fieldId("role")} label={t("members.f_rank")} hint={values.templateId ? t("ptemplates.rank_from_template") : rankHint(values.role, t)}>
            <Select
              id={fieldId("role")}
              value={values.role}
              disabled={values.templateId !== ""}
              onChange={(e) => set("role", e.target.value as AddFormValues["role"])}
              className="h-11"
            >
              {ranks.map((role) => (
                <option key={role} value={role}>
                  {t(ROLE_KEYS[role] ?? "role.member")}
                </option>
              ))}
            </Select>
          </Field>

          <Field id={fieldId("title")} label={t("members.f_title")}>
            <Input
              id={fieldId("title")}
              value={values.jobTitle}
              onChange={(e) => set("jobTitle", e.target.value)}
              autoComplete="off"
              maxLength={JOB_TITLE_MAX}
              className="h-11"
            />
          </Field>

          <details className="group rounded-xl border border-border bg-surface-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
              {t("members.more_options")}
              <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <Field id={fieldId("email")} label={t("members.f_email")}>
                <Input
                  id={fieldId("email")}
                  type="email"
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                  dir="ltr"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 text-start"
                />
              </Field>
              {values.role !== "GUEST" ? (
                <Field id={fieldId("manager")} label={t("members.f_manager")}>
                  <ManagerPicker id={fieldId("manager")} value={values.managerId} onChange={(managerId) => set("managerId", managerId)} options={managers} />
                </Field>
              ) : null}
            </div>
          </details>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">{t("members.f_spaces")}</legend>
            <p className="text-xs leading-5 text-fg-muted">{t("members.f_spaces_hint")}</p>
            {spaces.length === 0 ? (
              <p className="rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">{t("members.spaces_empty")}</p>
            ) : (
              <>
                {spaces.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => set("workspaceIds", allSpaces ? [] : spaces.map((s) => s.id))}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-accent hover:bg-surface-2"
                  >
                    {allSpaces ? t("members.select_none") : t("members.select_all")}
                  </button>
                ) : null}
                <div className="grid grid-cols-1 gap-2">
                  {spaces.map((space) => {
                    const on = values.workspaceIds.includes(space.id);
                    return (
                      <label
                        key={space.id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 text-sm text-fg hover:bg-surface-1"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggleSpace(space.id, e.target.checked)}
                          className="size-5 shrink-0 accent-accent"
                        />
                        <span className="min-w-0 flex-1 break-words">{space.name}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </fieldset>

          <div className="rounded-xl border border-border bg-surface">
            <SwitchRow
              checked={values.autoPassword}
              onChange={(next) => set("autoPassword", next)}
              title={t("members.auto_password")}
              hint={t("members.auto_password_hint")}
            />
            {!values.autoPassword ? (
              <div className="space-y-1.5 border-t border-border p-3">
                <label htmlFor={fieldId("password")} className="block text-sm font-medium text-fg">
                  {t("members.f_password")}
                </label>
                <Input
                  id={fieldId("password")}
                  type="text"
                  value={values.password}
                  onChange={(e) => set("password", e.target.value)}
                  dir="ltr"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  className="h-11 font-mono text-start"
                />
                <p className="text-xs leading-5 text-fg-muted">
                  {t("auth.passwordRule")} {t("members.f_password_hint")}
                </p>
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" aria-disabled={busy || undefined} className={cn("h-12 w-full text-base", busy && "cursor-not-allowed opacity-70")}>
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <UserPlus className="size-5" aria-hidden="true" />}
            {t("members.create")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function rankHint(role: AddFormValues["role"], t: (key: string) => string): string | undefined {
  const key = `members.rank_hint_${role.toLowerCase()}`;
  const text = t(key);
  return text === key ? undefined : text;
}
