"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { KeyRound, Loader2, LogOut, PauseCircle, RotateCcw, UserMinus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import {
  JOB_TITLE_MAX,
  NAME_MAX,
  buildInfoPatch,
  capabilityPatch,
  lastLoginLine,
  managerCandidates,
  offeredActions,
  toggleCapability,
  transferCandidates,
  type ActorInfo,
  type ContractMember,
  type InfoForm,
} from "@/lib/members-ui";
import type { Capability } from "@/server/policy/capabilities";
import { cn } from "@/lib/utils";
import {
  applyTemplate,
  logoutEverywhere,
  offboardMember,
  reactivateMember,
  resetCapabilities,
  resetMemberPassword,
  saveMemberInfo,
  setCapability,
  suspendMember,
} from "./api";
import { RankBadge, StatusBadge } from "./badges";
import { CapabilityPanel } from "./capability-panel";
import { CredentialsCard } from "./credentials-card";
import { Field } from "./field";
import { ManagerPicker } from "./manager-picker";
import { Sheet } from "./sheet";
import { MemberTemplateSection, useRoleTemplates } from "./template-picker";

type View =
  | { kind: "main" }
  | { kind: "confirm"; action: "suspend" | "offboard" }
  | { kind: "secret"; heading: string; password: string | null; note?: string };

type Busy = "info" | "caps" | "template" | "reset" | "logout" | "suspend" | "offboard" | "reactivate" | null;

/**
 * Everything about one person, in the panel that opens when their card is tapped (a bottom sheet on
 * a phone, a side panel on a wide screen): edit name, title, rank and manager; switch single
 * capabilities; reset the password; end every session; suspend, reactivate or offboard.
 *
 * Only what the actor may do is offered (see `offeredActions`); the server enforces it again. Suspend
 * and offboard ask ONE confirmation that spells out the consequence; everything else is instant with a
 * small toast. A password that is shown only once appears in the same panel, never on another screen.
 */
