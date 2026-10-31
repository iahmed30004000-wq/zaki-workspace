"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowBigUp, Rocket, Trash2, ExternalLink, Share2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { enumLabel } from "@/lib/i18n/enums";
import { cn } from "@/lib/utils";

import Link from "next/link";
export interface IdeaItem {
  id: string;
  title: string;
  description: string | null;
  status: "NEW" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "PLANNING" | "LAUNCHED";
  taskId: string | null;
  creatorId: string;
  creatorName: string;
  creatorJobTitle: string | null;
  voteCount: number;
  votedByMe: boolean;
  /** The space it was born in (null: from before spaces had ideas). */
  workspaceId?: string | null;
  spaceName?: string | null;
  /** Shared with the company («شارك مع الشركة»). */
  shared?: boolean;
  /** «الباب»: set when another system sent it in (the name of the token); the author line then says so. */
  source?: string | null;
}

export interface IdeasCtx {
  userId: string;
  orgRole: string;
  /** Moves the ideas of this space along (its managers; in «الشركة» the owner and the admins). */
  canManage: boolean;
  /** The ideas boxes of the person's grid: «يضيف ويعدّل» and «يحذف» (absent: allowed, the server decides again). */
  mayEdit?: boolean;
  mayDelete?: boolean;
  /** The space the person is in, and whether it is «الشركة». */
  spaceId?: string | null;
  isHq?: boolean;
}

interface WorkspacesResponse {
  organizations: { id: string; name: string; workspaces: { id: string; name: string }[] }[];
}

/** The road of an idea (src/server/services/ideas.ts decides again): فكرة → مراجعة → تخطيط → انطلقت, or مرفوضة. */
const NEXT_STATUS: Record<IdeaItem["status"], IdeaItem["status"][]> = {
  NEW: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["PLANNING", "REJECTED"],
  PLANNING: ["LAUNCHED", "UNDER_REVIEW"],
  REJECTED: ["UNDER_REVIEW"],
  ACCEPTED: ["PLANNING", "LAUNCHED"],
  LAUNCHED: [],
};

/**
 * The server names a refusal "idea.<reason>" (sometimes "idea.<reason>:detail"); the dictionary writes
 * it "ideas.<reason>". Anything it has no sentence for is the general error, never a raw key.
 */
export function ideaError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    const reason = err.messageKey?.replace(/^idea\./, "").split(":")[0];
    if (reason) {
      const key = `ideas.${reason}`;
      const text = t(key);
      if (text !== key) return text;
    }
    if (err.code === "forbidden") return t("forbidden");
  }
  return t("common.error");
}

const FILTERS: (IdeaItem["status"] | "ALL" | "MINE" | "SHARED")[] = [
  "ALL", "NEW", "UNDER_REVIEW", "PLANNING", "LAUNCHED", "REJECTED", "SHARED", "MINE",
];

const STATUS_STYLE: Record<IdeaItem["status"], string> = {
  NEW: "bg-surface-2 text-fg-muted",
  UNDER_REVIEW: "bg-warn/10 text-warn",
  PLANNING: "bg-info/10 text-info",
  LAUNCHED: "bg-ok/10 text-ok",
  ACCEPTED: "bg-ok/10 text-ok",
  REJECTED: "bg-danger/10 text-danger",
};

