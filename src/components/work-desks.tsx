"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { enumLabel } from "@/lib/i18n/enums";
import { Select } from "@/components/ui/select";
import { DepartmentTickets } from "@/components/department-tickets";
import { DepartmentCampaigns } from "@/components/department-campaigns";
import { TicketDetailModal } from "@/components/ticket-detail-modal";
import { InstantWorkButton } from "@/components/instant-work";
import type { SectionMay } from "@/lib/section-may";

/**
 * «التذاكر» and «الحملات», each a page of its own under «الشغل» (the owner's ask, 2026-10-25), not only a tab inside
 * a department's card:
 *  - on top, the person's own: the tickets they raised or hold («تذاكري»), the campaigns they own («حملاتي»), from
 *    any department — what they asked of a department follows them wherever they are;
 *  - under it, one department's desk (the same component the departments page uses: create, edit, detail), the
 *    department of the space they are in first.
 * Who reads what is decided by the server (src/server/services/tickets.ts, campaigns.ts).
 */

type Department = { id: string; name: string; emoji: string | null; members: { id: string }[] };
/** `may`: this desk's row of the person's grid (tickets on «التذاكر», campaigns on «الحملات»). */
type Me = { id: string; role: string; may?: SectionMay };

const STATUS_CHIP: Record<string, string> = {
  OPEN: "bg-info/10 text-info",
  IN_PROGRESS: "bg-warn/10 text-warn",
  RESOLVED: "bg-ok/10 text-ok",
  CLOSED: "bg-surface-2 text-muted",
  DRAFT: "bg-surface-2 text-muted",
  SCHEDULED: "bg-info/10 text-info",
  RUNNING: "bg-warn/10 text-warn",
  DONE: "bg-ok/10 text-ok",
  CANCELLED: "bg-surface-2 text-muted",
};

/** The departments one may pick, the space's own first; `null` while loading or when the list is not theirs. */
function useDepartments(defaultId: string | null) {
  const list = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiGet<{ departments: Department[] }>("/api/departments"),
    retry: false,
  });
  const [picked, setPicked] = useState("");
  useEffect(() => {
    const rows = list.data?.departments ?? [];
    if (picked || !rows.length) return;
    setPicked(rows.find((d) => d.id === defaultId)?.id ?? rows[0]!.id);
  }, [list.data, defaultId, picked]);
  const rows = list.data?.departments ?? null;
  return { rows, picked: rows?.find((d) => d.id === picked) ?? null, setPicked };
}

