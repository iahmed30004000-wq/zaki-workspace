"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { ApiError, apiGet, apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { MAX_ROLE_TEMPLATES, TEMPLATE_NAME_MAX, TEMPLATE_RANKS, type RoleTemplate } from "@/lib/permission-templates";
import { isOn, isRankDefault, offeredFor, withBox, withRank, type TemplateRank } from "./model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * «قوالب الصلاحيات» — the OWNER's editor of the company's templates (A1.1 built the data, the seven starters and the door; this is the screen). A template is a rank plus
 * the boxes it adds (`caps`) and the boxes it takes away (`revoked`); here each one is a plain list of «يقدر يعمل كذا» switches for that rank: a box the rank gives is ON
 * unless the template takes it away, a box the rank does not give is OFF unless the template adds it. Saving sends the WHOLE list with the `rev` it was made from
 * (`PUT /api/organizations/[id]/role-templates`): another owner's save made meanwhile is a 409 and nothing is lost silently; the server judges every rule again (a guest
 * template, `archive.view`, a repeated name, more than 30). Only what the screen should OFFER is decided here (`offeredFor`): the boxes of `WIRED_CAPABILITIES` that a rank may hold.
 *
 * ⚠️ A template changes a person's rank and every box at once when it is applied. 🔧 The editor says so; applying one is from a person's sheet and shows the result there.
 */

interface TemplatesResponse {
  templates: RoleTemplate[];
  rev: string;
  canEdit: boolean;
}

type Rank = TemplateRank;

const newId = () => `tpl-${Math.random().toString(16).slice(2, 12)}`;

const errorText = (t: (key: string) => string, err: unknown): string => {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details) ? (err.details as { message?: string }[]) : [];
    for (const d of details) if (d.message && t(d.message) !== d.message) return t(d.message);
    if (err.messageKey && t(err.messageKey) !== err.messageKey) return t(err.messageKey);
  }
  return t("common.error");
};

export function TemplatesEditor({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const path = `/api/organizations/${encodeURIComponent(orgId)}/role-templates`;
  const query = useQuery({ queryKey: ["role-templates-editor", orgId], queryFn: () => apiGet<TemplatesResponse>(path), retry: false, refetchOnWindowFocus: false });
  const [drafts, setDrafts] = useState<RoleTemplate[] | null>(null);
  const [rev, setRev] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && drafts === null) {
      setDrafts(query.data.templates);
      setRev(query.data.rev);
    }
  }, [query.data, drafts]);

  const dirty = useMemo(() => drafts !== null && query.data !== undefined && JSON.stringify(drafts) !== JSON.stringify(query.data.templates), [drafts, query.data]);
  const label = (c: string): string => {
    const own = t(`members.cap.${c}.title`);
    if (own !== `members.cap.${c}.title`) return own;
    const [section, action] = c.split(".");
    return `${t(`members.section.${section}`)}: ${t(`members.action.${action}`)}`;
  };

  if (query.isLoading) {
    return (
      <section className="rounded-card border border-border bg-surface-1 p-4" data-templates-editor aria-busy="true">
        <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-muted" />
      </section>
    );
  }
  if (query.isError || !query.data || drafts === null) {
    return (
      <section className="rounded-card border border-border bg-surface-1 p-4 text-sm" data-templates-editor>
        <h3 className="font-semibold">{t("cpv2.templates.title")}</h3>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{query.isError ? errorText(t, query.error) : t("common.error")}</p>
      </section>
    );
  }

  const patch = (id: string, next: (template: RoleTemplate) => RoleTemplate) => setDrafts((list) => (list ?? []).map((x) => (x.id === id ? next(x) : x)));

  async function save() {
    if (busy || drafts === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await apiPut<TemplatesResponse>(path, { templates: drafts, rev });
      setDrafts(saved.templates);
      setRev(saved.rev);
      await query.refetch();
      toast(t("cpv2.templates.saved"), "success");
    } catch (err) {
      setMessage(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-card border border-border bg-surface-1 p-4 shadow-card" data-templates-editor aria-labelledby="cp-templates-title">
      <header>
        <h3 id="cp-templates-title" className="text-sm font-semibold">
          {t("cpv2.templates.title")}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t("cpv2.templates.intro")}</p>
      </header>
      <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
        <p className="text-fg">{t("ptemplates.warn")}</p>
        <p className="mt-0.5 text-fg-muted">{t("ptemplates.fix")}</p>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="templates-list">
        {drafts.map((template) => {
          const rank = template.rank as Rank;
          const expanded = open === template.id;
          return (
            <li key={template.id} className="p-3" data-template={template.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t("cpv2.templates.name")}
                  value={template.name}
                  maxLength={TEMPLATE_NAME_MAX}
                  onChange={(e) => patch(template.id, (x) => ({ ...x, name: e.target.value }))}
                  className="h-11 min-w-0 flex-1 md:h-9"
                />
                <Select
                  aria-label={t("cpv2.templates.rank")}
                  value={rank}
                  onChange={(e) => patch(template.id, (x) => withRank(x, e.target.value as Rank))}
                  className="w-auto"
                >
                  {TEMPLATE_RANKS.map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_KEYS[r] ?? "role.member")}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(expanded ? null : template.id)} aria-expanded={expanded}>
                  {t(expanded ? "cpv2.templates.hide" : "cpv2.templates.boxes", { n: template.caps.length + template.revoked.length })}
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={t("cpv2.templates.delete")} onClick={() => setDrafts((list) => (list ?? []).filter((x) => x.id !== template.id))}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
              {expanded ? (
                <ul className="mt-3 grid gap-1 sm:grid-cols-2" data-testid="template-boxes">
                  {offeredFor(rank).map((c) => (
                    <li key={c}>
                      <label className={cn("flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm md:min-h-9", isOn(template, c) ? "" : "text-fg-muted")}>
                        <input type="checkbox" className="size-4" checked={isOn(template, c)} onChange={(e) => patch(template.id, (x) => withBox(x, c, e.target.checked))} />
                        <span>{label(c)}</span>
                        {isRankDefault(rank, c) ? null : <span className="text-xs text-fg-muted">{t("cpv2.templates.extra")}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {drafts.length === 0 ? <li className="p-3 text-sm text-fg-muted">{t("cpv2.templates.empty")}</li> : null}
      </ul>

      {message ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || drafts.length >= MAX_ROLE_TEMPLATES}
          onClick={() => {
            const id = newId();
            setDrafts((list) => [...(list ?? []), { id, name: t("cpv2.templates.new_name", { n: (list ?? []).length + 1 }), rank: "MEMBER", caps: [], revoked: [] }]);
            setOpen(id);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("cpv2.templates.add")}
        </Button>
        <Button type="button" size="sm" disabled={busy || !dirty} onClick={() => void save()} data-testid="templates-save">
          {busy ? t("cpv2.templates.saving") : t("cpv2.templates.save")}
        </Button>
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts(query.data.templates)}>
            {t("cpv2.templates.revert")}
          </Button>
        ) : null}
        <span className="text-xs text-fg-muted">{t("cpv2.templates.count", { n: drafts.length, max: MAX_ROLE_TEMPLATES })}</span>
      </div>
    </section>
  );
}
