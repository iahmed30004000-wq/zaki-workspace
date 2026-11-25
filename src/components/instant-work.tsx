"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { enumOptions } from "@/lib/i18n/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { PeopleMulti } from "@/components/ui/people-multi";
import { errText } from "@/components/department-tickets";
import { RewardToggleBlock, draftReady, emptyDraft, rewardBodyOf, rewardErrorText, type RewardDraft } from "@/components/rewards/reward-fields";

/**
 * «+ مهمة فورية» on «مهامي» and «+ تذكرة فورية» on «التذاكر» (the owner's ask, 2026-10-27): one small form — what is
 * wanted, for whom (the people of the space one is in), the priority, and for a task its day (today unless changed).
 * Nothing is drawn while the «instantWork» switch is off or the person may not add that kind of work: the server
 * says so (`GET /api/instant`) and refuses on its own anyway. Plain requests, no query cache: «مهامي» is a server page
 * and is simply refreshed; `onSent` lets a desk reload its own lists.
 */

interface InstantInfo {
  task: boolean;
  ticket: boolean;
  space: { id: string; name: string } | null;
  /** `request`: somebody of a higher rank than the viewer; a task for them is only a request (task-assign.ts). */
  people: { id: string; name: string; request?: boolean }[];
  /** The company's default due date as its wall clock (`YYYY-MM-DDTHH:mm`), or null. */
  defaultDue?: string | null;
  /** «مهمة بمكافأة»: only for the OWNER while the switch is on (the toggle is drawn for nobody else); the company's default currency, if any. */
  reward?: { defaultCurrency: string | null } | null;
}

/** The day and hour as picked, sent as they are: the server reads them on the COMPANY's clock (review B5) — the browser's clock never decides. Empty: «بدون موعد». */
function dueOf(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(day) ? day.slice(0, 16) : null;
}

export function InstantWorkButton({ kind, onSent }: { kind: "task" | "ticket"; onSent?: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [info, setInfo] = useState<InstantInfo | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<InstantInfo>("/api/instant").then(
      (data) => live && setInfo(data),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  // «لمين»: one person for a ticket, one or more for a task (the first picked is the task's own assignee)
  const [people, setPeople] = useState<string[]>([]);
  const [priority, setPriority] = useState("NORMAL");
  // null: the person has not touched the box, so it shows (and sends) the company's default
  const [picked, setDay] = useState<string | null>(null);
  const day = picked ?? info?.defaultDue ?? "";
  // «مهمة بمكافأة»: the owner's toggle, with the amount, the currency and a note; the day above becomes required
  const [rewardOn, setRewardOn] = useState(false);
  const [draft, setDraft] = useState<RewardDraft>(() => emptyDraft(null));

  async function send() {
    setPending(true);
    try {
      let asked = false;
      if (kind === "task") {
        const res = await apiPost<{ task: { requested?: boolean } }>("/api/instant/task", { title: title.trim(), description: details.trim() || null, assigneeIds: people, priority, dueDate: dueOf(day), ...(rewardOn ? { reward: rewardBodyOf(draft) } : {}) });
        asked = res.task.requested === true;
      } else {
        await apiPost("/api/instant/ticket", { title: title.trim(), description: details.trim() || null, assigneeId: people[0], priority });
      }
      // a person of a higher rank was ASKED, not assigned (task-assign.ts)
      toast(t(asked ? "taskreq.created" : kind === "task" ? "instant.task.sent" : "instant.ticket.sent"), "success");
      setOpen(false);
      setTitle("");
      setDetails("");
      setPeople([]);
      setPriority("NORMAL");
      setDay(null);
      setRewardOn(false);
      setDraft(emptyDraft(info?.reward?.defaultCurrency));
      onSent?.();
      router.refresh();
    } catch (err) {
      toast(rewardOn ? rewardErrorText(err, t) : errText(err, t), "error");
    } finally {
      setPending(false);
    }
  }

  if (!info?.[kind]) return null;
  const rewardOffered = kind === "task" && Boolean(info.reward);
  const label = t(kind === "task" ? "instant.task.button" : "instant.ticket.button");
  const minTitle = kind === "ticket" ? 3 : 1;
  const ready = title.trim().length >= minTitle && people.length > 0 && (!rewardOn || (draftReady(draft) && dueOf(day) !== null));

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} className="shrink-0">
        <Plus className="size-4" aria-hidden="true" />
        {label}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={`⚡ ${label}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !pending) void send();
            }}
          >
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("instant.field.title")}
              aria-label={t("instant.field.title")}
              required
              minLength={minTitle}
              maxLength={kind === "ticket" ? 200 : 280}
            />
            {kind === "task" ? (
              <div className="space-y-1 text-xs">
                <span className="block font-medium text-fg">{t("instant.field.people")}</span>
                <PeopleMulti
                  people={info.people}
                  value={people}
                  onChange={setPeople}
                  label={t("instant.field.people")}
                  emptyText={t("instant.field.nobody")}
                  requestTag={t("taskreq.tag")}
                />
                <span className="block text-fg-muted">{t("instant.field.peopleHint")}</span>
                {info.people.some((p) => p.request && people.includes(p.id)) ? (
                  <span className="block text-fg-muted">{t("taskreq.hint")}</span>
                ) : null}
              </div>
            ) : (
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-fg">{t("instant.field.person")}</span>
                <Select value={people[0] ?? ""} onChange={(e) => setPeople(e.target.value ? [e.target.value] : [])} required>
                  <option value="">{t("instant.field.pick")}</option>
                  {info.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-fg">{t("instant.field.priority")}</span>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {/* «بلا أولوية» is not one to pick here: the server takes the four levels */}
                  {enumOptions("TaskPriority").filter((o) => o.value !== "NONE").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
              {kind === "task" ? (
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-fg">{t("instant.field.due")}</span>
                  <Input type="datetime-local" value={day} onChange={(e) => setDay(e.target.value)} required={rewardOn} />
                </label>
              ) : null}
            </div>
            <RewardToggleBlock
              offered={rewardOffered}
              on={rewardOn}
              onToggle={(next) => {
                setRewardOn(next);
                if (next && !draft.currency && info.reward?.defaultCurrency) setDraft({ ...draft, currency: info.reward.defaultCurrency });
              }}
              draft={draft}
              onDraft={setDraft}
              dayMissing={dueOf(day) === null}
              idPrefix="instant-reward"
            />
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} placeholder={t("instant.field.details")} aria-label={t("instant.field.details")} />
            <div className="flex justify-end">
              <Button type="submit" disabled={!ready || pending}>
                {t("instant.send")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
