package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * THE CHAT, AS THE SITE'S OWN v2 CHAT READS IT (src/server/chat/dto.ts, the routes under src/app/api/chat). Only the fields the phone
 * draws; a field the server adds later is ignored, one it leaves out takes its default — an older or newer server never crashes the app.
 */

// ── the parts of a message ────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class ReplyRef(val id: String = "", val preview: String? = null, val authorName: String = "", val deleted: Boolean = false, val quote: String? = null)

@Immutable
@Serializable
data class ForwardRef(val name: String = "")

@Immutable
@Serializable
data class Reactor(val id: String = "", val name: String = "", val avatar: String? = null, val me: Boolean = false)

/** A chip under a message: the emoji, how many, whether I am one of them, and the people the server may name to me. */
@Immutable
@Serializable
data class Reaction(val emoji: String = "", val count: Int = 0, val mine: Boolean = false, val by: List<Reactor> = emptyList())

/** `{k, p}` of a system line: the app writes the Arabic sentence (join, leave, pin, member_added …). */
@Immutable
@Serializable
data class SystemMeta(val k: String = "", val p: Map<String, kotlinx.serialization.json.JsonPrimitive> = emptyMap())

@Immutable
@Serializable
data class PollOption(val id: String = "", val text: String = "", val count: Int = 0, val percent: Int = 0, val mine: Boolean = false)

@Immutable
@Serializable
data class Poll(
    val id: String = "",
    val multiple: Boolean = false,
    val anonymous: Boolean = false,
    val closesAt: String? = null,
    val closed: Boolean = false,
    val voters: Int = 0,
    val options: List<PollOption> = emptyList(),
    val canVote: Boolean = false,
    val canClose: Boolean = false,
)

@Immutable
@Serializable
data class ChecklistItem(val id: String = "", val text: String = "", val done: Boolean = false, val doneByName: String? = null, val canEdit: Boolean = false)

@Immutable
@Serializable
data class Checklist(
    val id: String = "",
    val othersCanAdd: Boolean = false,
    val othersCanTick: Boolean = false,
    val items: List<ChecklistItem> = emptyList(),
    val done: Int = 0,
    val total: Int = 0,
    val canAdd: Boolean = false,
    val canTick: Boolean = false,
    val max: Int = 30,
)

@Immutable
@Serializable
data class LinkPreview(val url: String = "", val title: String? = null, val description: String? = null, val siteName: String? = null, val image: String? = null)

@Immutable
@Serializable
data class MustRead(val mine: Boolean = false, val acked: Boolean = false, val total: Int? = null, val read: Int? = null)

// ── the list (GET /api/chat/list) ─────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class RowLast(
    val id: String = "",
    val authorName: String = "",
    /** null: a deleted message */
    val preview: String? = null,
    val kind: String = "TEXT",
    val at: String = "",
    val mine: Boolean = false,
    val status: String? = null,
    val checklist: ChecklistCount? = null,
)

@Immutable
@Serializable
data class ChecklistCount(val done: Int = 0, val total: Int = 0)

@Immutable
@Serializable
data class RowSpace(val id: String = "", val name: String = "")

@Immutable
@Serializable
data class TopicChip(val id: String = "", val title: String = "", val emoji: String? = null, val unread: Int = 0)

/** One row of the chat list: a private chat, a group, a whole space (its topics as chips) or one topic. */
@Immutable
@Serializable
data class ChatRow(
    /** the conversation's id; for a SPACE row the space's id */
    val id: String,
    val kind: String = "TOPIC", // DM · GROUP · SPACE · TOPIC
    val title: String = "",
    val emoji: String? = null,
    val avatarUrl: String? = null,
    val peerId: String? = null,
    val verified: Boolean = false,
    val space: RowSpace? = null,
    val lastMessage: RowLast? = null,
    val unread: Int = 0,
    val mentionsUnread: Int = 0,
    val muted: Boolean = false,
    val pinnedByMe: Boolean = false,
    val archivedByMe: Boolean = false,
    val markedUnread: Boolean = false,
    val restricted: Boolean = false,
    val topicChips: List<TopicChip> = emptyList(),
    val topicCount: Int? = null,
    val canModerate: Boolean = false,
    val topicType: String? = null,
    val postingPolicy: String? = null,
    val closed: Boolean = false,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val system: Boolean = false,
)

@Immutable
@Serializable
data class ChatList(
    val scope: String = "all",
    val spaceId: String? = null,
    val rows: List<ChatRow> = emptyList(),
    val canOversee: Boolean = false,
    /** the company's `chatPersonalState` switch: off, there is no pin / archive / mute of my own (absent: on) */
    val personal: Boolean = true,
)

