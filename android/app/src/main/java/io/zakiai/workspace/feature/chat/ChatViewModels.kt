package io.zakiai.workspace.feature.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.db.OutboxDao
import io.zakiai.workspace.core.db.OutboxItem
import io.zakiai.workspace.core.live.LiveLine
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.core.net.ChatPrefsAnswer
import io.zakiai.workspace.core.net.ChatRow
import io.zakiai.workspace.core.net.ChatSend
import io.zakiai.workspace.core.net.ConversationHeader
import io.zakiai.workspace.core.net.DmBody
import io.zakiai.workspace.core.net.EditBody
import io.zakiai.workspace.core.net.ForwardBody
import io.zakiai.workspace.core.net.ForwardTarget
import io.zakiai.workspace.core.net.ItemText
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.core.net.MyChatState
import io.zakiai.workspace.core.net.ReactBody
import io.zakiai.workspace.core.net.SearchAnswer
import io.zakiai.workspace.core.net.TickBody
import io.zakiai.workspace.core.net.TypingBody
import io.zakiai.workspace.core.net.VoteBody
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.core.sync.Outbox
import io.zakiai.workspace.core.sync.OutboxWorker
import io.zakiai.workspace.core.sync.UserMark
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.time.Instant
import javax.inject.Inject

/**
 * The chat list: every space's topics and the private chats (`/api/chat/list`), the person's folders (`/api/me/chat-prefs`), my own
 * pin / archive / mute / unread mark, and the search. The live line keeps it current; while it is down the list asks every 15 s.
 */
@HiltViewModel
class ChatListViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val store: ChatStore,
    private val session: Session,
    private val cache: Cache,
    val live: LiveLine,
) : ViewModel() {
    val list = store.list

    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()

    private val _prefs = MutableStateFlow<ChatPrefsAnswer?>(null)
    val prefs: StateFlow<ChatPrefsAnswer?> = _prefs.asStateFlow()

    private val _search = MutableStateFlow<SearchAnswer?>(null)
    val search: StateFlow<SearchAnswer?> = _search.asStateFlow()
    private var searching: Job? = null

    private var refreshing = false

    init {
        viewModelScope.launch { cache.read(PREFS_KEY, ChatPrefsAnswer.serializer())?.let { _prefs.compareAndSet(null, it) } }
        viewModelScope.launch {
            (cache.refresh(PREFS_KEY, ChatPrefsAnswer.serializer()) { apiCall { api.chatPrefs() } } as? ApiResult.Ok)?.let { _prefs.value = it.value }
        }
    }

    fun refresh() {
        if (refreshing) return
        refreshing = true
        viewModelScope.launch {
            when (val r = store.refreshList()) {
                is ApiResult.Ok -> _failure.value = null
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
            }
            refreshing = false
        }
    }

    /** My own state of a row, drawn at once; the server's answer is the truth (a refusal is undone and said). */
    fun setState(row: ChatRow, change: MyChatState, unmute: Boolean = false) {
        val before = row
        store.patchRow(row.id) {
            it.copy(
                pinnedByMe = change.pinned ?: it.pinnedByMe,
                archivedByMe = change.archived ?: it.archivedByMe,
                markedUnread = change.markedUnread ?: it.markedUnread,
                muted = when { unmute -> false; change.mutedUntil != null -> true; else -> it.muted },
            )
        }
        viewModelScope.launch {
            // «إلغاء الكتم» is `mutedUntil: null` written out (the app's JSON leaves nulls out everywhere else)
            val r = if (unmute) apiCall { api.myStateRaw(row.id, kotlinx.serialization.json.buildJsonObject { put("mutedUntil", kotlinx.serialization.json.JsonNull) }) }
            else apiCall { api.myState(row.id, change) }
            if (r is ApiResult.Err) { store.patchRow(row.id) { before }; _failure.value = r.failure }
        }
    }

    fun markRead(row: ChatRow) {
        val last = row.lastMessage?.id ?: return
        store.patchRow(row.id) { it.copy(unread = 0, mentionsUnread = 0, markedUnread = false) }
        viewModelScope.launch { apiCall { api.readUpTo(row.id, last) } }
    }

    fun search(q: String) {
        searching?.cancel()
        val text = q.trim()
        if (text.length < 2) { _search.value = null; return }
        searching = viewModelScope.launch {
            delay(300)
            (apiCall { api.search(text) } as? ApiResult.Ok)?.let { _search.value = it.value }
        }
    }

    /** A person from the search: their private chat, opened (or made) in the current space. */
    fun openDm(userId: String, then: (String) -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.openDm(DmBody(userId = userId)) }) {
            is ApiResult.Ok -> then(r.value.id)
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun openSaved(then: (String) -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.openDm(DmBody(saved = true)) }) {
            is ApiResult.Ok -> then(r.value.id)
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun dismissFailure() { _failure.value = null }

    companion object {
        const val PREFS_KEY = "chat-prefs"
        /** The mute of «forever»: the site's own far date. */
        const val FOREVER = "9999-12-31T00:00:00.000Z"
        fun muteFor(hours: Long): String = Instant.now().plusSeconds(hours * 3600).toString()
    }
}

