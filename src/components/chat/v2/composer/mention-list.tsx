"use client";

import React from "react";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { ASSISTANT_MENTION_ID } from "@/lib/chat/conversation/mentions";
import { ct } from "@/lib/chat/text";
import type { MentionChoice } from "@/lib/chat/v2/composer/types";

/** C2.5 — the «@» list: «@الكل» first where I may use it, then the people; the keys are driven by the box (`aria-activedescendant`). */
export function MentionList({ choices, pickAt, onHover, onChoose }: { choices: MentionChoice[]; pickAt: number; onHover: (index: number) => void; onChoose: (id: string, name: string) => void }) {
  if (choices.length === 0) return null;
  return (
    <ul id="chat-mention-list" role="listbox" aria-label={ct("chatc.mention")} className="max-h-56 overflow-y-auto rounded-xl bg-surface-1 p-1 shadow-lg">
      {choices.map((member, index) => (
        <li key={member.id} id={`chat-mention-${index}`} role="option" aria-selected={index === pickAt}>
          <button
            type="button"
            className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start md:min-h-10 ${index === pickAt ? "bg-surface-2" : ""}`}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(member.id, member.name)}
          >
            {member.id === ASSISTANT_MENTION_ID ? (
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-info/15 text-sm font-bold text-info">
                ✦
              </span>
            ) : member.all ? (
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                @
              </span>
            ) : (
              <span className="relative shrink-0">
                <Avatar name={member.name} src={member.avatarUrl} className="size-8 text-xs" />
                {member.online ? <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-surface bg-ok" /> : null}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{member.all ? `@${member.name}` : member.name}</span>
            {/* S5.5: the people come from the conversation's own list (`MemberDto.verified`); «@الكل» and the assistant have none */}
            {(member as MentionChoice & { verified?: boolean }).verified ? <VerifiedBadge /> : null}
            {member.all ? <span className="text-xs text-fg-muted">{ct("chatc.mention_all_hint")}</span> : null}
            {member.id === ASSISTANT_MENTION_ID ? <span className="text-xs text-fg-muted">{ct("chatai.mention_hint")}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