function DepartmentPicker({ rows, value, onChange }: { rows: Department[]; value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{t("desk.department")}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-48">
        {rows.map((d) => (
          <option key={d.id} value={d.id}>
            {d.emoji ? `${d.emoji} ` : ""}
            {d.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function TicketsDesk({ me, defaultDepartmentId, openTicketId = null }: { me: Me; defaultDepartmentId: string | null; openTicketId?: string | null }) {
  const { t } = useI18n();
  const manage = me.role === "OWNER" || me.role === "ADMIN";
  // a link to ONE ticket (`?ticket=`) opens its sheet at once
  const [detailId, setDetailId] = useState<string | null>(openTicketId);
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: () =>
      apiGet<{ tickets: { id: string; number: number; title: string; status: string; department: { name: string; emoji: string | null } | null }[] }>("/api/tickets/mine"),
  });
  // every «تذكرة فورية» of the company, for the OWNER and the ADMINs (anybody else has theirs in «تذاكري»)
  const instant = useQuery({
    queryKey: ["tickets", "instant"],
    queryFn: () =>
      apiGet<{ tickets: { id: string; title: string; status: string; assignee: { name: string } | null }[] }>("/api/tickets/instant"),
    enabled: manage,
  });
  const depts = useDepartments(defaultDepartmentId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <h1 className="min-w-0 flex-1 text-[19px] font-bold">{t("nav.tickets")}</h1>
        <InstantWorkButton kind="ticket" onSent={() => qc.invalidateQueries({ queryKey: ["tickets"] })} />
      </div>

      <section aria-labelledby="my-tickets" className="rounded-2xl bg-surface-1 p-4">
        <h2 id="my-tickets" className="mb-2 text-[15px] font-bold">{t("desk.myTickets")}</h2>
        {mine.data && mine.data.tickets.length === 0 && <p className="text-sm text-muted">{t("desk.noMyTickets")}</p>}
        <ul className="divide-y divide-border">
          {(mine.data?.tickets ?? []).map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setDetailId(r.id)} className="flex min-h-11 w-full items-center gap-2 py-2 text-start hover:bg-surface-2">
                <span className="shrink-0 text-xs text-muted">
                  {r.department ? `${r.department.emoji ?? "🏢"} ${r.department.name}` : `⚡ ${t("instant.badge")}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_CHIP[r.status] ?? ""}`}>{enumLabel("TicketStatus", r.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {manage && instant.data && instant.data.tickets.length > 0 ? (
        <section aria-labelledby="instant-tickets" className="rounded-2xl bg-surface-1 p-4">
          <h2 id="instant-tickets" className="mb-2 text-[15px] font-bold">⚡ {t("instant.section")}</h2>
          <ul className="divide-y divide-border">
            {instant.data.tickets.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setDetailId(r.id)} className="flex min-h-11 w-full items-center gap-2 py-2 text-start hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted">{r.assignee?.name ?? "—"}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_CHIP[r.status] ?? ""}`}>{enumLabel("TicketStatus", r.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {depts.rows && depts.rows.length === 0 && <p className="text-sm text-muted">{t("desk.noDepartments")}</p>}
      {depts.rows && depts.picked && (
        <section className="space-y-3">
          <DepartmentPicker rows={depts.rows} value={depts.picked.id} onChange={depts.setPicked} />
          <DepartmentTickets
            key={depts.picked.id}
            deptId={depts.picked.id}
            deptName={depts.picked.name}
            emoji={depts.picked.emoji}
            currentUserId={me.id}
            canAssign={manage || depts.picked.members.some((m) => m.id === me.id)}
            may={me.may}
          />
        </section>
      )}

      {detailId ? <TicketDetailModal ticketId={detailId} currentUserId={me.id} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}

export function CampaignsDesk({ me, defaultDepartmentId }: { me: Me; defaultDepartmentId: string | null }) {
  const { t } = useI18n();
  const manage = me.role === "OWNER" || me.role === "ADMIN";
  const mine = useQuery({
    queryKey: ["campaigns", "mine"],
    queryFn: () =>
      apiGet<{ campaigns: { id: string; title: string; status: string; department: { id: string; name: string; emoji: string | null } }[] }>("/api/campaigns/mine"),
  });
  const depts = useDepartments(defaultDepartmentId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <h1 className="text-[19px] font-bold">{t("nav.campaigns")}</h1>

      <section aria-labelledby="my-campaigns" className="rounded-2xl bg-surface-1 p-4">
        <h2 id="my-campaigns" className="mb-2 text-[15px] font-bold">{t("desk.myCampaigns")}</h2>
        {mine.data && mine.data.campaigns.length === 0 && <p className="text-sm text-muted">{t("desk.noMyCampaigns")}</p>}
        <ul className="divide-y divide-border">
          {(mine.data?.campaigns ?? []).map((r) => (
            <li key={r.id}>
              {/* a campaign opens in its department's desk below */}
              <button type="button" onClick={() => depts.setPicked(r.department.id)} className="flex min-h-11 w-full items-center gap-2 py-2 text-start hover:bg-surface-2">
                <span className="shrink-0 text-xs text-muted">
                  {r.department.emoji ?? "🏢"} {r.department.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_CHIP[r.status] ?? ""}`}>{enumLabel("CampaignStatus", r.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {depts.rows && depts.rows.length === 0 && <p className="text-sm text-muted">{t("desk.noDepartments")}</p>}
      {depts.rows && depts.picked && (
        <section className="space-y-3">
          <DepartmentPicker rows={depts.rows} value={depts.picked.id} onChange={depts.setPicked} />
          <DepartmentCampaigns
            key={depts.picked.id}
            deptId={depts.picked.id}
            deptName={depts.picked.name}
            emoji={depts.picked.emoji}
            currentUserId={me.id}
            canManage={manage || depts.picked.members.some((m) => m.id === me.id)}
            may={me.may}
          />
        </section>
      )}
    </div>
  );
}
