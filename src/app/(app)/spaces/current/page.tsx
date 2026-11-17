import { pageActor } from "@/app/(app)/_access";
import { Card, CardBody } from "@/components/ui/card";
import { WorkspaceEditButton } from "@/components/workspace-edit-button";
import { WorkspaceMembersButton } from "@/components/workspace-members-button";
import { TaskPrivacyBulkButton } from "@/components/task-privacy-bulk-button";
import { getServerT } from "@/lib/i18n/server";
import { db } from "@/server/db";
import { currentSpace } from "@/server/services/current-space";

export const metadata = { title: getServerT().t("spaces.manage.title") };

function Notice({ text }: { text: string }) {
  return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-fg-muted">{text}</div>;
}

/**
 * «الإدارة» > «المساحة» — «تعديل المساحة» and «أعضاء المساحة» for the space the person is in, moved here from the
 * projects page (the owner's ask, 2026-10-30). Only for whoever manages that space (the owner, its ADMIN, an org ADMIN
 * who is in it: `currentSpace(...).manager`); everybody else, an external partner included, gets a plain notice and
 * no data about the space. The routes behind the buttons (`PATCH /api/workspaces/[id]`, `/members`) refuse them too.
 */
export default async function CurrentSpacePage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (actor.isExternal) return <Notice text={t("spaces.manage.not_yours")} />;
  const space = await currentSpace(actor);
  if (!space) return <Notice text={t("spaces.manage.none")} />;
  if (!space.manager) return <Notice text={t("spaces.manage.not_yours")} />;
  const info = await db.workspace.findUnique({ where: { id: space.id }, select: { name: true, description: true } });
  if (!info) return <Notice text={t("spaces.manage.none")} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header>
        <h1 className="text-xl font-semibold text-fg">
          {t("spaces.manage.title")}
          <span className="text-sm text-fg-muted"> · {info.name}</span>
        </h1>
        <p className="text-sm text-fg-muted">{t("spaces.manage.hint")}</p>
      </header>
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg-muted">{t("spaces.manage.edit_hint")}</p>
          <WorkspaceEditButton workspaceId={space.id} name={info.name} description={info.description} />
        </CardBody>
      </Card>
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg-muted">{t("spaces.manage.members_hint")}</p>
          <WorkspaceMembersButton workspaceId={space.id} />
        </CardBody>
      </Card>
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg-muted">{t("taskpriv.bulk_hint")}</p>
          <TaskPrivacyBulkButton workspaceId={space.id} />
        </CardBody>
      </Card>
    </div>
  );
}

export const dynamic = "force-dynamic";
