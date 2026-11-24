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
    suspend fun <T> read(key: String, serializer: KSerializer<T>): T? = withContext(Dispatchers.IO) {
        dao.get(key)?.let { runCatching { json.decodeFromString(serializer, it.json) }.getOrNull() }
    }

    suspend fun <T> write(key: String, serializer: KSerializer<T>, value: T) = withContext(Dispatchers.IO) {
        dao.put(CacheEntry(key, json.encodeToString(serializer, value), System.currentTimeMillis()))
    }

    /** Fetches, keeps the answer, and hands back the result (the cached data stays when the fetch fails). */
    suspend fun <T> refresh(key: String, serializer: KSerializer<T>, fetch: suspend () -> ApiResult<T>): ApiResult<T> {
        val r = fetch()
        if (r is ApiResult.Ok) write(key, serializer, r.value)
        return r
    }
}