@Immutable
@Serializable
data class TopicsSpace(val id: String = "", val name: String = "", val emoji: String? = null, val canModerate: Boolean = false, val canCreateTopic: Boolean = false)

/** `GET /api/chat/spaces/[spaceId]/topics`: one space as a forum. */
@Immutable
@Serializable
data class SpaceTopics(val space: TopicsSpace = TopicsSpace(), val rows: List<ChatRow> = emptyList())

@Serializable
data class NewTopicBody(val title: String, val emoji: String? = null)

/** `PUT /api/chat/conversations/[id]/me`: my own pin, archive, unread mark and mute (null unmutes). At least one field. */
@Serializable
data class MyChatState(
    val pinned: Boolean? = null,
    val archived: Boolean? = null,
    val markedUnread: Boolean? = null,
    val mutedUntil: String? = null,
)

@Serializable
data class MyChatStateAnswer(val pinned: Boolean = false, val archived: Boolean = false, val markedUnread: Boolean = false, val mutedUntil: String? = null)

// ── the folders (GET /api/me/chat-prefs) ──────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class FolderInclude(
    val dms: Boolean = false,
    val spaces: Boolean = false,
    val mentions: Boolean = false,
    val conversationIds: List<String> = emptyList(),
    val spaceIds: List<String> = emptyList(),
)

@Immutable
@Serializable
data class FolderExclude(val muted: Boolean = false, val read: Boolean = false, val archived: Boolean = false)

@Immutable
@Serializable
data class Folder(val id: String = "", val name: String = "", val emoji: String? = null, val include: FolderInclude = FolderInclude(), val exclude: FolderExclude = FolderExclude())

@Immutable
@Serializable
data class ChatTabs(val hidden: List<String> = emptyList())

@Immutable
@Serializable
data class ChatPrefs(val folders: Map<String, List<Folder>?> = emptyMap(), val tabs: ChatTabs? = null, val chat: ChatLook? = null)

/** the person's own chat choices the phone uses: the six of a long press (`chat.quickReactions`) */
@Immutable
@Serializable
data class ChatLook(val quickReactions: List<String>? = null)

@Immutable
@Serializable
data class ChatPrefsAnswer(val prefs: ChatPrefs = ChatPrefs(), val orgId: String? = null, val foldersOn: Boolean = false)

// ── one conversation ──────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class Audience(val type: String = "", val count: Int = 0)

@Immutable
@Serializable
data class PeerRef(val id: String = "", val name: String = "", val avatarUrl: String? = null, val verified: Boolean = false)

@Immutable
@Serializable
data class PinnedRef(val id: String = "", val authorName: String = "", val preview: String? = null)

@Immutable
@Serializable
data class HeaderSpace(val id: String = "", val name: String = "", val hasExternal: Boolean = false)

/** `GET /api/chat/conversations/[id]/header`: who, what, and what I may do here — no messages, no member list. */
@Immutable
@Serializable
data class ConversationHeader(
    val id: String = "",
    val kind: String = "",
    val title: String = "",
    val emoji: String? = null,
    val topicType: String? = null,
    val postingPolicy: String? = null,
    val restricted: Boolean = false,
    val closed: Boolean = false,
    val space: HeaderSpace? = null,
    val oversightNotice: Boolean? = null,
    val peerLastSeenAt: String? = null,
    val audience: Audience = Audience(),
    val memberCount: Int = 0,
    val peer: PeerRef? = null,
    val pinnedMessages: List<PinnedRef> = emptyList(),
    val me: ConversationMe = ConversationMe(),
    val calls: Boolean? = null,
    val voiceNotes: Boolean? = null,
    val chatAlbums: Boolean? = null,
    val chatOutbox: Boolean? = null,
)

@Immutable
@Serializable
data class Reader(val userId: String = "", val name: String = "", val messageId: String = "", val readAt: String? = null, val avatarUrl: String? = null)

/** `GET .../messages?before|after|around=&limit=`: one window, oldest first. */
@Immutable
@Serializable
data class MessagesPage(
    val messages: List<Message> = emptyList(),
    val hasOlder: Boolean = false,
    val hasNewer: Boolean = false,
    val firstUnreadId: String? = null,
    val readers: List<Reader> = emptyList(),
)

@Immutable
@Serializable
data class Member(val id: String = "", val name: String = "", val online: Boolean = false, val role: String? = null, val avatarUrl: String? = null, val verified: Boolean = false)

/** `GET /api/chat/conversations/[id]?limit=1`: the old detail, read for its people. */
@Immutable
@Serializable
data class ConversationPeople(val members: List<Member> = emptyList(), val mentionables: List<Member> = emptyList())