export function MemberSheet({
  orgId,
  member,
  members,
  actor,
  now,
  onClose,
  onPatch,
  onChanged,
}: {
  orgId: string;
  member: ContractMember;
  members: readonly ContractMember[];
  actor: ActorInfo;
  now: number;
  onClose: () => void;
  /** Apply a change to this person in the cached list at once (the server already accepted it). */
  onPatch: (userId: string, patch: Partial<ContractMember>) => void;
  /** Something changed on the server: refresh the list. */
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const uid = useId();
  const acts = offeredActions(actor, member);
  // A1.1: the «القالب» section appears only while the company's switch is on (the templates door answers «not found» otherwise)
  const templates = useRoleTemplates(orgId);

  const [view, setView] = useState<View>({ kind: "main" });
  const [busy, setBusy] = useState<Busy>(null);
  const [pendingCap, setPendingCap] = useState<Capability | null>(null);
  const [form, setForm] = useState<InfoForm>(() => ({
    name: member.name,
    jobTitle: member.jobTitle ?? "",
    role: member.role,
    managerId: member.managerId ?? "",
  }));
  const [infoError, setInfoError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [forceTransfer, setForceTransfer] = useState(false);

  // Leaving a confirmation or a password card puts focus back on the button that opened it (or on the
  // panel when that button is gone), so a keyboard or screen-reader user does not start over from the top.
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (view.kind !== "main" || returnFocus.current === null) return;
    const key = returnFocus.current;
    returnFocus.current = null;
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-action="${key}"]`);
    (target ?? rootRef.current)?.focus();
  }, [view.kind]);

  const dirty = Object.keys(buildInfoPatch(member, form)).length > 0;
  const needsTransfer = member.openWork > 0 || forceTransfer;
  const secretOnScreen = view.kind === "secret" && view.password !== null;

  // ------------------------------------------------------------------ actions

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy("info");
    setInfoError(null);
    const res = await saveMemberInfo(orgId, member, form, members, actor, t);
    setBusy(null);
    if (!res.ok) {
      setInfoError(res.message);
      return;
    }
    if (res.value) {
      onPatch(member.id, res.value);
      onChanged();
      toast(t("members.saved"), "success");
    }
  }

  async function toggle(capability: Capability, on: boolean) {
    if (busy) return;
    setBusy("caps");
    setPendingCap(capability);
    const before = {
      capabilities: member.capabilities,
      revokedCapabilities: member.revokedCapabilities,
      effectiveCapabilities: member.effectiveCapabilities,
    };
    onPatch(member.id, capabilityPatch(member, toggleCapability(member, capability, on)));
    const res = await setCapability(orgId, member, capability, on, t);
    setBusy(null);
    setPendingCap(null);
    if (!res.ok) {
      onPatch(member.id, before);
      toast(res.message, "error");
      return;
    }
    onChanged();
    toast(t("members.caps_saved"), "success");
  }

  async function applyChosenTemplate(templateId: string) {
    if (busy) return;
    setBusy("template");
    const res = await applyTemplate(orgId, member, templateId, t);
    setBusy(null);
    if (!res.ok) {
      toast(res.message, "error");
      return;
    }
    onPatch(member.id, res.value);
    // the rank may have changed: the form must not offer the old one back as an unsaved edit
    if (res.value.role) setForm((f) => ({ ...f, role: res.value.role as InfoForm["role"] }));
    onChanged();
    toast(t("ptemplates.applied_done", { name: res.value.template?.name ?? "" }), "success");
  }

  async function resetAllCapabilities() {
    if (busy) return;
    setBusy("caps");
    const res = await resetCapabilities(orgId, member, actor, t);
    setBusy(null);
    if (!res.ok) {
      toast(res.message, "error");
      return;
    }
    onPatch(member.id, res.value);
    onChanged();
    toast(t("members.caps_reset_done"), "success");
  }

  async function resetPassword() {
    if (busy) return;
    setBusy("reset");
    const res = await resetMemberPassword(orgId, member, t);
    setBusy(null);
    if (!res.ok) {
      toast(res.message, "error");
      return;
    }
    onPatch(member.id, res.value.patch);
    onChanged();
    returnFocus.current = "reset";
    setView({ kind: "secret", heading: t("members.reset_title"), password: res.value.password });
  }

  async function endSessions() {
    if (busy) return;
    setBusy("logout");
    const res = await logoutEverywhere(orgId, member, t);
    setBusy(null);
    if (!res.ok) {
      toast(res.message, "error");
      return;
    }
    toast(t("members.logged_out"), "success");
  }

  async function reactivate() {
    if (busy) return;
    setBusy("reactivate");
    const wasOffboarded = member.status === "OFFBOARDED";
    const res = await reactivateMember(orgId, member, t);
    setBusy(null);
    if (!res.ok) {
      toast(res.message, "error");
      return;
    }
    onPatch(member.id, res.value.patch);
    onChanged();
    returnFocus.current = "reactivate";
    setView({
      kind: "secret",
      heading: t("members.reactivated_title"),
      password: res.value.password,
      ...(wasOffboarded ? { note: t("members.reactivated_no_spaces") } : {}),
    });
  }

  async function confirmSuspend() {
    if (busy) return;
    setBusy("suspend");
    setConfirmError(null);
    const res = await suspendMember(orgId, member, t);
    setBusy(null);
    if (!res.ok) {
      setConfirmError(res.message);
      return;
    }
    onPatch(member.id, res.value);
    onChanged();
    toast(t("members.suspended_done", { name: member.name }), "success");
    returnFocus.current = "suspend";
    setView({ kind: "main" });
  }

  async function confirmOffboard() {
    if (busy || (needsTransfer && !transferTo)) return;
    setBusy("offboard");
    setConfirmError(null);
    const res = await offboardMember(orgId, member, needsTransfer ? transferTo || null : null, t);
    setBusy(null);
    if (!res.ok) {
      // the list was stale: this person has open work now, so a person to hand it to is required
      if (res.messageKey === "accounts.transfer_required") {
        setForceTransfer(true);
        onChanged();
      }
      setConfirmError(res.message);
      return;
    }
    onPatch(member.id, res.value);
    onChanged();
    toast(t("members.offboarded_done", { name: member.name }), "success");
    returnFocus.current = "offboard";
    setView({ kind: "main" });
  }

  // ------------------------------------------------------------------ pieces

  const managerOptions = managerCandidates(members, member.id);
  const roleOptions = acts.rankChoices.includes(member.role) ? acts.rankChoices : [member.role, ...acts.rankChoices];
  const transferOptions = transferCandidates(members, member.id);

  const identity = member.username ? `@${member.username}` : member.email;

  const body = (() => {
    if (view.kind === "secret") {
      return (
        <CredentialsCard
          heading={view.heading}
          name={member.name}
          username={member.username ?? member.email ?? ""}
          password={view.password}
          note={view.note}
          onDone={() => setView({ kind: "main" })}
          doneLabel={t("members.back")}
        />
      );
    }

    if (view.kind === "confirm") {
      const offboarding = view.action === "offboard";
      return (
        <ConfirmBlock
          title={t(offboarding ? "members.confirm_offboard_title" : "members.confirm_suspend_title", { name: member.name })}
          body={t(offboarding ? "members.confirm_offboard_body" : "members.confirm_suspend_body")}
          fix={t(offboarding ? "members.confirm_offboard_fix" : "members.confirm_suspend_fix")}
          confirmLabel={t(offboarding ? "members.confirm_offboard_yes" : "members.confirm_suspend_yes")}
          busy={busy === view.action}
          disabled={offboarding && needsTransfer && !transferTo}
          error={confirmError}
          onConfirm={offboarding ? confirmOffboard : confirmSuspend}
          onCancel={() => {
            setConfirmError(null);
            returnFocus.current = view.action;
            setView({ kind: "main" });
          }}
        >
          {offboarding && needsTransfer ? (
            <Field
              id={`${uid}-transfer`}
              label={t("members.transfer_label")}
              hint={member.openWork > 0 ? t("members.transfer_hint", { n: member.openWork }) : t("accounts.transfer_required")}
            >
              <Select id={`${uid}-transfer`} value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="h-11" required>
                <option value="">{t("members.transfer_pick")}</option>
                {transferOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {t(ROLE_KEYS[m.role] ?? "role.member")}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </ConfirmBlock>
      );
    }

    return (
      <div ref={rootRef} tabIndex={-1} className="space-y-5 outline-none">
        <div className="flex items-start gap-3">
          <Avatar name={member.name} src={member.avatarUrl} className="h-14 w-14 text-base" />
          <div className="min-w-0 flex-1 space-y-1.5">
            {identity ? (
              <p className="break-words text-sm text-fg-muted">
                <span dir="ltr" className="inline-block max-w-full break-all align-bottom">
                  {identity}
                </span>
                {member.jobTitle ? ` · ${member.jobTitle}` : null}
              </p>
            ) : member.jobTitle ? (
              <p className="break-words text-sm text-fg-muted">{member.jobTitle}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <RankBadge role={member.role} primaryOwner={member.primaryOwner} />
              <StatusBadge status={member.status} />
              {acts.isSelf ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{t("members.you")}</span>
              ) : null}
            </div>
            <p className="text-xs text-muted">{lastLoginLine(member.lastLoginAt, now, t)}</p>
          </div>
        </div>

        {member.status === "SUSPENDED" ? <Note>{t("members.suspended_note")}</Note> : null}
        {member.status === "OFFBOARDED" ? <Note>{t("members.offboarded_note")}</Note> : null}

        {member.mustChangePassword && member.status === "ACTIVE" ? (
          <div role="note" className="space-y-1 rounded-lg bg-warn/10 p-3 text-xs leading-6 text-warn">
            <p className="font-semibold">{t("members.pw_pending_warning")}</p>
            <p>{t("members.pw_pending_fix")}</p>
          </div>
        ) : null}

        {!acts.manageable ? (
          <Note>
            {acts.isSelf ? (
              <>
                {t("members.view_only_self")}{" "}
                <Link href="/profile" className="font-medium text-accent underline">
                  {t("members.profile_link")}
                </Link>
              </>
            ) : member.role === "OWNER" ? (
              t("members.view_only_owner")
            ) : (
              t("members.view_only")
            )}
          </Note>
        ) : null}

        <Section title={t("members.section_info")}>
          {acts.edit ? (
            <form onSubmit={saveInfo} noValidate className="space-y-4 rounded-xl border border-border bg-surface p-3">
              <Field id={`${uid}-name`} label={t("orgm.name")}>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  className="h-11"
                />
              </Field>
              <Field id={`${uid}-title`} label={t("auth.jobTitle")}>
                <Input
                  id={`${uid}-title`}
                  value={form.jobTitle}
                  onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                  maxLength={JOB_TITLE_MAX}
                  autoComplete="off"
                  className="h-11"
                />
              </Field>
              <Field id={`${uid}-rank`} label={t("members.f_rank")}>
                <Select
                  id={`${uid}-rank`}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as InfoForm["role"] })}
                  className="h-11"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {/* whoever the primary owner makes an OWNER is a partner */}
                      {t(role === "OWNER" && member.primaryOwner !== true ? "role.partner" : (ROLE_KEYS[role] ?? "role.member"))}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.role !== "GUEST" ? (
                <Field id={`${uid}-manager`} label={t("members.f_manager")}>
                  <ManagerPicker
                    id={`${uid}-manager`}
                    value={form.managerId}
                    onChange={(managerId) => setForm({ ...form, managerId })}
                    options={managerOptions}
                    current={member.managerId ? { id: member.managerId, name: member.managerName ?? "—" } : null}
                  />
                </Field>
              ) : null}
              {infoError ? (
                <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
                  {infoError}
                </p>
              ) : null}
              <Button
                type="submit"
                aria-disabled={!dirty || busy !== null ? true : undefined}
                className={cn("h-11 w-full", (!dirty || busy !== null) && "cursor-not-allowed opacity-50")}
              >
                {busy === "info" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {t("members.save")}
              </Button>
            </form>
          ) : (
            <ReadOnlyInfo member={member} />
          )}
        </Section>

        {/* S5.5: «إشارة التوثيق» — the OWNER only (the server checks the rank again), never a guest; it sits here, in the shared card, wherever the section lives */}
        {actor.role === "OWNER" && member.role !== "GUEST" ? <VerifiedSection orgId={orgId} member={member} onPatch={onPatch} onChanged={onChanged} /> : null}

        {templates.enabled && acts.edit && member.role !== "OWNER" && member.role !== "GUEST" ? (
          <Section title={t("ptemplates.section")}>
            <MemberTemplateSection
              id={`${uid}-template`}
              member={member}
              actor={actor}
              templates={templates.templates}
              busy={busy !== null}
              applying={busy === "template"}
              onApply={applyChosenTemplate}
            />
          </Section>
        ) : null}

        <Section title={t("members.section_caps")}>
          <CapabilityPanel
            member={member}
            actor={actor}
            mode={acts.capabilities}
            busy={busy !== null}
            pendingCapability={pendingCap}
            onToggle={toggle}
            onReset={resetAllCapabilities}
          />
        </Section>

        {acts.resetPassword || acts.logoutEverywhere ? (
          <Section title={t("members.section_security")}>
            <div className="space-y-2">
              {acts.resetPassword ? (
                <ActionButton
                  icon={KeyRound}
                  title={t("members.act_reset_pw")}
                  hint={t("members.act_reset_pw_hint")}
                  action="reset"
                  busy={busy === "reset"}
                  waiting={busy !== null}
                  onClick={resetPassword}
                />
              ) : null}
              {acts.logoutEverywhere ? (
                <ActionButton
                  icon={LogOut}
                  title={t("members.act_logout")}
                  hint={t("members.act_logout_hint")}
                  action="logout"
                  busy={busy === "logout"}
                  waiting={busy !== null}
                  onClick={endSessions}
                />
              ) : null}
            </div>
          </Section>
        ) : null}

        {acts.reactivate || acts.suspend || acts.offboard ? (
          <Section title={t("members.section_status")}>
            <div className="space-y-2">
              {acts.reactivate ? (
                <ActionButton
                  icon={RotateCcw}
                  title={t("members.act_reactivate")}
                  hint={t("members.act_reactivate_hint")}
                  action="reactivate"
                  busy={busy === "reactivate"}
                  waiting={busy !== null}
                  onClick={reactivate}
                />
              ) : null}
              {acts.suspend ? (
                <ActionButton
                  icon={PauseCircle}
                  tone="danger"
                  title={t("members.act_suspend")}
                  hint={t("members.act_suspend_hint")}
                  action="suspend"
                  waiting={busy !== null}
                  onClick={() => {
                    returnFocus.current = "suspend";
                    setView({ kind: "confirm", action: "suspend" });
                  }}
                />
              ) : null}
              {acts.offboard ? (
                <ActionButton
                  icon={UserMinus}
                  tone="danger"
                  title={t("members.act_offboard")}
                  hint={t("members.act_offboard_hint")}
                  action="offboard"
                  waiting={busy !== null}
                  onClick={() => {
                    returnFocus.current = "offboard";
                    setView({ kind: "confirm", action: "offboard" });
                  }}
                />
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>
    );
  })();

  return (
    <Sheet
      title={member.name}
      onClose={() => {
        if (busy === null) onClose();
      }}
      // a stray tap on the dim area must not throw away unsaved edits (Escape and the X still close it)
      dismissOnBackdrop={busy === null && !secretOnScreen && !dirty}
    >
      {body}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------- small parts

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-sm font-semibold text-fg">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * «إشارة التوثيق» (S5.5): the owner's switch for ONE person. It asks the door for the person's state when the card opens (the roster's `verified` is used when it has one);
 * a refusal (the company's switch is off) draws nothing. Granting and taking back are one tap each, with a toast; the server audits both.
 */
function VerifiedSection({ orgId, member, onPatch, onChanged }: { orgId: string; member: ContractMember; onPatch: (userId: string, patch: Partial<ContractMember>) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const url = `/api/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(member.id)}/verify`;
  const key = ["member-verified", orgId, member.id] as const;
  const query = useQuery({ queryKey: key, queryFn: () => apiGet<{ verified: boolean }>(url), retry: false, refetchOnWindowFocus: false, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const fromRoster = member.verified;
  const verified = query.data?.verified ?? fromRoster;
  // no answer (still asking, or the switch is off): nothing is drawn
  if (verified === undefined) return null;
  // a person who is not active is not given a first badge (the server refuses); the one they have may still be taken back
  if (!verified && member.status !== "ACTIVE") return null;

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ ok: true; verified: boolean }>(url, { verified: next });
      qc.setQueryData(key, { verified: res.verified });
      onPatch(member.id, { verified: res.verified });
      onChanged();
      toast(t(res.verified ? "verified.granted" : "verified.revoked", { name: member.name }), "success");
    } catch (err) {
      const k = err instanceof ApiError && err.messageKey ? err.messageKey : "";
      toast(k && t(k) !== k ? t(k) : t("verified.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t("verified.section")}>
      <div data-verified-section className="space-y-2 rounded-xl border border-border bg-surface p-3">
        <p className="flex items-center gap-1.5 text-sm text-fg">
          {verified ? <VerifiedBadge /> : null}
          {t(verified ? "verified.state_on" : "verified.state_off")}
        </p>
        <p className="text-xs leading-5 text-fg-muted">{t("verified.help")}</p>
        <Button type="button" data-action="verify" variant={verified ? "secondary" : "primary"} aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={() => void change(!verified)} className="h-11 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {t(verified ? "verified.revoke" : "verified.grant")}
        </Button>
      </div>
    </Section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-surface-2 p-3 text-xs leading-6 text-fg-muted">{children}</p>;
}

function ReadOnlyInfo({ member }: { member: ContractMember }) {
  const { t } = useI18n();
  return (
    <dl className="space-y-3 rounded-xl border border-border bg-surface p-3 text-sm">
      {member.managerName ? (
        <div>
          <dt className="text-xs text-muted">{t("members.f_manager")}</dt>
          <dd className="text-fg">{member.managerName}</dd>
        </div>
      ) : null}
      <div>
        <dt className="text-xs text-muted">{t("members.spaces_label")}</dt>
        <dd className="mt-1">
          {member.role === "OWNER" ? (
            <span className="text-fg">{t("members.spaces_all")}</span>
          ) : member.workspaces.length === 0 ? (
            <span className="text-fg-muted">{t("members.spaces_none")}</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {member.workspaces.map((w) => (
                <li key={w.id} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg">
                  {w.name}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );
}

function ActionButton({
  icon: Icon,
  title,
  hint,
  onClick,
  action,
  busy = false,
  waiting = false,
  tone = "normal",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick: () => void;
  /** Names the button so focus can come back to it. */
  action: string;
  /** This action is running: a spinner. */
  busy?: boolean;
  /** Some action is running: this one waits (it stays focusable, a click does nothing). */
  waiting?: boolean;
  tone?: "normal" | "danger";
}) {
  return (
    <button
      type="button"
      data-action={action}
      onClick={() => {
        if (!waiting) onClick();
      }}
      aria-disabled={waiting || undefined}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-h-14 w-full items-start gap-3 rounded-xl border bg-surface px-3 py-3 text-start transition-colors",
        waiting && "cursor-not-allowed opacity-60",
        tone === "danger"
          ? "border-danger/30 text-danger hover:bg-danger/5"
          : "border-border text-fg hover:bg-surface-2",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-5 text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}

/**
 * The ONE confirmation for suspend and offboard: what will happen (⚠️), how to undo it (🔧),
 * and, for an offboarding with open work, the person who receives that work.
 */
function ConfirmBlock({
  title,
  body,
  fix,
  confirmLabel,
  busy,
  disabled,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body: string;
  fix: string;
  confirmLabel: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby={id} className="space-y-4 outline-none">
      <h3 id={id} className="text-base font-semibold text-fg">
        {title}
      </h3>
      <div role="note" className="space-y-1 rounded-lg bg-warn/10 p-3 text-sm leading-6 text-warn">
        <p>{body}</p>
        <p>{fix}</p>
      </div>
      {children}
      {error ? (
        <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            if (!busy) onConfirm();
          }}
          disabled={disabled}
          aria-disabled={busy || undefined}
          className={cn("h-11 sm:flex-1", busy && "cursor-not-allowed opacity-70")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (!busy) onCancel();
          }}
          aria-disabled={busy || undefined}
          className={cn("h-11 sm:flex-1", busy && "cursor-not-allowed opacity-70")}
        >
          {t("members.confirm_cancel")}
        </Button>
      </div>
    </section>
  );
}
