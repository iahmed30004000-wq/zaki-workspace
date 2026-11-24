package io.zakiai.workspace.core

import io.zakiai.workspace.core.db.CacheDao
import io.zakiai.workspace.core.db.CacheEntry
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/** What a screen shows: the data it has (the cache first, then the server's), why the last refresh failed, and whether one is running. */
data class Loadable<T>(val data: T? = null, val failure: ApiFailure? = null, val refreshing: Boolean = false)

/** The last answer of each screen, kept on the phone (the `cache` table). Decoding is off the screen's thread. */
@Singleton
class Cache @Inject constructor(private val dao: CacheDao, private val json: Json) {
    /**
     * Raised when the session ends or another person signs in. A fetch that started before keeps its answer to itself: it is
     * never written, so the last person's chats can never refill the cache the next person opens with.
     */
    @Volatile var generation = 0L
        private set

    fun bump() { generation++ }

    suspend fun <T> read(key: String, serializer: KSerializer<T>): T? = withContext(Dispatchers.IO) {
        dao.get(key)?.let { runCatching { json.decodeFromString(serializer, it.json) }.getOrNull() }
    }

    private suspend fun <T> write(key: String, serializer: KSerializer<T>, value: T, startedIn: Long) = withContext(Dispatchers.IO) {
        if (startedIn == generation) dao.put(CacheEntry(key, json.encodeToString(serializer, value), System.currentTimeMillis()))
    }

    /** Fetches, keeps the answer (only if no sign-out happened meanwhile), and hands back the result. */
    suspend fun <T> refresh(key: String, serializer: KSerializer<T>, fetch: suspend () -> ApiResult<T>): ApiResult<T> {
        val startedIn = generation
        val r = fetch()
        if (r is ApiResult.Ok) write(key, serializer, r.value, startedIn)
        return r
    }
}
