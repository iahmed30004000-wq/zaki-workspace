package io.zakiai.workspace.feature.chat

import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Gate
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.ChatList
import io.zakiai.workspace.core.net.ChatRow
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.core.net.MessagesPage
import io.zakiai.workspace.core.net.SyncAnswer
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.core.sync.UserMark
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/** Somebody writing right now in a conversation (the live line's `typing` frame; gone after 6 s or with their message). */
data class Typist(val userId: String, val name: String, val until: Long)

/**
 * THE CHAT AS THE PHONE HOLDS IT — one place for the list and the open conversations, so the live line, a send's answer and a screen
 * never disagree. The list and each conversation's newest window are kept in the cache (the phone opens the chat offline); everything
 * is emptied when the person signs out.
 */
@Singleton
class ChatStore @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val user: UserMark,
    session: Session,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()

    private val _list = MutableStateFlow<ChatList?>(null)
    val list: StateFlow<ChatList?> = _list.asStateFlow()

    private val windows = ConcurrentHashMap<String, MutableStateFlow<ConvWindow>>()

    /** The conversations on screen now: the live line catches these up at once; the others wait until they are opened. */
    private val open = ConcurrentHashMap.newKeySet<String>()

    private val _typing = MutableStateFlow<Map<String, List<Typist>>>(emptyMap())
    val typing: StateFlow<Map<String, List<Typist>>> = _typing.asStateFlow()

    init {
        scope.launch { cache.read(LIST_KEY, ChatList.serializer())?.let { cached -> _list.compareAndSet(null, cached) } }
        scope.launch { session.gate.collect { if (it == Gate.SIGNED_OUT) clear() } }
    }

    private val me: String get() = user.id.orEmpty()

    // ── the list ──────────────────────────────────────────────────────────────────────────────────────────

    suspend fun refreshList(): ApiResult<ChatList> {
        val r = cache.refresh(LIST_KEY, ChatList.serializer()) { apiCall { api.chatList() } }
        if (r is ApiResult.Ok) lock.withLock { _list.value = r.value }
        return r
    }

    /** My own change of a row (pin, archive, mute, unread mark), drawn at once; the server's answer follows through the live line. */
    fun patchRow(id: String, change: (ChatRow) -> ChatRow) {
        _list.update { l -> l?.copy(rows = l.rows.map { if (it.id == id) change(it) else it }) }
    }

    // ── one conversation ──────────────────────────────────────────────────────────────────────────────────

    fun window(id: String): StateFlow<ConvWindow> = flowOf(id).asStateFlow()

    private fun flowOf(id: String) = windows.getOrPut(id) { MutableStateFlow(ConvWindow()) }

    fun opened(id: String) { open.add(id) }

    fun closed(id: String) { open.remove(id) }

    /** What the phone kept of this conversation, while the first answer is on its way. */
    suspend fun warm(id: String) {
        if (flowOf(id).value.loaded) return
        cache.read(windowKey(id), MessagesPage.serializer())?.let { p -> flowOf(id).compareAndSet(ConvWindow(), ChatMerge.fresh(p).copy(loaded = false)) }
    }

    /** The newest window, fresh from the server (kept for an offline opening). */
    suspend fun loadNewest(id: String): ApiResult<MessagesPage> {
        val r = cache.refresh(windowKey(id), MessagesPage.serializer()) { apiCall { api.messages(id) } }
        if (r is ApiResult.Ok) lock.withLock { flowOf(id).value = ChatMerge.fresh(r.value) }
        return r
    }

    /** Scrolling up: the page before the oldest message on the phone. */
    suspend fun loadOlder(id: String): ApiResult<MessagesPage>? {
        val w = flowOf(id).value
        val first = w.messages.firstOrNull() ?: return null
        if (!w.hasOlder) return null
        val r = apiCall { api.messages(id, before = first.id) }
        if (r is ApiResult.Ok) lock.withLock { flowOf(id).update { ChatMerge.page(it, r.value, older = true) } }
        return r
    }

    /** Everything after the newest message on the phone (after a jump, or a catch-up of the live line), a few pages at most. */
    suspend fun loadNewer(id: String) {
        repeat(4) {
            val last = flowOf(id).value.messages.lastOrNull() ?: return
            val r = apiCall { api.messages(id, after = last.id) }
            if (r !is ApiResult.Ok) return
            lock.withLock { flowOf(id).update { ChatMerge.page(it, r.value, older = false) } }
            if (!r.value.hasNewer || r.value.messages.isEmpty()) return
        }
    }

    /** A message the server answered with (a send, an edit, a vote, a tick): it replaces the phone's copy of the same id. */
    fun put(conversationId: String, m: Message) {
        flowOf(conversationId).update { ChatMerge.window(it, listOf(m)) }
        _typing.update { t -> t[conversationId]?.let { list -> t + (conversationId to list.filter { it.userId != m.authorId }) } ?: t }
    }

    /** A jump: the window around one message replaces the phone's (it may not reach the newest message: `hasNewer`). */
    fun replace(conversationId: String, w: ConvWindow) { flowOf(conversationId).value = w }

    fun hide(conversationId: String, messageId: String) {
        flowOf(conversationId).update { ChatMerge.window(it, emptyList(), listOf(messageId)) }
    }

    // ── what the live line brings ─────────────────────────────────────────────────────────────────────────

    /**
     * One catch-up answer. A message already on the phone is replaced in place (an edit, a reaction, a deletion); a new one goes to the
     * conversation the live line's frame named ([placed]: message id → conversation id); a conversation on screen whose row changed is
     * caught up with `after=` its newest message, so a burst of messages is never drawn out of order.
     */
    suspend fun apply(s: SyncAnswer, placed: Map<String, String>) {
        val catchUp = HashSet<String>()
        lock.withLock {
            val removed = s.removed.toHashSet()
            for (id in removed) windows.remove(id)
            val index = HashMap<String, String>()
            for ((conv, flow) in windows) for (m in flow.value.messages) index[m.id] = conv
            val hidden = s.hidden.toHashSet()
            for (m in s.messages) {
                val conv = index[m.id] ?: placed[m.id] ?: continue
                if (conv in removed) continue
                windows[conv]?.update { ChatMerge.window(it, listOf(m)) }
            }
            if (hidden.isNotEmpty()) for ((_, flow) in windows) flow.update { ChatMerge.window(it, emptyList(), hidden) }
            for (r in s.reads) windows[r.conversationId]?.update { ChatMerge.marks(it, r.userId, null, r.lastReadAt, read = true, me = me) }
            for (d in s.delivered) windows[d.conversationId]?.update { ChatMerge.marks(it, d.userId, null, d.lastDeliveredAt, read = false, me = me) }
            _list.update { l -> l?.copy(rows = ChatMerge.rows(l.rows, s.rows, removed, l.scope, l.spaceId)) }
            for (r in s.rows) if (r.kind != "SPACE" && r.id in open && windows[r.id]?.value?.loaded == true) catchUp.add(r.id)
            // a message arrived: whoever wrote it stopped typing
            val authors = s.messages.map { it.authorId }.toHashSet()
            if (authors.isNotEmpty()) _typing.update { t -> t.mapValues { (_, list) -> list.filter { it.userId !in authors } } }
        }
        for (id in catchUp) loadNewer(id)
        _list.value?.let { l -> if (s.rows.isNotEmpty() || s.removed.isNotEmpty()) cache.refresh(LIST_KEY, ChatList.serializer()) { ApiResult.Ok(l) } }
    }

    /** The live line lost too much (`reload`, or a catch-up `reset`): the list and the conversations on screen are fetched again. */
    suspend fun reloadAll() {
        refreshList()
        for (id in open.toList()) loadNewest(id)
    }

    fun typing(conversationId: String, userId: String, name: String) {
        if (userId == me) return
        val until = System.currentTimeMillis() + 6_000
        _typing.update { t ->
            val list = t[conversationId].orEmpty().filter { it.userId != userId && it.until > System.currentTimeMillis() } + Typist(userId, name, until)
            t + (conversationId to list)
        }
    }

    private fun clear() {
        _list.value = null
        windows.clear()
        open.clear()
        _typing.value = emptyMap()
    }

    companion object {
        const val LIST_KEY = "chat-list"
        fun windowKey(id: String) = "chat-window:$id"
    }
}
