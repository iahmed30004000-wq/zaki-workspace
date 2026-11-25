package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * What the site's API answers — only the fields the app draws (the server's own types: src/server/chat/dto.ts, the route files).
 * A field the server adds later is ignored; a field it leaves out takes its default here, so an older or newer server never crashes the app.
 */

// ── who is signed in ──────────────────────────────────────────────────────────────────────────────────────

@Serializable
data class LoginBody(val identifier: String, val password: String)

/** `next` is "/onboarding" while a temporary password or the transparency notice is still owed. */
@Serializable
data class LoginResult(val ok: Boolean = false, val next: String = "/")

@Immutable
@Serializable
data class Me(
    val id: String = "",
    val username: String? = null,
    val email: String? = null,
    val name: String = "",
    val jobTitle: String? = null,
    val theme: String? = null,
    val avatarUrl: String? = null,
    val hue: Int? = null,
    val mustChangePassword: Boolean = false,
    val transparencyPending: Boolean = false,
)

@Serializable
data class MeAnswer(val user: Me = Me())

@Serializable
data class PasswordChangeBody(val currentPassword: String, val newPassword: String)

@Serializable
data class AcceptBody(val accept: Boolean = true)

@Serializable
data class ThemeBody(val theme: String)

@Serializable
data class Ok(val ok: Boolean = false)

// ── the spaces (the drawer's switcher) ────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class SpaceEntry(
    val id: String,
    val name: String = "",
    val emoji: String? = null,
    val holdsProjects: Boolean = true,
    val unread: Int = 0,
    val overdue: Int = 0,
    val waiting: Int? = null,
)

@Immutable
@Serializable
data class OrgEntry(
    val id: String,
    val name: String = "",
    val role: String = "MEMBER",
    val canCreateSpaces: Boolean = false,
    val workspaces: List<SpaceEntry> = emptyList(),
)

@Immutable
@Serializable
data class Spaces(val currentSpaceId: String? = null, val waiting: Int = 0, val organizations: List<OrgEntry> = emptyList())

// ── the phone as a device of the person (the live line's key) ─────────────────────────────────────────────

@Serializable
data class DeviceBody(val name: String)

@Serializable
data class DeviceKey(val id: String = "", val token: String = "")

// ── chat ──────────────────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class LastMessage(val at: String? = null, val preview: String? = null, val mine: Boolean = false)

@Immutable
@Serializable
data class Topic(
    val id: String,
    val title: String = "",
    val emoji: String? = null,
    val unread: Int = 0,
    val mentions: Int = 0,
    val closed: Boolean = false,
    val archived: Boolean = false,
    val lastMessage: LastMessage? = null,
)

@Immutable
@Serializable
data class ChatSpace(
    val id: String,
    val name: String = "",
    val emoji: String? = null,
    val unread: Int = 0,
    val topics: List<Topic> = emptyList(),
)

@Immutable
@Serializable
data class Peer(val id: String = "", val name: String = "")

@Immutable
@Serializable
data class Dm(val id: String, val peer: Peer = Peer(), val unread: Int = 0, val lastMessage: LastMessage? = null)

@Immutable
@Serializable
data class ChatHome(val spaces: List<ChatSpace> = emptyList(), val dms: List<Dm> = emptyList())

/** `AttachmentDto`: `id` is the attachment's own row (its `url` is `/api/chat/attachments/<id>`, streamed after the same permission check). */
@Immutable
@Serializable
data class Attachment(
    val id: String = "",
    val kind: String = "FILE", // IMAGE · VIDEO · AUDIO · FILE
    val name: String = "",
    val mime: String = "",
    val size: Long = 0,
    val width: Int? = null,
    val height: Int? = null,
    val durationMs: Long? = null,
    val peaks: List<Int>? = null,
    val url: String = "",
)

/** `MessageDto` (src/server/chat/dto.ts): one message as the server presents it to THIS person. */
@Immutable
@Serializable
data class Message(
    val id: String,
    val kind: String = "TEXT", // TEXT · VOICE · SYSTEM · POLL · CARD · CHECKLIST
    val body: String? = null,
    val deleted: Boolean = false,
    val edited: Boolean = false,
    val pinned: Boolean = false,
    val mine: Boolean = false,
    val authorId: String = "",
    val authorName: String = "",
    val authorAvatar: String? = null,
    val authorVerified: Boolean = false,
    val createdAt: String = "",
    /** the sender's idempotency key: lets the app drop its outbox copy once the server has the message */
    val clientId: String? = null,
    val replyTo: ReplyRef? = null,
    val forwardedFrom: ForwardRef? = null,
    val mentions: List<String> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val reactions: List<Reaction> = emptyList(),
    /** a private chat, my own message: sent · delivered · read */
    val status: String? = null,
    val system: SystemMeta? = null,
    val poll: Poll? = null,
    val checklist: Checklist? = null,
    val preview: LinkPreview? = null,
    val silent: Boolean = false,
    val mustRead: MustRead? = null,
)

@Immutable
@Serializable
data class ConversationMe(
    val canPost: Boolean = true,
    val canModerate: Boolean = false,
    val muted: Boolean = false,
    val canCall: Boolean? = null,
    /** the OWNER in silent oversight of an open topic may join it to post («شارك بالمحادثة») */
    val canJoin: Boolean = false,
    val oversight: Boolean = false,
    val canMentionAll: Boolean = false,
    val canPoll: Boolean = false,
    val canChecklist: Boolean = false,
    val id: String? = null,
)

@Immutable
@Serializable
data class Conversation(
    val id: String,
    val kind: String = "",
    val title: String = "",
    val emoji: String? = null,
    val closed: Boolean = false,
    val me: ConversationMe = ConversationMe(),
    val calls: Boolean? = null,
    val messages: List<Message> = emptyList(),
)

/** `clientId` makes a send idempotent: the same id sent twice is one message (the outbox relies on it). */
@Serializable
data class SendBody(val body: String, val clientId: String)

@Serializable
data class StartCallBody(val video: Boolean = false, val ring: Boolean = true)

@Serializable
data class CallStarted(val id: String = "", val created: Boolean = false)

@Serializable
data class UnreadTotal(val total: Int = 0)

// ── notifications ─────────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class NotificationItem(
    val id: String,
    val type: String = "",
    val title: String = "",
    val body: String? = null,
    val linkUrl: String? = null,
    val readAt: String? = null,
    val createdAt: String = "",
)

@Immutable
@Serializable
data class Notifications(val items: List<NotificationItem> = emptyList(), val unreadCount: Int = 0)

@Serializable
data class ReadAll(val all: Boolean = true)

@Serializable
data class ReadOne(val id: String)

// ── crash reports (POST /api/client-errors) ───────────────────────────────────────────────────────────────

@Serializable
data class ClientErrorReport(
    val kind: String, // CRASH · ANR · ERROR
    val message: String,
    val stack: String? = null,
    val screen: String? = null,
    val appVersion: String,
    val versionCode: Int? = null,
    val device: String? = null,
    val osVersion: String? = null,
    val occurredAt: String,
)

@Serializable
data class ClientErrorBatch(val reports: List<ClientErrorReport>)
