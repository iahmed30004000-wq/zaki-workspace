import type { ConversationDto, ConversationHeaderDto, MemberDto } from "@/server/chat/dto";

/** The people the header leaves out (the composer's «@», the highlighted mentions, the topic settings' list). */
export interface PaneMembers {
  members?: MemberDto[];
  mentionables?: MemberDto[];
}

/**
 * C2.4 — today's `ChatComposer` and `TopicSettingsDialog` take a `ConversationDto`. The header is that DTO without the messages and the people; this is
 * the header with the people put back (when they are known) and no messages (neither of those two reads them). Pure.
 */
export function composerDetailOf(header: ConversationHeaderDto, people: PaneMembers | null): ConversationDto {
  return { ...header, messages: [], readers: [], ...(people?.members ? { members: people.members } : {}), ...(people?.mentionables ? { mentionables: people.mentionables } : {}) };
}
