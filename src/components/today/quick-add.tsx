"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { quickInboxBody, quickTaskBody, QUICK_DESCRIPTION_MAX, TASK_TITLE_MAX, WORK_INBOX_REF, type QuickDue, type TodayQuickAddData, type WorkInboxInfo } from "@/lib/today";
import { cn } from "@/lib/utils";
import { useNewIntent } from "@/lib/nav/use-new-intent";

type Post = (path: string, body?: unknown) => Promise<unknown>;

/** The words for a refusal: the server's own reason when it is one of the instant-work ones («لسا ما إلك مساحة شغل»), else the usual ones. */
function quickError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError && err.messageKey?.startsWith("instant.")) {
    const said = t(err.messageKey);
    if (said !== err.messageKey) return said;
  }
  return err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("task.createFailed");
}

/**
 * Where a quick task goes (W1.2, switch `workInbox`): the answer of `GET /api/instant`. `undefined` is "not asked yet, ask"; null is
 * "off" (the old behaviour: the first project with a board). A test passes it as a prop, so nothing is fetched there.
 */
function useWorkInbox(given: WorkInboxInfo | null | undefined): { inbox: WorkInboxInfo | null; known: boolean } {
  const [fetched, setFetched] = useState<{ inbox: WorkInboxInfo | null } | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    // a failed answer is "off": the quick add keeps working the old way rather than not at all
    apiGet<{ inbox?: WorkInboxInfo | null }>("/api/instant").then(
      (data) => live && setFetched({ inbox: data.inbox ?? null }),
      () => live && setFetched({ inbox: null }),
    );
    return () => {
      live = false;
    };
  }, [given]);
  // `known` is false only while the answer is on its way: nothing is sent then (a task typed in that moment would miss the inbox)
  return given === undefined ? { inbox: fetched?.inbox ?? null, known: fetched !== null } : { inbox: given, known: true };
}

/**
 * «إضافة سريعة» at the foot of «مهمّاتي اليوم» («نجمة وطريق»): a dashed line to type a title into and press
 * Enter — the task is YOURS, due TODAY, in your first project with a board (the owner's defaults), so typing is
 * the whole job. «المشروع والموعد» opens the full sheet for the other cases, and so does «جديد» → «مهمّة»
 * (`?new=task`). It sends exactly what the sheet sends (`quickTaskBody`, `POST /api/tasks`) through the same
 * server rules, then refreshes the page so the task is in the list.
 *
 * The field is the tour's hook `quick-add`. With no project that has a board yet there is nothing to add to:
 * only «المشروع والموعد» is shown, and its sheet says so and points to «المشاريع».
 *
 * «صندوق المهام» (W1.2, switch `workInbox`): instead of «your first project with a board», the task goes to the inbox of the
 * space (`POST /api/instant/inbox`, in «للتنفيذ»), so typing works with no project at all; in «الشركة» it goes to the first
 * standard space, and with none the line says why («لسا ما إلك مساحة شغل»). Off, everything above is as it was.
 */
