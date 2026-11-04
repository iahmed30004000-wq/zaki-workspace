package io.zakiai.workspace

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/**
 * What the site's API answers, only the fields the app draws (the server's own types: src/server/chat/dto.ts). A field the server adds later is
 * ignored; a field the server leaves out takes its default here, so an older or newer server never crashes the app.
 */
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
data class Space(
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
data class Home(val spaces: List<Space> = emptyList(), val dms: List<Dm> = emptyList())

@Immutable
@Serializable
data class Attachment(val id: String = "", val kind: String = "FILE", val name: String = "", val url: String = "")

@Immutable
@Serializable
data class Message(
    val id: String,
    val kind: String = "TEXT",
    val body: String? = null,
    val deleted: Boolean = false,
    val mine: Boolean = false,
    val authorName: String = "",
    val createdAt: String = "",
    val attachments: List<Attachment> = emptyList(),
)

@Immutable
@Serializable
data class ConversationMe(val canPost: Boolean = true, val canCall: Boolean? = null)

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
data class LoginResult(val ok: Boolean = false, val next: String = "/")

@Serializable
data class DeviceKey(val id: String = "", val token: String = "")

@Serializable
data class CallStarted(val id: String = "", val created: Boolean = false)

@Serializable
data class UnreadTotal(val total: Int = 0)

@Serializable
data class SendBody(val body: String, val clientId: String)

@Serializable
data class LoginBody(val identifier: String, val password: String)

@Serializable
data class StartCallBody(val video: Boolean = false, val ring: Boolean = true)

@Serializable
data class DeviceBody(val name: String)

@Serializable
data class ReadAll(val all: Boolean = true)

@Serializable
data class ReadOne(val id: String)
