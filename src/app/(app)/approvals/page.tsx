import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { EmptyState } from "@/components/ui/card";
import { RequestCard } from "@/components/approvals/request-card";
import { RequestForm } from "@/components/approvals/request-form";
import { FormPicker } from "@/components/approvals/form-picker";
import { FillBridge } from "@/components/approvals/fill-bridge";
import { LINK_KINDS, viewOf, type LinkKind } from "@/lib/approvals/shared";
import { currentSpace } from "@/server/services/current-space";
import { approvalsOn, eligibleApprovers } from "@/server/services/approval-access";
import { getForm, listForms } from "@/server/services/approval-forms";
import { listApprovals, waitingCount, workSpacesOf } from "@/server/services/approvals";
import { NotFoundError } from "@/server/auth";

/**
 * «الموافقات» — /approvals. Three lists: «طلباتي» (what I asked), «بانتظاري» (the requests whose turn is mine now) and «كل الطلبات»
 * (the OWNER reads every request of the company, silently; a space ADMIN those of the spaces they manage). The same page opens the
 * new-request form (`?new=1`, optionally `&link=TASK:<id>` when it is about a task, a card or a message) and a form to fill
 * (`?fill=<form>`). A guest is refused, the switch off is «not found». An approval only records a decision: it never moves money.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "approvals")) return <GuestNotice />;
  if (!(await approvalsOn(actor.orgId))) notFound();
  const { t } = getServerT();
  const one = (key: string) => {
    const value = searchParams?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const space = await currentSpace(actor);
  const frame = (children: React.ReactNode) => (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("approvals.title")}</h1>
        <p className="text-sm text-muted">{t("approvals.subtitle")}</p>
      </header>
      {children}
    </div>
  );
  if (!space) return frame(<EmptyState title={t("approvals.no_space")} />);

  // a new request, or a form to fill: the people who may be asked are the ones who work in this space
  const wantsNew = one("new") === "1";
  const fillId = one("fill");
  if (wantsNew || fillId) {
    const people = (await eligibleApprovers(actor.orgId, space.id)).filter((p) => p.id !== actor.userId);
    if (fillId) {
      const form = await getForm(actor, fillId).catch((err: unknown) => {
        if (err instanceof NotFoundError) notFound();
        throw err;
      });
      if (form.workspaceId !== space.id || form.archived) notFound();
      return frame(
        <section className="space-y-3" data-approvals-fill>
          <h2 className="text-lg font-semibold text-fg">{form.name}</h2>
          {form.description ? <p className="text-sm text-fg-muted">{form.description}</p> : null}
          <p className="text-xs text-fg-muted">
            {t("approvals.fill.chain", { names: form.approvers.map((a) => a.name).join(" ← ") })}
          </p>
          {form.approverProblem ? (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg" role="status">
              <span className="block font-medium">{t("approvals.forms.problem")}</span>
              <span className="block text-fg-muted">{t("approvals.forms.problem_fix")}</span>
            </p>
          ) : null}
          <FillBridge familyId={form.familyId} schema={form.schema} />
        </section>,
      );
    }
    const link = parseLink(one("link"));
    const forms = (await listForms(actor, space.id)).filter((f) => !f.archived);
    return frame(
      <div className="space-y-5">
        <section className="space-y-3" data-approvals-new>
          <h2 className="text-lg font-semibold text-fg">{t("approvals.new.title")}</h2>
          <RequestForm workspaceId={space.id} people={people} mode="create" link={link} />
        </section>
        {forms.length > 0 ? <FormPicker forms={forms.map((f) => ({ id: f.familyId, name: f.name, description: f.description }))} /> : null}
      </div>,
    );
  }

  const spaces = await workSpacesOf(actor);
  const canAll = actor.isOwner || spaces.some((s) => s.manager);
  const requested = viewOf(one("v"));
  const view = requested === "all" && !canAll ? "mine" : requested;
  // the company-wide list is the owner's; «طلباتي» and «بانتظاري» are the space the person is in (inside «الشركة», the view over all of them: every space)
  const narrowTo = space.kind === "HQ" ? null : space.id;
  const [items, waiting] = await Promise.all([
    listApprovals(actor, { view, workspaceId: view === "all" ? null : narrowTo }),
    // B4: the number on the tab counts the list it heads
    waitingCount(actor, { workspaceId: narrowTo }),
  ]);
  const tabs = [
    { key: "mine", label: t("approvals.view.mine") },
    { key: "waiting", label: waiting > 0 ? `${t("approvals.view.waiting")} (${waiting})` : t("approvals.view.waiting") },
    ...(canAll ? [{ key: "all", label: t("approvals.view.all") }] : []),
  ] as const;
  return frame(
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("approvals.title")} className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`/approvals?v=${tab.key}`}
              aria-current={tab.key === view ? "page" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm ${tab.key === view ? "border-accent/60 bg-accent/10 font-medium text-fg" : "border-border text-fg-muted hover:bg-surface-2"}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Link href="/approvals?new=1" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:min-h-9">
            {t("approvals.new")}
          </Link>
          <Link href="/approvals/forms" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-fg hover:bg-surface-2 md:min-h-9">
            {t("approvals.forms")}
          </Link>
        </div>
      </div>
      {view === "all" ? (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted" data-approvals-oversight>
          {t(actor.isOwner ? "approvals.all.owner_hint" : "approvals.all.admin_hint")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title={t(`approvals.empty.${view}.title`)} hint={t(`approvals.empty.${view}.hint`)} action={view === "mine" ? { label: t("approvals.new"), href: "/approvals?new=1" } : undefined} />
      ) : (
        <ul className="space-y-2" data-approvals-list={view}>
          {items.map((item) => (
            <RequestCard key={item.id} item={item} showSpace={view === "all"} />
          ))}
        </ul>
      )}
    </>,
  );
}

/** `?link=TASK:<id>`: the thing the new request is about; anything else is no link. */
function parseLink(raw: string | undefined): { kind: LinkKind; id: string } | null {
  if (!raw) return null;
  const [kind, id] = raw.split(":");
  if (!kind || !id || id.length > 64 || !(LINK_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as LinkKind, id };
}

export const dynamic = "force-dynamic";
