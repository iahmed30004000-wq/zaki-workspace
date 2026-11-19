"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2, UsersRound } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  /** The «قائد الفرقة»: one of the team's own people (Team.leadId), or nobody. */
  leadId: string | null;
  members: { id: string; name: string }[];
  projects: number;
  mine: boolean;
}
interface TeamsResponse {
  teams: TeamRow[];
  canManage: boolean;
}
interface SpacePerson {
  id: string;
  name: string;
}

function errText(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

/**
 * «المقاطع» — the teams inside this space (the owner's decision, 2026-10-25: each team its own projects and
 * topics; src/server/services/team-scope.ts says who sees what). A manager of the space opens teams, puts the
 * space's people in and out, and deletes an empty team; anybody else sees the teams they are in, read-only.
 * The server decides everything again (src/server/services/teams.ts).
 */
export function WorkspaceTeamsButton({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const teams = useQuery({
    queryKey: ["ws-teams", workspaceId],
    queryFn: () => apiGet<TeamsResponse>(`/api/workspaces/${workspaceId}/teams`),
    enabled: open,
  });
  const canManage = teams.data?.canManage === true;
  // the people a team may hold: the space's own
  const people = useQuery({
    queryKey: ["ws-members", workspaceId],
    queryFn: () => apiGet<{ members: SpacePerson[] }>(`/api/workspaces/${workspaceId}/members`),
    enabled: open && canManage,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["ws-teams", workspaceId] });
  };
  const create = useMutation({
    mutationFn: (teamName: string) => apiPost(`/api/workspaces/${workspaceId}/teams`, { name: teamName }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const members = useMutation({
    mutationFn: ({ teamId, add, remove }: { teamId: string; add?: string[]; remove?: string[] }) =>
      apiPost(`/api/workspaces/${workspaceId}/teams/${teamId}/members`, { add, remove }),
    onSuccess: refresh,
    onError: (err) => toast(errText(err, t), "error"),
  });
  // «قائد الفرقة»: written through the teams door (PATCH leadId), which refuses somebody who is not in the team or not active
  const lead = useMutation({
    mutationFn: ({ teamId, leadId }: { teamId: string; leadId: string | null }) => apiPatch(`/api/workspaces/${workspaceId}/teams/${teamId}`, { leadId }),
    onSuccess: () => {
      refresh();
      toast(t("teamlead.saved"), "success");
    },
    onError: (err) => {
      refresh();
      toast(errText(err, t), "error");
    },
  });
  const remove = useMutation({
    mutationFn: (teamId: string) => apiDelete(`/api/workspaces/${workspaceId}/teams/${teamId}`),
    onSuccess: refresh,
    onError: (err) => toast(errText(err, t), "error"),
  });
  const busy = create.isPending || members.isPending || remove.isPending || lead.isPending;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  const rows = teams.data?.teams ?? [];
  const spacePeople = people.data?.members ?? [];

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UsersRound className="size-4 text-accent" />
        {t("spaceteams.title")}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("spaceteams.title")}>
          <div className="space-y-4">
            <p className="text-xs leading-5 text-fg-muted">{t("spaceteams.hint")}</p>
            {canManage ? <p className="text-xs leading-5 text-muted">{t("teamlead.hint")}</p> : null}
            {teams.isLoading ? <p className="text-xs text-muted">…</p> : null}
            {teams.isSuccess && rows.length === 0 ? <p className="text-sm text-fg-muted">{t("spaceteams.none")}</p> : null}
            <ul className="space-y-3">
              {rows.map((team) => {
                const inTeam = new Set(team.members.map((m) => m.id));
                const addable = spacePeople.filter((p) => !inTeam.has(p.id));
                return (
                  <li key={team.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                        <bdi>{team.name}</bdi>
                      </span>
                      <span className="shrink-0 text-xs text-fg-muted">{t("spaceteams.projects_count", { n: team.projects })}</span>
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("spaceteams.delete", { name: team.name })}
                          className="text-danger"
                          disabled={busy}
                          onClick={() => remove.mutate(team.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {team.members.map((m) => (
                        <li key={m.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg">
                          <bdi>{m.name}</bdi>
                          {canManage ? (
                            <button
                              type="button"
                              aria-label={t("spaceteams.remove_member", { name: m.name })}
                              className="grid size-5 place-items-center rounded-full text-fg-muted hover:text-danger disabled:opacity-40"
                              disabled={busy}
                              onClick={() => members.mutate({ teamId: team.id, remove: [m.id] })}
                            >
                              <Minus className="size-3" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                      {team.members.length === 0 ? <li className="text-xs text-fg-muted">{t("spaceteams.no_members")}</li> : null}
                    </ul>
                    {team.members.length > 0 && (canManage || team.leadId) ? (
                      <div className="mt-2 flex items-center gap-2">
                        <label htmlFor={`team-lead-${team.id}`} className="shrink-0 text-xs text-fg-muted">
                          {t("teamlead.label")}
                        </label>
                        {canManage ? (
                          <Select
                            id={`team-lead-${team.id}`}
                            value={team.leadId ?? ""}
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.value || null;
                              if (next !== team.leadId) lead.mutate({ teamId: team.id, leadId: next });
                            }}
                            className="min-w-0 flex-1"
                          >
                            <option value="">{t("teamlead.none")}</option>
                            {team.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span id={`team-lead-${team.id}`} className="min-w-0 flex-1 truncate text-xs text-fg">
                            <bdi>{team.members.find((m) => m.id === team.leadId)?.name ?? t("teamlead.none")}</bdi>
                          </span>
                        )}
                      </div>
                    ) : null}
                    {canManage && addable.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {addable.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-muted px-2.5 text-xs text-accent hover:bg-surface-2 disabled:opacity-40"
                            disabled={busy}
                            onClick={() => members.mutate({ teamId: team.id, add: [p.id] })}
                          >
                            <Plus className="size-3" />
                            <bdi>{p.name}</bdi>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {canManage ? (
              <form onSubmit={submit} className="flex gap-2">
                <label className="sr-only" htmlFor={`team-name-${workspaceId}`}>
                  {t("spaceteams.new_name")}
                </label>
                <input
                  id={`team-name-${workspaceId}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder={t("spaceteams.new_name")}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-muted bg-surface px-3 text-sm text-fg"
                />
                <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                  <Plus className="size-4" />
                  {t("spaceteams.create")}
                </Button>
              </form>
            ) : null}
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