/** One line of the conversation as drawn: a message of the server, or one of the outbox (waiting, refused, or sent and not fetched). */
data class Line(
    val id: String,
    val message: Message,
    /** null: on the server · "waiting": in the outbox · "refused": the server said no */
    val outbox: String? = null,
)

/** What the composer is doing to a message: answering it, or editing it. */
sealed interface ComposeMode {
    data object New : ComposeMode
    data class Reply(val to: Message) : ComposeMode
    data class Edit(val of: Message) : ComposeMode
}

/**
 * ONE CONVERSATION. Opens with what the phone kept, fetches the newest window, pages older ones while the person scrolls up, follows
 * the live line, and moves the read mark as the newest message comes on screen. Sending goes through the OUTBOX (shown at once, the
 * clock while offline) with the server's idempotency key, so a retry never doubles a message.
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val api: WorkspaceApi,
    private val store: ChatStore,
    private val session: Session,
    private val user: UserMark,
    outboxDao: OutboxDao,
    private val outbox: Outbox,
    private val json: Json,
    val live: LiveLine,
    private val cache: Cache,
    val files: ChatFiles,
) : ViewModel() {
    val id: String = checkNotNull(savedState["id"])
    /** the message to open on (a notification, a search hit), once */
    private var at: String? = savedState.get<String>("at")?.takeIf { it.isNotBlank() }

    val window: StateFlow<ConvWindow> = store.window(id)
    val typing = store.typing

    private val _header = MutableStateFlow<ConversationHeader?>(null)
    val header: StateFlow<ConversationHeader?> = _header.asStateFlow()

    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()

    /** A one-time thing to say (a refusal of an action): shown as a short line, then cleared. */
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _mode = MutableStateFlow<ComposeMode>(ComposeMode.New)
    val mode: StateFlow<ComposeMode> = _mode.asStateFlow()

    /** The message to scroll to (a jump): the screen scrolls, then clears it. */
    private val _focus = MutableStateFlow<String?>(null)
    val focus: StateFlow<String?> = _focus.asStateFlow()

    /** The rows of this conversation still in the outbox. */
    val pending: StateFlow<List<OutboxItem>> =
        outboxDao.watch(OutboxWorker.KIND_CHAT_SEND, id).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val me: String get() = user.id.orEmpty()

    private var readUpTo = ""
    private var loadingOlder = false
    private var lastTyping = 0L

    init {
        store.opened(id)
        viewModelScope.launch {
            cache.read(headerKey, ConversationHeader.serializer())?.let { _header.compareAndSet(null, it) }
            store.warm(id)
        }
        open()
    }

    private val headerKey get() = ChatStore.headerKey(id)

    private fun open() = viewModelScope.launch {
        launch { refreshHeader() }
        val target = at
        if (target != null) jumpTo(target) else refresh()
    }

    fun refreshHeader() = viewModelScope.launch {
        when (val r = cache.refresh(headerKey, ConversationHeader.serializer()) { apiCall { api.header(id) } }) {
            is ApiResult.Ok -> _header.value = r.value
            is ApiResult.Err -> when {
                r.failure.signedOut -> session.expired(r.failure)
                // the person can no longer read it (left, made private): what the phone kept of it goes, the screen says why
                r.failure.status == 403 || r.failure.status == 404 -> { store.forget(id); _header.value = null; _failure.value = r.failure }
                _header.value == null -> _failure.value = r.failure
            }
        }
    }

    /** The newest window again (the screen's fallback while the live line is down, and a pull). */
    fun refresh() = viewModelScope.launch {
        when (val r = store.loadNewest(id)) {
            is ApiResult.Ok -> {
                _failure.value = null
                // the sent outbox copies whose message the server now shows are no longer needed
                val onServer = r.value.messages.mapNotNullTo(HashSet()) { it.clientId }
                outbox.seen(pending.value.filter { it.sentAt != null && it.clientId in onServer }.map { it.clientId })
            }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
    }

    /** Scrolled near the top: the page before. */
    fun older() {
        if (loadingOlder || !window.value.hasOlder) return
        loadingOlder = true
        viewModelScope.launch { store.loadOlder(id); loadingOlder = false }
    }

    /** Scrolled to the bottom of a window that does not reach the newest message (after a jump). */
    fun newer() = viewModelScope.launch { store.loadNewer(id) }

    /** A reply's quote, a pinned message, a search hit: the window around it, then the screen scrolls there. */
    fun jumpTo(messageId: String) = viewModelScope.launch {
        at = null
        if (window.value.messages.any { it.id == messageId }) { _focus.value = messageId; return@launch }
        when (val r = apiCall { api.messages(id, around = messageId) }) {
            is ApiResult.Ok -> { store.replace(id, ChatMerge.fresh(r.value)); _focus.value = messageId }
            is ApiResult.Err -> { if (window.value.messages.isEmpty()) refresh(); _notice.value = r.failure.message }
        }
    }

    fun focused() { _focus.value = null }

    /** The newest message on screen moved: the read mark follows it (never back, one call per message). */
    fun seen(messageId: String) {
        if (messageId == readUpTo || messageId.startsWith("outbox-")) return
        val w = window.value.messages
        val newIdx = w.indexOfFirst { it.id == messageId }
        val oldIdx = w.indexOfFirst { it.id == readUpTo }
        if (newIdx < 0 || (oldIdx >= 0 && newIdx <= oldIdx)) return
        readUpTo = messageId
        viewModelScope.launch { apiCall { api.readUpTo(id, messageId) } }
    }

    // ── writing ───────────────────────────────────────────────────────────────────────────────────────────

    fun reply(m: Message) { _mode.value = ComposeMode.Reply(m) }

    fun edit(m: Message) { _mode.value = ComposeMode.Edit(m) }

    fun cancelMode() { _mode.value = ComposeMode.New }

    /** Typing: the others see «… عم يكتب», at most once every 3 seconds (the server's own pace). */
    fun typing() {
        val now = System.currentTimeMillis()
        if (now - lastTyping < 3_000) return
        lastTyping = now
        viewModelScope.launch { apiCall { api.typing(TypingBody(id)) } }
    }

    fun send(text: String, attachmentIds: List<String> = emptyList(), voice: Boolean = false) {
        val body = text.trim()
        when (val m = _mode.value) {
            is ComposeMode.Edit -> {
                if (body.isEmpty() || body == m.of.body) { cancelMode(); return }
                _mode.value = ComposeMode.New
                viewModelScope.launch {
                    when (val r = apiCall { api.edit(m.of.id, EditBody(body)) }) {
                        is ApiResult.Ok -> store.put(id, r.value)
                        is ApiResult.Err -> _notice.value = r.failure.message
                    }
                }
            }
            else -> {
                if (body.isEmpty() && attachmentIds.isEmpty()) return
                val replyTo = (m as? ComposeMode.Reply)?.to?.id
                _mode.value = ComposeMode.New
                outbox.sendChat(id) { clientId ->
                    ChatSend(
                        body = body.ifEmpty { null },
                        clientId = clientId,
                        replyToId = replyTo,
                        attachmentIds = attachmentIds.ifEmpty { null },
                        voice = if (voice) true else null,
                    )
                }
            }
        }
    }

    /** A poll or a list: sent as one message through the outbox, like any other. */
    fun sendRich(draft: (String) -> ChatSend) { outbox.sendChat(id, draft) }

    fun react(m: Message, emoji: String) = act { apiCall { api.react(m.id, ReactBody(emoji)) }.also { if (it is ApiResult.Ok) refreshOne(m) } }

    fun pin(m: Message) = act { apiCall { api.pin(m.id) }.also { if (it is ApiResult.Ok) { refreshHeader(); refreshOne(m) } } }

    fun deleteForAll(m: Message) = act { apiCall { api.deleteForAll(m.id) }.also { if (it is ApiResult.Ok) store.put(id, m.copy(deleted = true, body = null, attachments = emptyList(), reactions = emptyList())) } }

    fun deleteForMe(m: Message) = act { apiCall { api.hideForMe(m.id) }.also { if (it is ApiResult.Ok) store.hide(id, m.id) } }

    fun vote(m: Message, optionIds: List<String>) = act { apiCall { api.vote(m.id, VoteBody(optionIds)) }.also { if (it is ApiResult.Ok) store.put(id, it.value) } }

    fun closePoll(m: Message) = act { apiCall { api.closePoll(m.id) }.also { if (it is ApiResult.Ok) store.put(id, it.value) } }

    fun tick(m: Message, itemId: String, done: Boolean) = act { apiCall { api.tick(m.id, itemId, TickBody(done)) }.also { if (it is ApiResult.Ok) store.put(id, it.value) } }

    fun addItem(m: Message, text: String) = act { apiCall { api.addItem(m.id, ItemText(text)) }.also { if (it is ApiResult.Ok) store.put(id, it.value) } }

    fun forward(m: Message, target: ForwardTarget, then: () -> Unit) = act {
        apiCall { api.forward(m.id, ForwardBody(target.id)) }.also { if (it is ApiResult.Ok) then() }
    }

    private val _targets = MutableStateFlow<List<ForwardTarget>?>(null)
    val targets: StateFlow<List<ForwardTarget>?> = _targets.asStateFlow()

    fun loadTargets() = viewModelScope.launch {
        when (val r = apiCall { api.forwardTargets() }) {
            is ApiResult.Ok -> _targets.value = r.value.targets
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    /** «شارك بالمحادثة»: the owner reading in silence joins the topic, so the owner may post. */
    fun join() = act { apiCall { api.join(id) }.also { if (it is ApiResult.Ok) refreshHeader() } }

    fun retry(clientId: String) = outbox.retry(clientId)

    fun discard(clientId: String) = outbox.discard(clientId)

    fun consumeNotice() { _notice.value = null }

    private val _calling = MutableStateFlow(false)
    val calling: StateFlow<Boolean> = _calling.asStateFlow()

    /**
     * Starts (or joins) the conversation's call. As on the site's call button: a DM always rings, a group or a topic rings everybody only
     * when asked (`ring`), else people see the join bar.
     */
    fun startCall(video: Boolean = false, ring: Boolean? = null, onStarted: (String) -> Unit) {
        if (_calling.value) return
        _calling.value = true
        val dm = header.value?.kind == "DM"
        viewModelScope.launch {
            when (val r = apiCall { api.startCall(id, io.zakiai.workspace.core.net.StartCallBody(video = video, ring = dm || ring == true)) }) {
                is ApiResult.Ok -> onStarted(r.value.id)
                is ApiResult.Err -> _notice.value = r.failure.message
            }
            _calling.value = false
        }
    }

    /** An action whose answer is not the message itself (a reaction, a pin): the message is fetched again around itself. */
    private suspend fun refreshOne(m: Message) {
        (apiCall { api.messages(id, around = m.id, limit = 3) } as? ApiResult.Ok)?.let { p -> p.value.messages.forEach { store.put(id, it) } }
    }

    private fun act(block: suspend () -> ApiResult<*>) = viewModelScope.launch {
        val r = block()
        if (r is ApiResult.Err) { if (r.failure.signedOut) session.expired(r.failure) else _notice.value = r.failure.message }
    }

    /** The lines as drawn: [ChatLines.of] with this conversation's window and its outbox rows. */
    fun linesOf(messages: List<Message>, rows: List<OutboxItem>): List<Line> = ChatLines.of(messages, rows, me) { payload ->
        runCatching { json.decodeFromString(ChatSend.serializer(), payload) }.getOrNull()
    }

    override fun onCleared() {
        store.closed(id)
        super.onCleared()
    }
}

/** How the server's messages and the outbox rows become one list. Pure (unit-tested). */
object ChatLines {
    /**
     * The server's messages, then every outbox row the server does not show yet: waiting (the clock), refused (retry / delete), or
     * already sent but not fetched — drawn as a plain message, so it never disappears from the screen in between.
     */
    fun of(messages: List<Message>, rows: List<OutboxItem>, me: String, draftOf: (String) -> ChatSend?): List<Line> {
        val server = messages.map { Line(it.id, it) }
        val onServer = messages.mapNotNullTo(HashSet()) { it.clientId }
        val local = rows.filter { it.clientId !in onServer }.map { o ->
            val state = when {
                o.refusedKey != null -> "refused"
                o.sentAt != null -> null
                else -> "waiting"
            }
            val draft = draftOf(o.payload)
            val m = Message(
                id = "outbox-${o.clientId}",
                // a message with no words still says what it carries while it waits (never an empty bubble)
                body = draft?.body ?: when {
                    draft?.voice == true -> "🎤 " + C.voiceNote
                    !draft?.attachmentIds.isNullOrEmpty() -> "📎 " + C.attachments
                    else -> null
                },
                mine = true,
                authorId = me,
                createdAt = Instant.ofEpochMilli(o.createdAt).toString(),
                clientId = o.clientId,
                replyTo = null,
            )
            Line(m.id, m, outbox = state)
        }
        return server + local
    }
}

/** An attachment's place in the bubble: the pictures and videos together (an album), the rest one under another. */
fun Message.media(): List<Attachment> = attachments.filter { it.kind == "IMAGE" || it.kind == "VIDEO" }
fun Message.files(): List<Attachment> = attachments.filter { it.kind != "IMAGE" && it.kind != "VIDEO" }
