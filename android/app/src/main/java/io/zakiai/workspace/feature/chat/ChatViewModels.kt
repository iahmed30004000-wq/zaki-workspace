package io.zakiai.workspace.feature.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Loadable
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.db.OutboxDao
import io.zakiai.workspace.core.db.OutboxItem
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.ChatHome
import io.zakiai.workspace.core.net.Conversation
import io.zakiai.workspace.core.net.SendBody
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.core.sync.OutboxWorker
import io.zakiai.workspace.core.sync.Schedules
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.util.UUID
import javax.inject.Inject

/**
 * The chat list: the topics of the person's spaces and their private chats. It opens with the last list the phone kept, then
 * refreshes (every 15 seconds while it is on screen — N1 replaces the polling with the live line).
 */
@HiltViewModel
class ChatListViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
) : ViewModel() {
    private val _state = MutableStateFlow(Loadable<ChatHome>())
    val state: StateFlow<Loadable<ChatHome>> = _state.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, ChatHome.serializer())?.let { cached -> if (_state.value.data == null) _state.value = _state.value.copy(data = cached) } }
    }

    fun refresh() {
        if (_state.value.refreshing) return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            when (val r = cache.refresh(KEY, ChatHome.serializer()) { apiCall { api.chatHome() } }) {
                is ApiResult.Ok -> _state.value = Loadable(r.value)
                is ApiResult.Err -> {
                    if (r.failure.signedOut) session.expired(r.failure)
                    _state.value = _state.value.copy(failure = r.failure, refreshing = false)
                }
            }
        }
    }

    companion object { const val KEY = "chat-home" }
}

/** One line of the conversation as drawn: a message of the server, or one of the outbox (waiting, or refused). */
data class Line(
    val id: String,
    val body: String?,
    val mine: Boolean,
    val authorName: String,
    val createdAt: String,
    val kind: String = "TEXT",
    val deleted: Boolean = false,
    val attachments: List<io.zakiai.workspace.core.net.Attachment> = emptyList(),
    /** null: on the server · "waiting": in the outbox · "refused": the server said no */
    val outbox: String? = null,
)

/**
 * One conversation. Opens with what the phone kept, refreshes every 5 seconds while on screen, marks it read when a new message
 * arrives. Sending puts the message in the OUTBOX first (it shows at once, «بيستنى النت» while offline) and the outbox sends it
 * with its `clientId` — the server's idempotency key — so a retry never doubles it.
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
    private val outbox: OutboxDao,
    private val schedules: Schedules,
    private val json: Json,
) : ViewModel() {
    val id: String = checkNotNull(savedState["id"])
    private val key = "conversation:$id"

    private val _state = MutableStateFlow(Loadable<Conversation>())
    val state: StateFlow<Loadable<Conversation>> = _state.asStateFlow()

    /** The rows of this conversation still in the outbox. */
    val pending: StateFlow<List<OutboxItem>> =
        outbox.watch(OutboxWorker.KIND_CHAT_SEND, id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private var lastRead = ""

    private val _calling = MutableStateFlow(false)
    val calling: StateFlow<Boolean> = _calling.asStateFlow()

    init {
        viewModelScope.launch { cache.read(key, Conversation.serializer())?.let { if (_state.value.data == null) _state.value = _state.value.copy(data = it) } }
    }

    fun refresh() {
        if (_state.value.refreshing) return
        _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            when (val r = cache.refresh(key, Conversation.serializer()) { apiCall { api.conversation(id) } }) {
                is ApiResult.Ok -> {
                    _state.value = Loadable(r.value)
                    val last = r.value.messages.lastOrNull()
                    if (last != null && last.id != lastRead) {
                        lastRead = last.id
                        apiCall { api.markRead(id) }
                    }
                }
                is ApiResult.Err -> {
                    if (r.failure.signedOut) session.expired(r.failure)
                    _state.value = _state.value.copy(failure = r.failure, refreshing = false)
                }
            }
        }
    }

    fun send(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        viewModelScope.launch {
            outbox.add(
                OutboxItem(
                    clientId = clientId,
                    kind = OutboxWorker.KIND_CHAT_SEND,
                    target = id,
                    payload = json.encodeToString(SendBody.serializer(), SendBody(body, clientId)),
                    createdAt = System.currentTimeMillis(),
                ),
            )
            schedules.flushOutbox()
        }
    }

    /** «شارك بالمحادثة»: the owner reading in silence joins the topic, so the owner may post. */
    fun join() = viewModelScope.launch {
        when (val r = apiCall { api.join(id) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _state.value = _state.value.copy(failure = r.failure)
        }
    }

    fun retry(clientId: String) = viewModelScope.launch { outbox.retry(clientId); schedules.flushOutbox() }

    fun discard(clientId: String) = viewModelScope.launch { outbox.remove(clientId) }

    fun startCall(onStarted: (String) -> Unit) {
        if (_calling.value) return
        _calling.value = true
        viewModelScope.launch {
            when (val r = apiCall { api.startCall(id) }) {
                is ApiResult.Ok -> onStarted(r.value.id)
                is ApiResult.Err -> _state.value = _state.value.copy(failure = r.failure)
            }
            _calling.value = false
        }
    }

    /** The lines as drawn: the server's messages, then what still waits in the outbox (a sent row leaves the outbox by itself). */
    fun linesOf(conv: Conversation?, waiting: List<OutboxItem>): List<Line> {
        val server = conv?.messages.orEmpty().map { m ->
            Line(m.id, m.body, m.mine, m.authorName, m.createdAt, m.kind, m.deleted, m.attachments)
        }
        val onServer = conv?.messages.orEmpty().mapNotNullTo(HashSet()) { it.clientId }
        val local = waiting.filter { it.clientId !in onServer }.map { o ->
            val body = runCatching { json.decodeFromString(SendBody.serializer(), o.payload).body }.getOrNull()
            Line("outbox-${o.clientId}", body, true, "", java.time.Instant.ofEpochMilli(o.createdAt).toString(), outbox = if (o.refusedKey != null) "refused" else "waiting")
        }
        return server + local
    }
}
