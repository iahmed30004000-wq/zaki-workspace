"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Search, Send } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { appendMessage } from "@/lib/chat/cache/writer";
import { messageClientId } from "@/lib/chat/conversation/client";
import { postChatMessage } from "@/lib/chat/outbox/send";
import { playChatSound } from "@/lib/chat/sounds";
import { ct } from "@/lib/chat/text";
import { contactMessage, contactsOf } from "@/lib/chat/v2/composer/contact-message";
import { filterContacts, sortContacts, type ContactPerson } from "@/lib/contacts";

/**
 * «جهة اتصال» in the phone's attach sheet: the people of the contacts screen (the chat's directory, which refuses an external partner), a search box, and
 * one button that sends the picked person. A tap on a name only picks them: nothing is sent by a slip of the thumb.
 */
export function ContactList({
  people,
  state,
  query,
  onQuery,
  picked,
  onPickPerson,
  onSendContact,
  busy,
  error,
}: {
  people: ContactPerson[];
  state: "loading" | "ready" | "refused" | "failed";
  query: string;
  onQuery: (value: string) => void;
  picked: string | null;
  onPickPerson: (userId: string) => void;
  onSendContact: () => void;
  busy: boolean;
  error: string;
}) {
  if (state !== "ready") {
    return (
      <p role={state === "loading" ? "status" : "alert"} className="px-4 py-8 text-center text-sm text-fg-muted">
        {ct(state === "loading" ? "chatc.loading" : state === "refused" ? "tgsheets.contact.refused" : "tgsheets.contact.failed")}
      </p>
    );
  }
  const shown = filterContacts(people, query);
  const chosen = people.find((p) => p.userId === picked);
  return (
    <div data-attach-contacts="" className="flex min-h-full flex-col">
      <label className="mx-3 mb-1 flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4">
        <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="sr-only">{ct("tgsheets.contact.search")}</span>
        <input value={query} onChange={(e) => onQuery(e.currentTarget.value)} placeholder={ct("tgsheets.contact.search")} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-muted" />
      </label>
      {shown.length === 0 ? <p className="px-4 py-6 text-center text-sm text-fg-muted">{ct("tgsheets.contact.none")}</p> : null}
      <ul className="flex-1">
        {shown.map((person) => (
          <li key={person.userId}>
            <button type="button" data-contact={person.userId} aria-pressed={picked === person.userId} onClick={() => onPickPerson(person.userId)} className="flex min-h-14 w-full items-center gap-3 px-4 text-start hover:bg-surface-2 aria-pressed:bg-accent/10">
              <Avatar name={person.name} src={person.avatarUrl} className="size-10 text-sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <bdi className="truncate text-[15px] text-fg">{person.name}</bdi>
                  {person.verified ? <VerifiedBadge /> : null}
                </span>
                {person.jobTitle ? <bdi className="block truncate text-xs text-fg-muted">{person.jobTitle}</bdi> : null}
              </span>
              {picked === person.userId ? <Check aria-hidden="true" className="size-5 shrink-0 text-accent" /> : null}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {chosen ? (
        <div className="sticky bottom-0 border-t border-border bg-surface-1 p-2">
          <button type="button" data-contact-send="" disabled={busy} onClick={onSendContact} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 font-semibold text-accent-fg disabled:opacity-60">
            {busy ? <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" /> : <Send aria-hidden="true" className="size-5" />}
            <span className="truncate">{ct("tgsheets.contact.send", { name: chosen.name })}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

class Refused extends Error {}

/** The tab with its data and its send: drawn only inside an open conversation (it asks the pane which one). */
export function ContactTab({ onSent }: { onSent: () => void }) {
  const qc = useQueryClient();
  const pane = usePaneActions();
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // one id per chosen person: a retry after a lost answer never sends the person twice
  const clientId = React.useRef(messageClientId());
  const list = useQuery({
    queryKey: ["attach-contacts"],
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/chat/directory?scope=company", { cache: "no-store", signal });
      if (res.status === 403) throw new Refused();
      if (!res.ok) throw new Error(String(res.status));
      return sortContacts(contactsOf(await res.json()));
    },
  });
  const people = list.data ?? [];

  async function send() {
    const person = people.find((p) => p.userId === picked);
    if (!person || busy) return;
    setBusy(true);
    setError("");
    // «لا معاينة»: the link is a page of this app, behind its sign-in; the server has nothing to visit
    const outcome = await postChatMessage(pane.conversationId, { body: contactMessage(person.name, window.location.origin, person.userId), attachmentIds: [], mentions: [], noPreview: true, clientId: clientId.current });
    if (outcome.kind === "sent") {
      appendMessage(qc, pane.conversationId, outcome.message);
      playChatSound("sent");
      pane.toNewest();
      onSent();
      return;
    }
    setBusy(false);
    setError(ct(outcome.kind === "refused" ? outcome.failure.key : "chatc.message_failed"));
  }

  return (
    <ContactList
      people={people}
      state={list.isPending ? "loading" : list.error instanceof Refused ? "refused" : list.isError ? "failed" : "ready"}
      query={query}
      onQuery={setQuery}
      picked={picked}
      onPickPerson={(id) => {
        if (id !== picked) clientId.current = messageClientId();
        setPicked(id);
      }}
      onSendContact={() => void send()}
      busy={busy}
      error={error}
    />
  );
}
