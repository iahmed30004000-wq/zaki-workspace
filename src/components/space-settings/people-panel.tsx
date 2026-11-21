"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Minus } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

interface MemberRow {
  id: string;
  name: string;
  email?: string | null; // absent for an external partner (guest) viewer
  role?: string; // ADMIN | MEMBER | GUEST — absent for a guest viewer
}
interface MembersResponse {
  members: MemberRow[];
  /** The server's verdict: may this person add, remove and promote people here? */
  canManage?: boolean;
}
interface DirectoryPerson {
  userId: string;
  user: { id: string; name: string };
}

function errText(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

/**
 * "أعضاء المساحة" — the people IN this space: list, and (for those who manage it) add, remove, promote. ONE body for two places: the dialog of
 * `WorkspaceMembersButton` (the switch `controlPanelV2` OFF: `onClose` draws its «إلغاء» row) and the tab «الناس» of the space's settings page (A2.2: no `onClose`).
 * A space is visible only to its people and to the owner, so the list holds exactly them: the owner's look is silent, and an ADMIN who is not in the space is not
 * on it. The server decides who may manage (`canManage`) on every request.
 */
export function WorkspaceMembersPanel({ workspaceId, onClose }: { workspaceId: string; onClose?: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const members = useQuery({
    queryKey: ["ws-members", workspaceId],
    queryFn: () => apiGet<MembersResponse>(`/api/workspaces/${workspaceId}/members`),
  });

  // The server says who may manage (the space ADMIN, the owner, an admin who is in it). Everybody else,
  // and a guest (who gets names only), reads the list and sees no controls.
  const canManage = members.data?.canManage === true;

  const directory = useQuery({
    queryKey: ["ws-directory"],
    queryFn: () => apiGet<{ people: DirectoryPerson[] }>("/api/chat/directory"),
    enabled: members.isSuccess && canManage,
  });

  const manage = useMutation({
    mutationFn: (payload: Record<string, string[]>) => apiPost(`/api/workspaces/${workspaceId}/members`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", workspaceId] }),
    onError: (err) => toast(errText(err, t), "error"),
  });

  // A guest viewer gets rows without a role (names only): treat that as "no role", never crash.
  const rows = (members.data?.members ?? []).map((m) => ({ ...m, role: m.role ?? "" }));
  const memberIds = new Set(rows.map((m) => m.id));
  const addable = (directory.data?.people ?? []).filter((p) => !memberIds.has(p.userId));

  return (
    <div className="space-y-3" data-ws-members-panel>
      <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-fg">{m.name}</span>
            {m.role ? (
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                {t(m.role === "ADMIN" ? "ws.role_admin" : m.role === "GUEST" ? "ws.role_guest" : "ws.role_member")}
              </span>
            ) : null}
            {canManage && m.role === "MEMBER" ? (
              <Button size="sm" variant="ghost" aria-label={t("ws.promote")} disabled={manage.isPending} onClick={() => manage.mutate({ promoteUserIds: [m.id] })}>
                <Crown className="size-3.5 text-warn" />
              </Button>
            ) : null}
            {canManage && m.role === "ADMIN" ? (
              <Button size="sm" variant="ghost" aria-label={t("ws.demote")} disabled={manage.isPending} onClick={() => manage.mutate({ demoteUserIds: [m.id] })}>
                <Crown className="size-3.5 text-muted" />
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" variant="ghost" aria-label={t("ws.removeMember")} className="text-danger" disabled={manage.isPending} onClick={() => manage.mutate({ removeUserIds: [m.id] })}>
                <Minus className="size-3.5" />
              </Button>
            ) : null}
          </li>
        ))}
        {members.isLoading ? <li className="px-3 py-3 text-xs text-muted">…</li> : null}
        {members.isSuccess && rows.length === 0 ? <li className="px-3 py-3 text-xs text-muted">{t("spaces.no_people")}</li> : null}
      </ul>
      {canManage ? (
        <div>
          <p className="mb-1 text-xs font-medium text-fg-muted">{t("ws.addMembers")}</p>
          <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {addable.map((p) => (
              <li key={p.userId} className="flex items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  className="text-xs font-medium text-accent hover:underline disabled:opacity-40"
                  disabled={manage.isPending}
                  onClick={() => manage.mutate({ addUserIds: [p.userId] })}
                >
                  + {t("ws.add")}
                </button>
                <span className="truncate text-xs text-muted">{p.user.name}</span>
              </li>
            ))}
            {directory.data && addable.length === 0 ? <li className="px-3 py-2 text-xs text-muted">{t("ws.everyoneIn")}</li> : null}
          </ul>
        </div>
      ) : null}
      {onClose ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