export function TodayQuickAdd({
  quickAdd,
  timeZone,
  post = apiPost,
  inbox: given,
}: {
  quickAdd: TodayQuickAddData;
  timeZone: string;
  post?: Post;
  inbox?: WorkInboxInfo | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  // «جديد» → «مهمّة» lands here with ?new=task
  useNewIntent("task", () => setOpen(true));
  const { inbox, known } = useWorkInbox(given);
  const target = quickAdd.targets[0];
  const noSpace = inbox !== null && inbox.space === null;
  // the inbox takes the typing with no project at all; the old way needs a project with a board
  const canType = inbox !== null ? !noSpace : Boolean(target);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canType || !known) return;
    let send: (() => Promise<unknown>) | null = null;
    if (inbox) {
      const made = quickInboxBody(quickAdd, { title, due: "today", timeZone });
      if (made) send = () => post("/api/instant/inbox", made);
    } else if (target) {
      const made = quickTaskBody(quickAdd, { projectId: target.projectId, title, due: "today", timeZone });
      if (made) send = () => post("/api/tasks", made);
    }
    if (!send) return;
    setPending(true);
    try {
      await send();
      setTitle("");
      toast(t("today.quick.inline_added"), "success");
      router.refresh();
    } catch (err) {
      toast(quickError(err, t), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
      {noSpace ? (
        <p data-tour={noSpace ? "quick-add" : undefined} className="min-w-0 flex-1 basis-60 px-1 text-sm text-fg-muted">
          {t("instant.no_space")} · {t("work.inbox.no_space_hint")}
        </p>
      ) : canType ? (
        <form onSubmit={submit} className="min-w-0 flex-1 basis-60">
          <input
            type="text"
            data-tour="quick-add"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
            maxLength={TASK_TITLE_MAX}
            enterKeyHint="done"
            aria-label={t("today.quick.inline_aria")}
            placeholder={t("today.quick.inline_placeholder")}
            className="min-h-11 w-full rounded-lg border border-dashed border-muted bg-transparent px-3 text-base text-fg placeholder:text-fg-muted transition-colors focus:border-solid focus:border-accent focus:bg-surface-2 disabled:opacity-60 md:text-sm"
          />
        </form>
      ) : null}
      {noSpace ? null : (
        <button
          type="button"
          data-tour={canType ? undefined : "quick-add"}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
        >
          <Plus className="size-4" aria-hidden="true" />
          {canType ? t("today.quick.more") : t("today.quick_add")}
        </button>
      )}
      <QuickAddSheet open={open} onOpenChange={setOpen} quickAdd={quickAdd} timeZone={timeZone} inbox={inbox} />
    </div>
  );
}

/**
 * The sheet itself, apart from the button that opens it. `portal={false}` draws it in place instead of on
 * <body>: for a test that renders on the server, where a portal draws nothing.
 */
export function QuickAddSheet({
  open,
  onOpenChange,
  quickAdd,
  timeZone,
  portal = true,
  inbox = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickAdd: TodayQuickAddData;
  timeZone: string;
  portal?: boolean;
  /** `workInbox` on: the inbox is the first choice and no project is needed (null: off, the sheet as it was). */
  inbox?: WorkInboxInfo | null;
}) {
  const { t } = useI18n();
  const noSpace = inbox !== null && inbox.space === null;
  const ready = inbox !== null ? !noSpace : quickAdd.targets.length > 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent portal={portal}>
        <SheetHeader>
          <SheetTitle>{t("task.new")}</SheetTitle>
          <SheetDescription>{ready ? t("today.quick.assigned_hint") : noSpace ? t("work.inbox.no_space_hint") : t("today.quick.no_target_hint")}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {ready ? (
            <QuickAddForm quickAdd={quickAdd} timeZone={timeZone} onDone={() => onOpenChange(false)} inbox={inbox} />
          ) : noSpace ? (
            <p className="pb-2 text-sm font-semibold text-fg">{t("instant.no_space")}</p>
          ) : (
            <div className="space-y-3 pb-2">
              <p className="text-sm font-semibold text-fg">{t("today.quick.no_target_title")}</p>
              <Link
                href="/projects"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg hover:opacity-90"
              >
                {t("today.quick.open_projects")}
              </Link>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** The people a task can be given to in one space: «GET /api/workspaces/[id]/members» (the people of that space, nobody else). */
interface Person {
  id: string;
  name: string;
}

function usePeople(workspaceId: string | null): Person[] {
  const [people, setPeople] = useState<{ workspaceId: string; list: Person[] } | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    // a failed answer is «nobody to pick»: the task stays the person's own, as before
    apiGet<{ members?: Person[] }>(`/api/workspaces/${workspaceId}/members`).then(
      (data) => live && setPeople({ workspaceId, list: (data.members ?? []).map((m) => ({ id: m.id, name: m.name })) }),
      () => live && setPeople({ workspaceId, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return people && people.workspaceId === workspaceId ? people.list : [];
}

const FIELD = "min-h-11 w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted transition-colors focus:border-accent/60";

/**
 * The form inside the sheet. `post` is a parameter only so that a test can stand in for the network. It owns no
 * decision: what is sent is built by `quickTaskBody` / `quickInboxBody` (tested on their own), and what is allowed is up to the server.
 */
export function QuickAddForm({
  quickAdd,
  timeZone,
  onDone,
  post = apiPost,
  inbox = null,
}: {
  quickAdd: TodayQuickAddData;
  timeZone: string;
  onDone: () => void;
  post?: Post;
  inbox?: WorkInboxInfo | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [title, setTitle] = useState("");
  // with the inbox on it is the first choice and the default; its own project is not listed a second time
  const targets = inbox ? quickAdd.targets.filter((x) => x.projectId !== inbox.projectId) : quickAdd.targets;
  const [projectId, setProjectId] = useState(inbox ? WORK_INBOX_REF : (quickAdd.targets[0]?.projectId ?? ""));
  const [due, setDue] = useState<QuickDue>("today");
  const [description, setDescription] = useState("");
  // «لمين»: one tap on a person; the person themself until they tap another (their own task, as before)
  const [assigneeId, setAssigneeId] = useState(quickAdd.assigneeId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spaceId = inbox && projectId === WORK_INBOX_REF ? (inbox.space?.id ?? null) : (quickAdd.targets.find((x) => x.projectId === projectId)?.workspaceId ?? null);
  const people = usePeople(spaceId);
  // the people of another space are not the people of this one: the choice goes back to the person themself
  useEffect(() => {
    setAssigneeId(quickAdd.assigneeId);
  }, [spaceId, quickAdd.assigneeId]);
  const others = people.filter((p) => p.id !== quickAdd.assigneeId);

  // On a desktop the sheet takes the keyboard the moment it opens. On a phone it must not: the
  // keyboard rising fights the drag-to-dismiss gesture, so focus waits for a tap (item 10).
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) titleRef.current?.focus();
  }, []);

  // the space is named beside the project only when the projects are in more than one space
  const manySpaces = new Set(targets.map((x) => x.workspaceId)).size > 1;
  const days: { value: QuickDue; label: string }[] = [
    { value: "today", label: t("time.today") },
    { value: "tomorrow", label: t("time.tomorrow") },
    { value: "none", label: t("today.quick.no_date") },
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const toInbox = inbox !== null && projectId === WORK_INBOX_REF;
    const body = toInbox ? quickInboxBody(quickAdd, { title, due, timeZone, assigneeId, description }) : quickTaskBody(quickAdd, { projectId, title, due, timeZone, assigneeId, description });
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      await post(toInbox ? "/api/instant/inbox" : "/api/tasks", body);
      toast(t("common.created"), "success");
      router.refresh();
      onDone();
    } catch (err) {
      const message = quickError(err, t);
      setError(message);
      toast(message, "error");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("task.title")}</span>
        <input
          type="text"
          name="title"
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={TASK_TITLE_MAX}
          placeholder={t("today.quick.title_placeholder")}
          className={FIELD}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("proj.one")}</span>
        <select name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)} className={FIELD}>
          {inbox ? <option value={WORK_INBOX_REF}>{t("work.inbox.name")}</option> : null}
          {targets.map((target) => (
            <option key={target.projectId} value={target.projectId}>
              {manySpaces ? `${target.projectName} · ${target.workspaceName}` : target.projectName}
            </option>
          ))}
        </select>
        {inbox && projectId === WORK_INBOX_REF ? <span className="mt-1 block text-xs text-fg-muted">{t("work.inbox.sheet_hint")}</span> : null}
      </label>

      {others.length > 0 ? (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-fg-muted">{t("today.quick.assignee")}</legend>
          <div data-quick="assignees" className="flex gap-2 overflow-x-auto pb-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden md:flex-wrap">
            {[{ id: quickAdd.assigneeId, name: t("today.quick.me") }, ...others].map((person) => (
              <label
                key={person.id}
                className={cn(
                  "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border ps-1.5 pe-4 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                  assigneeId === person.id ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:bg-surface-2",
                )}
              >
                <input type="radio" name="assigneeId" value={person.id} checked={assigneeId === person.id} onChange={() => setAssigneeId(person.id)} className="sr-only" />
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                  {Array.from(person.name.trim())[0] ?? ""}
                </span>
                <bdi className="max-w-28 truncate">{person.id === quickAdd.assigneeId ? person.name : person.name.trim().split(/s+/)[0]}</bdi>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">{t("today.quick.description")}</span>
        <textarea
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={QUICK_DESCRIPTION_MAX}
          rows={3}
          placeholder={t("today.quick.description_placeholder")}
          className={cn(FIELD, "min-h-24 resize-y py-2 leading-relaxed")}
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-fg-muted">{t("task.due")}</legend>
        <div className="flex flex-wrap gap-2">
          {days.map((day) => (
            <label
              key={day.value}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                due === day.value ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:bg-surface-2",
              )}
            >
              <input type="radio" name="due" value={day.value} checked={due === day.value} onChange={() => setDue(day.value)} className="sr-only" />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? t("common.saving") : t("today.quick.submit")}
      </button>
    </form>
  );
}
