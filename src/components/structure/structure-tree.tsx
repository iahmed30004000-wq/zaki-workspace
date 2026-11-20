import Link from "next/link";
import type { ServerT } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtNumber } from "@/lib/format";
import { subtreeOf } from "@/lib/team-development";
import type { Structure, StructureNode } from "@/server/services/team-lines";
import type { ManagerChoice } from "@/components/members/manager-picker";
import { ManagerLine } from "./manager-line";

/**
 * «الهيكل» — the tree. Plain server markup: a node with people under it is a native `<details>` (expandable with no script),
 * and «غيّر المسؤول» is the one client piece (`ManagerLine`, which draws the shared `ManagerPicker`), drawn only for the people
 * the viewer may change (`node.canEdit`: the rank limit of the people screen). Names, job titles and counts: nothing about
 * performance ever appears here. (A1.3: moved here from `team-development/` when the picker became ONE component.)
 */

type Options = (n: StructureNode) => ManagerChoice[];

function childrenMap(nodes: StructureNode[]): Map<string, StructureNode[]> {
  const map = new Map<string, StructureNode[]>();
  for (const n of nodes) {
    if (!n.managerId) continue;
    const list = map.get(n.managerId) ?? [];
    list.push(n);
    map.set(n.managerId, list);
  }
  return map;
}

function Row({ node, t, structure, flag, pickerOptions }: { node: StructureNode; t: ServerT; structure: Structure; flag: boolean; pickerOptions: Options }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2" data-node={node.userId}>
      <span className="min-w-0">
        <Link href={`/development/people/${node.userId}`} className="font-medium text-fg hover:underline">
          {node.name}
        </Link>
        <span className="ms-2 text-xs text-fg-muted">{node.jobTitle ?? enumLabel("OrgRole", node.role)}</span>
      </span>
      {node.direct > 0 ? (
        <span className="rounded-md bg-surface-2 px-1.5 text-xs text-fg-muted" data-reports-count={node.userId}>
          {t("teamdev.tree.reports", { n: fmtNumber(node.total) })}
        </span>
      ) : null}
      {flag ? (
        <span className="rounded-md border border-warn/40 bg-warn/10 px-1.5 text-xs text-warn" data-no-supervisor={node.userId}>
          {t("members.manager_owner")}
        </span>
      ) : null}
      {structure.canManage && node.canEdit ? (
        <span className="ms-auto">
          <ManagerLine userId={node.userId} name={node.name} current={node.managerId} options={pickerOptions(node)} />
        </span>
      ) : null}
    </div>
  );
}

function Branch({ node, kids, t, structure, depth, flagged, pickerOptions }: { node: StructureNode; kids: Map<string, StructureNode[]>; t: ServerT; structure: Structure; depth: number; flagged: Set<string>; pickerOptions: Options }) {
  const below = depth < 8 ? (kids.get(node.userId) ?? []) : [];
  const row = <Row node={node} t={t} structure={structure} flag={flagged.has(node.userId)} pickerOptions={pickerOptions} />;
  if (below.length === 0) return <li className="rounded-lg border border-border bg-surface px-3 py-2">{row}</li>;
  return (
    <li className="rounded-lg border border-border bg-surface">
      <details open={depth < 1}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-fg-muted">▾</span>
          {row}
        </summary>
        <ul className="ms-4 space-y-2 border-s border-border/60 py-2 pe-2 ps-4">
          {below.map((k) => (
            <Branch key={k.userId} node={k} kids={kids} t={t} structure={structure} depth={depth + 1} flagged={flagged} pickerOptions={pickerOptions} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function StructureTree({ structure, t }: { structure: Structure; t: ServerT }) {
  const kids = childrenMap(structure.nodes);
  const byId = new Map(structure.nodes.map((n) => [n.userId, n]));
  const flagged = new Set(structure.unassigned);
  const lines = new Map(structure.nodes.map((n) => [n.userId, n.managerId] as const));
  // who may be picked as somebody's supervisor: not the person, not anybody below them (a loop the server would refuse)
  const pickerOptions: Options = (n) => {
    const below = new Set(subtreeOf(lines, n.userId));
    return structure.nodes.filter((o) => o.userId !== n.userId && !below.has(o.userId)).map((o) => ({ id: o.userId, name: o.name, role: o.role }));
  };
  const roots = structure.roots.map((id) => byId.get(id)).filter((n): n is StructureNode => Boolean(n));
  const loose = structure.unassigned.map((id) => byId.get(id)).filter((n): n is StructureNode => Boolean(n));
  return (
    <div className="space-y-5" data-structure-mode={structure.mode}>
      {roots.length > 0 ? (
        <section aria-label={t("teamdev.tree.top")}>
          <ul className="space-y-2">
            {roots.map((n) => (
              <Branch key={n.userId} node={n} kids={kids} t={t} structure={structure} depth={0} flagged={flagged} pickerOptions={pickerOptions} />
            ))}
          </ul>
        </section>
      ) : null}
      {loose.length > 0 ? (
        <section aria-label={t("teamdev.tree.unassigned")} className="space-y-2" data-unassigned>
          <h2 className="text-sm font-semibold text-warn">
            ⚠️ {t("teamdev.tree.unassigned")} <span className="font-normal text-fg-muted">({fmtNumber(loose.length)})</span>
          </h2>
          <p className="text-xs leading-5 text-fg-muted">🔧 {t("teamdev.tree.unassigned_fix")}</p>
          <ul className="space-y-2">
            {loose.map((n) => (
              <Branch key={n.userId} node={n} kids={kids} t={t} structure={structure} depth={1} flagged={flagged} pickerOptions={pickerOptions} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