// ── writing ───────────────────────────────────────────────────────────────────────────────────────────────

/** `POST .../messages` (`sendSchema`): a body or at least one attachment; `clientId` makes it idempotent. */
@Serializable
data class ChatSend(
    val body: String? = null,
    val clientId: String,
    val replyToId: String? = null,
    val replyQuote: String? = null,
    val mentions: List<String>? = null,
    val attachmentIds: List<String>? = null,
    val voice: Boolean? = null,
    val poll: PollDraft? = null,
    val checklist: ChecklistDraft? = null,
    val silent: Boolean? = null,
)

@Serializable
data class PollDraft(val options: List<String>, val multiple: Boolean = false, val anonymous: Boolean = false, val closesInMinutes: Int? = null)

@Serializable
data class ChecklistDraft(val items: List<String>, val othersCanAdd: Boolean = true, val othersCanTick: Boolean = true)

@Serializable
data class EditBody(val body: String)

@Serializable
data class ReactBody(val emoji: String)

@Serializable
data class ReactAnswer(val mine: Boolean = false)

@Serializable
data class PinAnswer(val pinned: Boolean = false)

@Serializable
data class ForwardBody(val conversationId: String)

@Serializable
data class IdAnswer(val id: String = "", val created: Boolean = false)

@Serializable
data class VoteBody(val optionIds: List<String>)

@Serializable
data class TickBody(val done: Boolean)

@Serializable
data class ItemText(val text: String)

@Serializable
data class TypingBody(val conversationId: String)

/** `POST /api/chat/uploads`: the stored file the message claims through `attachmentIds`. */
@Serializable
data class Uploaded(val id: String = "", val kind: String = "", val mime: String = "", val size: Long = 0, val width: Int? = null, val height: Int? = null, val durationMs: Long? = null)

// ── finding and starting chats ────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class ChatHit(val id: String = "", val kind: String = "", val title: String = "", val emoji: String? = null, val context: String? = null)

@Immutable
@Serializable
data class PersonHit(val id: String = "", val name: String = "", val avatarUrl: String? = null, val jobTitle: String? = null, val dmId: String? = null)

@Immutable
@Serializable
data class MessageHit(val id: String = "", val conversationId: String = "", val conversationTitle: String = "", val authorName: String = "", val at: String = "", val snippet: String = "")

@Immutable
@Serializable
data class SearchAnswer(val chats: List<ChatHit> = emptyList(), val people: List<PersonHit> = emptyList(), val messages: List<MessageHit> = emptyList())

@Serializable
data class DmBody(val userId: String? = null, val saved: Boolean? = null)

@Serializable
data class NewGroupBody(val kind: String = "GROUP", val title: String, val emoji: String? = null, val memberIds: List<String>)

@Serializable
data class GroupChange(val title: String? = null, val emoji: String? = null, val addMemberIds: List<String>? = null, val removeMemberIds: List<String>? = null)

@Immutable
@Serializable
data class DirectoryUser(val id: String = "", val name: String = "", val jobTitle: String? = null, val avatarUrl: String? = null)

@Immutable
@Serializable
data class DirectoryPerson(val userId: String = "", val role: String = "", val user: DirectoryUser = DirectoryUser())

@Immutable
@Serializable
data class Directory(val assistant: Boolean = false, val botFather: Boolean = false, val people: List<DirectoryPerson> = emptyList())

@Immutable
@Serializable
data class ForwardTarget(val id: String = "", val kind: String = "", val title: String = "", val emoji: String? = null, val avatarUrl: String? = null, val spaceName: String? = null)

@Immutable
@Serializable
data class ForwardTargets(val targets: List<ForwardTarget> = emptyList(), val recents: List<String> = emptyList())

// ── the live line's catch-up (GET /api/chat/sync) ─────────────────────────────────────────────────────────

@Serializable
data class ReadMark(val conversationId: String = "", val userId: String = "", val lastReadAt: String = "")

@Serializable
data class DeliveredMark(val conversationId: String = "", val userId: String = "", val lastDeliveredAt: String = "")

/** Everything that changed after `cursor`, for this person: send `cursor` back as `after`; `reset`: reload; `more`: ask again at once. */
@Serializable
data class SyncAnswer(
    val cursor: String = "",
    val reset: Boolean = false,
    val more: Boolean = false,
    val messages: List<Message> = emptyList(),
    val reads: List<ReadMark> = emptyList(),
    val delivered: List<DeliveredMark> = emptyList(),
    val rows: List<ChatRow> = emptyList(),
    val removed: List<String> = emptyList(),
    val hidden: List<String> = emptyList(),
)
