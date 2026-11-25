package io.zakiai.workspace.core.live

import io.zakiai.workspace.Config
import io.zakiai.workspace.core.Gate
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.Sentences
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.chat.ChatStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * THE LIVE LINE WHILE THE APP IS OPEN — the same stream the website listens to (`GET /api/rt`, the session cookie). Its frames carry
 * ids only, never a word of a message: each frame asks the catch-up (`GET /api/chat/sync?after=<cursor>`, batched over 120 ms) for what
 * changed, presented for this person by the server. A `typing` frame is drawn at once. The stream comes back after a drop with
 * `Last-Event-ID`, so nothing in between is lost (the server replays 48 h; more than that is a `reload`).
 *
 * It runs only while the app is on screen ([start] / [stop] from the activity); a closed app hears its notifications through the
 * device's own line (StreamService). While it is down, the screens fall back to asking every few seconds ([connected]).
 */
@Singleton
class LiveLine @Inject constructor(
    client: OkHttpClient,
    private val api: WorkspaceApi,
    private val store: ChatStore,
    private val session: Session,
    private val json: Json,
) {
    /**
     * The server pings every 25 seconds: a line silent for a minute is dead (a network change, a router that dropped it without a word),
     * so the read fails and the line comes back, instead of hanging «connected» for ever.
     */
    private val stream = client.newBuilder().readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    /** The open connection: closed directly by [stop] and a sign-out (a blocking read hears no cancelled coroutine). */
    @Volatile private var call: Call? = null

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    @Volatile private var lastEventId: String? = null
    @Volatile private var cursor: String? = null
    /** Raised at every sign-out: a catch-up that started before it never writes its cursor back after it. */
    @Volatile private var epoch = 0L
    /** message id → its conversation, from the frames not yet caught up (the catch-up's messages carry no conversation id) */
    private val placed = ConcurrentHashMap<String, String>()
    private val syncing = Mutex()
    private var pending: Job? = null
    /** a frame arrived while a catch-up was running: run it once more, its answer may predate the frame */
    @Volatile private var dirty = false

    /** the activity is on screen */
    @Volatile private var wanted = false

    init {
        // a sign-out ends the line at once and forgets where it was: the next person starts from «now»
        scope.launch {
            session.gate.collect { gate ->
                if (gate == Gate.SIGNED_OUT) {
                    epoch++
                    synchronized(this@LiveLine) { job?.cancel(); job = null }
                    call?.cancel()
                    _connected.value = false
                    cursor = null
                    lastEventId = null
                    placed.clear()
                    if (wanted) start()
                }
            }
        }
    }

    @Synchronized
    fun start() {
        wanted = true
        if (job?.isActive == true) return
        job = scope.launch { run() }
    }

    @Synchronized
    fun stop() {
        wanted = false
        job?.cancel()
        job = null
        call?.cancel()
        _connected.value = false
    }

    private suspend fun run() {
        var failures = 0
        while (scope.isActive) {
            if (session.gate.value != Gate.IN) { delay(2_000); continue }
            // where «now» is, before the stream: every frame after it is caught up, nothing is missed in between
            if (cursor == null) {
                val started = epoch
                when (val r = apiCall { api.sync() }) {
                    is ApiResult.Ok -> if (started == epoch) cursor = r.value.cursor
                    is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); delay(backoff(++failures)); continue }
                }
            }
            val ended = try { listen() } catch (e: CancellationException) { throw e } catch (e: Exception) { "error" }
            _connected.value = false
            when (ended) {
                "signed_out" -> { session.expired(ApiFailure(Sentences.byKey.getValue("auth.required"), "auth.required", 401)); delay(5_000) }
                // the person has too many lines open (the site allows a few per person): the phone steps back for a while instead of
                // pushing their own browser tabs out every second
                "evicted" -> delay(EVICTED_WAIT_MS)
                "opened" -> { failures = 0; delay(1_000) }
                else -> delay(backoff(++failures))
            }
        }
    }

    /** One connection, until it ends: "opened" (it was up, then closed), "signed_out", "evicted", or why it never opened. */
    private suspend fun listen(): String = withContext(Dispatchers.IO) {
        val url = Config.BASE.trimEnd('/') + "/api/rt?tab=android"
        val req = Request.Builder().url(url).header("Accept", "text/event-stream").apply { lastEventId?.let { header("Last-Event-ID", it) } }.build()
        val c = stream.newCall(req)
        call = c
        try {
            c.execute().use { res ->
                if (res.code == 401) return@withContext "signed_out"
                if (!res.isSuccessful) return@withContext "http-${res.code}"
                val source = res.body?.source() ?: return@withContext "empty"
                _connected.value = true
                // what changed while the line was down (the cursor is older than this connection)
                catchUp()
                val parser = SseParser()
                while (isActive) {
                    val line = source.readUtf8Line() ?: break
                    val frame = parser.line(line) ?: continue
                    when (frame.event) {
                        "ping" -> Unit
                        "reload" -> scope.launch { reload() }
                        "bye" -> return@withContext when {
                            frame.data.contains("signed_out") -> "signed_out"
                            frame.data.contains("evicted") -> "evicted"
                            else -> "opened"
                        }
                        null -> onFrame(frame)
                    }
                }
                "opened"
            }
        } finally {
            if (call === c) call = null
        }
    }

    /** The server could not replay the gap: «now» again, and the list and the open chats fetched whole. */
    private suspend fun reload() = syncing.withLock {
        val started = epoch
        (apiCall { api.sync() } as? ApiResult.Ok)?.let { if (started == epoch) cursor = it.value.cursor }
        placed.clear()
        store.reloadAll()
    }

    private fun onFrame(frame: SseFrame) {
        val o = runCatching { json.parseToJsonElement(frame.data).jsonObject }.getOrNull() ?: return
        frame.id?.let { lastEventId = it }
        val kind = o.str("kind")
        if (kind == "typing") {
            val conv = o.str("conversationId") ?: return
            store.typing(conv, o.str("userId").orEmpty(), o.str("name").orEmpty())
            return
        }
        if (kind == "presence.changed") return
        val conv = o.str("conversationId")
        val message = o.str("messageId")
        if (conv != null && message != null) placed[message] = conv
        if (frame.id != null) schedule()
    }

    /** Frames come in bursts: one catch-up for all of them, 120 ms after the first; a frame during a catch-up runs it once more. */
    @Synchronized
    private fun schedule() {
        dirty = true
        if (pending?.isActive == true) return
        pending = scope.launch { delay(120); catchUp() }
    }

    private suspend fun catchUp() {
        // a frame that lands while the answer is on its way may not be in it: ask again until no frame came meanwhile
        repeat(5) {
            dirty = false
            syncing.withLock { catchUpOnce() }
            if (!dirty) return
        }
    }

    private suspend fun catchUpOnce() {
        val started = epoch
        repeat(10) {
            val after = cursor ?: return
            val r = apiCall { api.sync(after = after) }
            if (started != epoch) return // a sign-out happened meanwhile: nothing of the last person is written
            if (r !is ApiResult.Ok) { if (r is ApiResult.Err && r.failure.signedOut) session.expired(r.failure); return }
            val s = r.value
            if (s.reset) { cursor = s.cursor; placed.clear(); store.reloadAll(); return }
            store.apply(s, HashMap(placed))
            // only what came back is done: a frame's message that is not in this answer stays placed for the next one
            for (m in s.messages) placed.remove(m.id)
            if (placed.size > MAX_PLACED) placed.clear()
            cursor = s.cursor
            if (!s.more) return
        }
    }

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

    companion object {
        const val READ_TIMEOUT_S = 60L
        const val EVICTED_WAIT_MS = 60_000L
        private const val MAX_PLACED = 2_000

        /** 1 s, 2 s, 5 s, 10 s, then every 30 s. */
        fun backoff(failures: Int): Long = when (failures) { 0, 1 -> 1_000; 2 -> 2_000; 3 -> 5_000; 4 -> 10_000; else -> 30_000 }
    }
}
