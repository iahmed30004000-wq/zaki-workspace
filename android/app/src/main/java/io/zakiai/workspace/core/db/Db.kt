package io.zakiai.workspace.core.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import javax.inject.Singleton

/**
 * THE LAST ANSWER OF EACH SCREEN, KEPT ON THE PHONE: a screen opens at once with what it showed last time (even without a network)
 * and refreshes behind it. One row per screen («chat-home», «conversation:<id>», «notifications», «spaces»), the answer as the
 * server sent it. A phase that needs paging or search over its rows (N1 chat) adds its own tables.
 */
@Entity(tableName = "cache")
data class CacheEntry(@PrimaryKey val key: String, val json: String, val savedAt: Long)

/**
 * THE OUTBOX: what the person did while there was no network (or the server did not answer), waiting to be sent — in order,
 * by [io.zakiai.workspace.core.sync.OutboxWorker]. Each row carries the idempotency key the server already honours (a chat
 * message's `clientId`), so a row sent twice — the answer was lost, the worker retried — is still ONE message, never two.
 */
@Entity(tableName = "outbox")
data class OutboxItem(
    @PrimaryKey val clientId: String,
    /** `chat.send` — the only kind in N0; every later phase adds its own. */
    val kind: String,
    /** what it is about: the conversation of a message */
    val target: String,
    /** the JSON the server is sent */
    val payload: String,
    val createdAt: Long,
    val attempts: Int = 0,
    /** the server's refusal (a key, never a body): a refused row stops, it is shown with «حاول مرة تانية» / «احذف» */
    val refusedKey: String? = null,
    /**
     * Who wrote it (the user id). Only the person who wrote a row may send it: after somebody else signs in on this phone,
     * the worker drops rows that are not theirs instead of sending them in the new person's name.
     */
    val ownerId: String = "",
    /**
     * When the server took it. A sent row is KEPT (drawn as a normal message) until the conversation's answer carries a message
     * with its clientId — so a message is never missing from the screen between «sent» and «fetched» (the person would type it
     * again, and the retry would have a new clientId). Rows sent more than a day ago are swept.
     */
    val sentAt: Long? = null,
)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cache WHERE `key` = :key")
    suspend fun get(key: String): CacheEntry?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entry: CacheEntry)

    @Query("DELETE FROM cache")
    suspend fun clear()

    @Query("DELETE FROM cache WHERE `key` = :key")
    suspend fun delete(key: String)
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun add(item: OutboxItem)

    /** Waiting to be sent, oldest first (a refused row is not retried by itself; a sent one is done). */
    @Query("SELECT * FROM outbox WHERE refusedKey IS NULL AND sentAt IS NULL ORDER BY createdAt ASC LIMIT :limit")
    suspend fun due(limit: Int = 50): List<OutboxItem>

    @Query("SELECT * FROM outbox WHERE kind = :kind AND target = :target ORDER BY createdAt ASC")
    fun watch(kind: String, target: String): Flow<List<OutboxItem>>

    /** What still waits to be sent (the settings screen's number). */
    @Query("SELECT COUNT(*) FROM outbox WHERE sentAt IS NULL")
    fun count(): Flow<Int>

    @Query("UPDATE outbox SET sentAt = :at WHERE clientId = :clientId")
    suspend fun sent(clientId: String, at: Long)

    /** The server's answer now carries these messages: their outbox copies are no longer needed. */
    @Query("DELETE FROM outbox WHERE sentAt IS NOT NULL AND clientId IN (:clientIds)")
    suspend fun seen(clientIds: List<String>)

    @Query("DELETE FROM outbox WHERE sentAt IS NOT NULL AND sentAt < :before")
    suspend fun sweepSent(before: Long)

    /** Rows another person wrote on this phone: never sent in the current person's name. */
    @Query("DELETE FROM outbox WHERE ownerId != :userId")
    suspend fun dropOthers(userId: String)

    @Query("UPDATE outbox SET attempts = attempts + 1 WHERE clientId = :clientId")
    suspend fun tried(clientId: String)

    @Query("UPDATE outbox SET refusedKey = :key WHERE clientId = :clientId")
    suspend fun refused(clientId: String, key: String)

    @Query("UPDATE outbox SET refusedKey = NULL, attempts = 0 WHERE clientId = :clientId")
    suspend fun retry(clientId: String)

    @Query("DELETE FROM outbox WHERE clientId = :clientId")
    suspend fun remove(clientId: String)

    @Query("DELETE FROM outbox")
    suspend fun clear()
}

@Database(entities = [CacheEntry::class, OutboxItem::class], version = 1, exportSchema = true)
abstract class ZakiDb : RoomDatabase() {
    abstract fun cache(): CacheDao
    abstract fun outbox(): OutboxDao
}

@Module
@InstallIn(SingletonComponent::class)
object DbModule {
    @Provides @Singleton
    fun db(@ApplicationContext context: Context): ZakiDb = Room.databaseBuilder(context, ZakiDb::class.java, "zaki.db").build()

    @Provides fun cache(db: ZakiDb): CacheDao = db.cache()

    @Provides fun outbox(db: ZakiDb): OutboxDao = db.outbox()
}