export function IdeasView({ initial, ctx }: { initial: IdeaItem[]; ctx: IdeasCtx }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [ideas, setIdeas] = useState<IdeaItem[]>(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [converting, setConverting] = useState<IdeaItem | null>(null);

  const canWrite = ctx.orgRole !== "GUEST" && ctx.mayEdit !== false;

  const shown = useMemo(
    () =>
      ideas.filter((i) =>
        filter === "ALL" ? true : filter === "MINE" ? i.creatorId === ctx.userId : filter === "SHARED" ? i.shared === true : i.status === filter,
      ),
    [ideas, filter, ctx.userId],
  );

  async function createIdea(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const res = await apiPost<{ idea: IdeaItem }>("/api/ideas", {
        title: title.trim(),
        description: desc.trim() || null,
      });
      setIdeas((prev) => [res.idea, ...prev]);
      setTitle("");
      setDesc("");
      toast(t("ideas.created"), "success");
    } catch (err) {
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error"), "error");
    }
  }

  async function vote(idea: IdeaItem) {
    const previous = ideas;
    setIdeas((prev) =>
      prev.map((i) =>
        i.id === idea.id
          ? { ...i, voteCount: i.voteCount + (i.votedByMe ? -1 : 1), votedByMe: !i.votedByMe }
          : i,
      ),
    );
    try {
      await apiPost(`/api/ideas/${idea.id}/vote`);
    } catch (err) {
      setIdeas(previous); // rollback
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error"), "error");
    }
  }

  async function setStatus(idea: IdeaItem, status: IdeaItem["status"]) {
    try {
      const res = await apiPatch<{ idea: IdeaItem }>(`/api/ideas/${idea.id}`, { status });
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? res.idea : i)));
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      toast(ideaError(err, t), "error");
    }
  }

  async function share(idea: IdeaItem, shared: boolean) {
    try {
      const res = await apiPost<{ idea: IdeaItem }>(`/api/ideas/${idea.id}/share`, { shared });
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? res.idea : i)));
      toast(t(shared ? "ideas.sharedToast" : "ideas.unsharedToast"), "success");
    } catch (err) {
      toast(ideaError(err, t), "error");
    }
  }

  async function removeIdea(idea: IdeaItem) {
    if (!window.confirm(t("ideas.deleteConfirm"))) return;
    try {
      await apiDelete(`/api/ideas/${idea.id}`);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      toast(t("ideas.deleted"), "success");
    } catch (err) {
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error"), "error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("ideas.title")}</h1>
        <p className="text-xs text-fg-muted">{t(ctx.isHq ? "ideas.subtitle_hq" : ctx.spaceId ? "ideas.subtitle_space" : "ideas.subtitle")}</p>
      </header>

      {canWrite ? (
        <form onSubmit={createIdea} className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            placeholder={t("ideas.titlePlaceholder")}
            aria-label={t("ideas.titlePlaceholder")}
          />
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t("ideas.descPlaceholder")}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={title.trim().length < 3}>
              {t("ideas.add")}
            </Button>
          </div>
        </form>
      ) : null}

      <nav className="flex flex-wrap gap-1.5" aria-label={t("ideas.title")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-current={filter === f ? "true" : undefined}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs transition-colors",
              filter === f
                ? "bg-accent text-accent-fg"
                : "bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            {t(`ideas.filter.${String(f).toLowerCase()}`)}
          </button>
        ))}
      </nav>

      <ul className="space-y-3">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{t("ideas.empty")}</p>
        ) : null}
        {shown.map((idea) => {
          const canEdit = canWrite && (idea.creatorId === ctx.userId || ctx.canManage);
          const canConvert =
            canWrite &&
            !idea.taskId &&
            idea.status !== "REJECTED" &&
            (idea.creatorId === ctx.userId || ctx.canManage);
          const nexts = ctx.canManage && canWrite ? NEXT_STATUS[idea.status] : [];
          return (
            <li key={idea.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => vote(idea)}
                  aria-pressed={idea.votedByMe}
                  title={canWrite ? t("ideas.vote") : t("forbidden")}
                  className={cn(
                    "flex h-14 w-11 shrink-0 flex-col items-center justify-center gap-0 rounded-lg border text-xs",
                    idea.votedByMe
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-fg-muted hover:border-accent/50",
                    !canWrite && "opacity-40",
                  )}
                >
                  <ArrowBigUp className="h-4 w-4" />
                  <span className="font-bold">{idea.voteCount}</span>
                </button>

                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-fg">{idea.title}</h3>
                  {idea.description ? (
                    <p className="mt-1 line-clamp-3 text-xs text-fg-muted">{idea.description}</p>
                  ) : null}
                  <p className="mt-1.5 text-xs text-muted">
                    {idea.creatorName}
                    {idea.creatorJobTitle ? ` · ${idea.creatorJobTitle}` : ""}
                    {/* in «الشركة», a shared idea says which space it comes from */}
                    {ctx.isHq && idea.shared && idea.spaceName && idea.workspaceId !== ctx.spaceId ? (
                      <span className="ms-1">· <bdi>{t("ideas.from_space", { space: idea.spaceName })}</bdi></span>
                    ) : null}
                    {idea.source ? (
                      <span className="ms-1 rounded-full bg-cat-3/10 px-1.5 py-0.5 text-cat-3"><bdi>{t("door.idea_source", { name: idea.source })}</bdi></span>
                    ) : null}
                    {idea.shared && !ctx.isHq ? (
                      <span className="ms-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-accent">{t("ideas.shared")}</span>
                    ) : null}
                    {idea.taskId ? (
                      <Link href={`/tasks/${idea.taskId}`} className="ms-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                        <ExternalLink className="h-2.5 w-2.5" />
                        {t("ideas.converted")}
                      </Link>
                    ) : null}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[idea.status])}>
                    {enumLabel("IdeaStatus", idea.status)}
                  </span>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      {/* «شارك مع الشركة»: an idea of a space (one with no space is the company's already) */}
                      {idea.workspaceId && !(ctx.isHq && idea.workspaceId === ctx.spaceId) ? (
                        <button
                          type="button"
                          onClick={() => share(idea, !idea.shared)}
                          aria-pressed={idea.shared === true}
                          aria-label={t(idea.shared ? "ideas.unshare" : "ideas.share")}
                          title={t(idea.shared ? "ideas.unshare" : "ideas.share")}
                          className={cn("rounded p-1 hover:bg-surface-2", idea.shared ? "text-accent" : "text-muted hover:text-accent")}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {canConvert ? (
                        <button
                          type="button"
                          onClick={() => setConverting(idea)}
                          aria-label={t("ideas.convert")}
                          title={t("ideas.convert")}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-accent"
                        >
                          <Rocket className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {ctx.mayDelete !== false ? (
                        <button
                          type="button"
                          onClick={() => removeIdea(idea)}
                          aria-label={t("common.delete")}
                          title={t("common.delete")}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {nexts.length > 0 ? (
                    <Select
                      aria-label={t("ideas.setStatus")}
                      value={idea.status}
                      className="!h-7 w-28 text-xs"
                      onChange={(e) => {
                        const target = e.target.value as IdeaItem["status"];
                        if (target !== idea.status) setStatus(idea, target);
                      }}
                    >
                      <option value={idea.status}>{enumLabel("IdeaStatus", idea.status)}</option>
                      {nexts.map((s) => (
                        <option key={s} value={s}>
                          {enumLabel("IdeaStatus", s)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {converting ? (
        <ConvertModal
          idea={converting}
          onClose={() => setConverting(null)}
          onDone={(taskId) => {
            setIdeas((prev) =>
              prev.map((i) => (i.id === converting.id ? { ...i, status: i.status === "LAUNCHED" ? "LAUNCHED" : "PLANNING", taskId } : i)),
            );
            setConverting(null);
            toast(t("ideas.convertedToast"), "success");
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface ProjectsResponse {
  projects: { id: string; name: string }[];
}
interface BoardsResponse {
  boards: { id: string; name: string }[];
}

function ConvertModal({
  idea,
  onClose,
  onDone,
}: {
  idea: IdeaItem;
  onClose: () => void;
  onDone: (taskId: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [busy, setBusy] = useState(false);

  const wsQuery = useQuery({
    queryKey: ["orgs"],
    queryFn: () => apiGet<WorkspacesResponse>("/api/workspaces"),
  });
  const workspaces = useMemo(
    () => wsQuery.data?.organizations.flatMap((o) => o.workspaces) ?? [],
    [wsQuery.data],
  );

  const projectsQuery = useQuery({
    queryKey: ["convert-projects", workspaceId],
    queryFn: () => apiGet<ProjectsResponse>(`/api/projects?workspaceId=${workspaceId}`),
    enabled: workspaceId !== "",
  });
  const boardsQuery = useQuery({
    queryKey: ["convert-boards", projectId],
    queryFn: () => apiGet<BoardsResponse>(`/api/projects/${projectId}/boards`),
    enabled: projectId !== "",
  });

  async function submit() {
    if (!workspaceId || !projectId || !boardId) return;
    setBusy(true);
    try {
      const res = await apiPost<{ taskId: string }>(`/api/ideas/${idea.id}/convert`, {
        workspaceId,
        projectId,
        boardId,
      });
      onDone(res.taskId);
    } catch (err) {
      toast(ideaError(err, t), "error");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("ideas.convertTo")}>
      <div className="space-y-3">
        <div>
          <Label>{t("ws.one")}</Label>
          <Select value={workspaceId} onChange={(e) => { setWorkspaceId(e.target.value); setProjectId(""); setBoardId(""); }}>
            <option value="">—</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("proj.one")}</Label>
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setBoardId(""); }} disabled={!workspaceId}>
            <option value="">—</option>
            {(projectsQuery.data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("board.one")}</Label>
          <Select value={boardId} onChange={(e) => setBoardId(e.target.value)} disabled={!projectId}>
            <option value="">—</option>
            {(boardsQuery.data?.boards ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted">{t("ideas.convertHint")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("task.cancel")}
          </Button>
          <Button onClick={submit} disabled={!boardId || busy}>
            {t("ideas.convert")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
