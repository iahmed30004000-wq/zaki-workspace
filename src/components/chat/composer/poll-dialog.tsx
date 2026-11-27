"use client";
import React from "react";
import type { MessageDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { messageClientId } from "@/lib/chat/conversation/client";
import { PollExtrasFields } from "@/components/chat/composer/poll-extras-fields";
import { buildPollPayload, correctAfter, emptyPollDraft, errorKeyOf, POLL_CLOSE_CHOICES, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX, pollDraftProblem, type PollDraft } from "@/lib/chat/poll-client";

const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";

/** Sends the draft as a new poll message; throws with the words to show. The dialog and the phone's attach sheet share it. */
export async function createPoll(conversationId: string, draft: PollDraft, clientId: string): Promise<MessageDto> {
  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildPollPayload(draft, clientId)) });
  if (!response.ok) {
    const key = errorKeyOf(await response.json().catch(() => null));
    throw new Error(key ? ct(key) : ct("chatc.poll.failed"));
  }
  return (await response.json()) as MessageDto;
}

/**
 * «استطلاع» from the composer's «+»: a question, 2 to 10 options, one choice or several, an optional deadline
 * (at most 7 days) and an optional secret ballot. It is sent as an ordinary message with a `poll` (the send path,
 * its limiter and its realtime event); the server checks every rule again.
 */
export function PollDialog({ open, conversationId, onClose, onCreated, extras = false }: { open: boolean; conversationId: string; onClose: () => void; onCreated: (message: MessageDto) => void; /** the company's switch `chatPollExtras` */ extras?: boolean }) {
  const [draft, setDraft] = React.useState<PollDraft>(emptyPollDraft);
  const [clientId, setClientId] = React.useState(() => messageClientId());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { if (open) { setDraft(emptyPollDraft()); setClientId(messageClientId()); setError(""); setBusy(false); } }, [open]);
  const change = (patch: Partial<PollDraft>) => { setClientId(messageClientId()); setDraft(d => ({ ...d, ...patch })); };
  const setOption = (index: number, text: string) => change({ options: draft.options.map((o, i) => i === index ? text : o) });
  const problem = pollDraftProblem(draft);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    // the dialog is drawn in a portal but sits inside the composer's form in the React tree: its submit must not reach the composer's
    event.stopPropagation();
    if (busy || problem) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await createPoll(conversationId, draft, clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : ct("chatc.poll.failed"));
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={next => !next && onClose()}>
   <DialogContent size="md">
    <DialogHeader><DialogTitle>{ct("chatc.poll.title")}</DialogTitle></DialogHeader>
    <DialogBody>
     <form onSubmit={event => void create(event)} className="space-y-4">
      <div>
       <label htmlFor="poll-question" className="mb-1 block text-sm font-medium">{ct("chatc.poll.question")}</label>
       <textarea id="poll-question" rows={2} maxLength={POLL_QUESTION_MAX} value={draft.question} onChange={e => change({ question: e.currentTarget.value })} className="min-h-11 w-full resize-none rounded-lg border border-muted bg-surface px-3 py-2 text-base md:text-sm" />
      </div>
      <div className="space-y-2">
       {draft.options.map((text, index) => <div key={index} className="flex items-center gap-2">
        <label htmlFor={`poll-option-${index}`} className="sr-only">{ct("chatc.poll.option", { n: index + 1 })}</label>
        <input id={`poll-option-${index}`} maxLength={POLL_OPTION_MAX} value={text} placeholder={ct("chatc.poll.option", { n: index + 1 })} onChange={e => setOption(index, e.currentTarget.value)} className={field} />
        {draft.options.length > POLL_MIN_OPTIONS && <button type="button" aria-label={ct("chatc.poll.remove_option", { n: index + 1 })} onClick={() => change({ options: draft.options.filter((_, i) => i !== index), ...(draft.quiz ? { correct: correctAfter(draft.correct, draft.options.map((_, i) => i).filter(i => i !== index)) } : {}) })} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border text-danger"><span aria-hidden="true">×</span></button>}
       </div>)}
       {draft.options.length < POLL_MAX_OPTIONS && <button type="button" onClick={() => change({ options: [...draft.options, ""] })} className="min-h-11 text-sm font-semibold text-accent">{ct("chatc.poll.add_option")}</button>}
       <p className="text-xs text-fg-muted">{ct("chatc.poll.hint")}</p>
      </div>
      {!draft.quiz && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.multiple} onChange={e => change({ multiple: e.currentTarget.checked })} className="size-4" />{ct("chatc.poll.multiple")}</label>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.anonymous} onChange={e => change({ anonymous: e.currentTarget.checked })} className="size-4" />{ct("chatc.poll.anonymous")}</label>
      <div>
       <label htmlFor="poll-closes" className="mb-1 block text-sm font-medium">{ct("chatc.poll.closes")}</label>
       <select id="poll-closes" value={draft.closesInMinutes} onChange={e => change({ closesInMinutes: Number(e.currentTarget.value) })} className={field}>
        {POLL_CLOSE_CHOICES.map(minutes => <option key={minutes} value={minutes}>{ct(minutes === 0 ? "chatc.poll.closes.none" : `chatc.poll.closes.${minutes}`)}</option>)}
       </select>
      </div>
      {extras && <PollExtrasFields draft={draft} onChange={change} />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy || problem !== null} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-60">{ct("chatc.poll.create")}</button>
     </form>
    </DialogBody>
   </DialogContent>
  </Dialog>;
}
