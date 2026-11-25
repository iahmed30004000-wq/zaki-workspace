"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hash, Megaphone, MessageSquare, UserRound } from "lucide-react";
import type { ChatHitDto, ChatListSearchDto, PersonHitDto } from "@/server/chat/search";
import type { MessageHitDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { BotFatherFound } from "@/components/chat/botfather-find";
import { asksForBotFather } from "@/lib/chat/botfather";
import { ct } from "@/lib/chat/text";
import { chatHitHref, hasListResults, messageHitHref, personHitHref, personOpensChat } from "@/lib/chat/v2/info/list-search";
import { useListSearch } from "@/lib/chat/v2/info/use-list-search";
import { chatHref } from "@/lib/chat/v2/routes";
import { dayDiff, fmtShort, fmtTime } from "@/lib/format";

const row = "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const whenOf = (at: string): string => (dayDiff(at) === 0 ? fmtTime(at) : fmtShort(at));

function Section({ id, titleKey, children }: { id: string; titleKey: string; children: React.ReactNode }) {
  return (
    <section data-list-search-section={id}>
      <h3 className="bg-surface-1 px-3 py-1 text-xs font-semibold text-fg-muted">{ct(titleKey)}</h3>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

function ChatRow({ chat, onPick }: { chat: ChatHitDto; onPick: () => void }) {
  return (
    <li>
      <Link href={chatHitHref(chat)} onClick={onPick} data-list-search-chat={chat.id} className={row}>
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-xl">
          {chat.emoji ?? (chat.kind === "DM" ? <UserRound className="size-5" /> : chat.kind === "SPACE" ? <Megaphone className="size-5" /> : <Hash className="size-5" />)}
        </span>
        <span className="min-w-0 flex-1">
          <bdi className="block truncate font-semibold">{chat.title}</bdi>
          {chat.kind === "SPACE" ? <span className="block truncate text-xs text-fg-muted">{ct("chatls.space")}</span> : chat.context ? <bdi className="block truncate text-xs text-fg-muted">{chat.context}</bdi> : null}
        </span>
      </Link>
    </li>
  );
}

/** A person: with a private chat already open it is a link; without one a tap asks the server to open it (a guest's row has no such door: just the name). */
function PersonRow({ person, onPick }: { person: PersonHitDto; onPick: () => void }) {
  const router = useRouter();
  const [failed, setFailed] = React.useState(false);
  const href = personHitHref(person);
  const body = (
    <>
      <Avatar name={person.name} src={person.avatarUrl ?? null} className="size-10 text-sm" />
      <span className="min-w-0 flex-1">
        <bdi className="block truncate font-semibold">{person.name}</bdi>
        {person.jobTitle ? <bdi className="block truncate text-xs text-fg-muted">{person.jobTitle}</bdi> : null}
        {failed ? <span role="alert" className="block text-xs text-danger">{ct("chatls.person_failed")}</span> : null}
      </span>
    </>
  );
  if (href) {
    return (
      <li>
        <Link href={href} onClick={onPick} data-list-search-person={person.id} aria-label={ct("chatls.person_open", { name: person.name })} className={row}>
          {body}
        </Link>
      </li>
    );
  }
  if (!personOpensChat(person)) {
    // a guest's row: the name only
    return (
      <li data-list-search-person={person.id} className={`${row} hover:bg-transparent`}>
        {body}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        data-list-search-person={person.id}
        aria-label={ct("chatls.person_open", { name: person.name })}
        onClick={() => {
          setFailed(false);
          fetch("/api/chat/dm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: person.id }) })
            .then((res) => (res.ok ? (res.json() as Promise<{ id: string }>) : Promise.reject(new Error("dm"))))
            .then((made) => {
              onPick();
              router.push(chatHref.conversation(made.id));
            })
            .catch(() => setFailed(true));
        }}
        className={row}
      >
        {body}
      </button>
    </li>
  );
}

function MessageRow({ hit, onPick }: { hit: MessageHitDto; onPick: () => void }) {
  return (
    <li>
      <Link href={messageHitHref(hit)} onClick={onPick} data-list-search-message={hit.id} className={`${row} items-start`}>
        <MessageSquare aria-hidden="true" className="mt-1 size-5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            <bdi className="min-w-0 flex-1 truncate font-semibold text-fg">{hit.conversationTitle}</bdi>
            <small className="shrink-0">{whenOf(hit.at)}</small>
          </span>
          <span className="block truncate text-xs text-fg-muted">
            <bdi>{hit.authorName}</bdi>
          </span>
          <span className="line-clamp-2 break-words">{hit.snippet}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * C3d — what the chat list's search found, three sections: «المحادثات» (topics, private chats, spaces by title), «الأشخاص» and «الرسائل» (snippet, chat, date). A
 * section with nothing in it is not drawn. `onPick` runs when a result is opened (the list clears its field). Pure: it draws what the server answered, the server
 * having decided who may see what (src/server/chat/search.ts).
 */
export function ListSearchResults({ data, onPick }: { data: ChatListSearchDto; onPick: () => void }) {
  return (
    <div data-list-search-results>
      {data.chats.length > 0 ? (
        <Section id="chats" titleKey="chatls.chats">
          {data.chats.map((chat) => (
            <ChatRow key={`${chat.kind}:${chat.id}`} chat={chat} onPick={onPick} />
          ))}
        </Section>
      ) : null}
      {data.people.length > 0 ? (
        <Section id="people" titleKey="chatls.people">
          {data.people.map((person) => (
            <PersonRow key={person.id} person={person} onPick={onPick} />
          ))}
        </Section>
      ) : null}
      {data.messages.length > 0 ? (
        <Section id="messages" titleKey="chatls.messages">
          {data.messages.map((hit) => (
            <MessageRow key={hit.id} hit={hit} onPick={onPick} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/**
 * The list's search results as an overlay under the search field (the header's own box is `relative`): drawn only while there is something to show — while the
 * words are being asked for, or when nothing was found, the list's own narrowed rows stay in view. A failure says so.
 */
export function ListSearchPanel({ query, onPick }: { query: string; onPick: () => void }) {
  const { data, failed } = useListSearch(query);
  if (failed) {
    return (
      <div data-list-search-panel role="alert" className="absolute inset-x-0 top-full z-20 border-b border-border bg-surface p-3 text-sm text-fg-muted shadow-lg">
        {ct("chatls.failed")}
      </div>
    );
  }
  const results = data && hasListResults(data) ? data : null;
  const botFather = asksForBotFather(query);
  if (!results && !botFather) return null;
  return (
    // `empty:hidden`: while «بوت فاذر» is being asked about (or is not offered to me) and nothing else was found, there is no panel
    <div data-list-search-panel role="region" aria-label={ct("chatls.panel")} className="absolute inset-x-0 top-full z-20 max-h-[70vh] overflow-y-auto overscroll-contain border-b border-border bg-surface shadow-lg empty:hidden">
      {botFather ? <BotFatherFound onPick={onPick} /> : null}
      {results ? <ListSearchResults data={results} onPick={onPick} /> : null}
    </div>
  );
}
