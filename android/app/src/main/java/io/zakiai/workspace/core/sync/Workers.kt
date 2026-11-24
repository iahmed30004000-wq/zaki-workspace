package io.zakiai.workspace.core.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.core.crash.CrashStore
import io.zakiai.workspace.core.db.OutboxDao
import io.zakiai.workspace.core.db.OutboxItem
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.ClientErrorBatch
import io.zakiai.workspace.core.net.SendBody
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import kotlinx.serialization.json.Json
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** What the outbox does with one row after one try. Pure (unit-tested): the one place this decision is made. */
enum class OutboxStep { DONE, RETRY_LATER, REFUSED }

object OutboxRules {
    /** Sent (or already there: the same clientId), try again later (no network, the server busy), or refused for good (the server said no). */
    fun stepOf(result: ApiResult<*>): OutboxStep = when (result) {
        is ApiResult.Ok -> OutboxStep.DONE
        is ApiResult.Err -> when {
            result.failure.offline -> OutboxStep.RETRY_LATER
            result.failure.status == null -> OutboxStep.REFUSED
            result.failure.status == 408 || result.failure.status == 429 || result.failure.status >= 500 -> OutboxStep.RETRY_LATER
            // a 401 is not the row's fault: the session ended; the row waits for the next sign-in (signing out empties the outbox)
            result.failure.status == 401 -> OutboxStep.RETRY_LATER
            else -> OutboxStep.REFUSED
        }
    }
}

/**
 * SENDS THE OUTBOX, oldest first, when there is a network. Each row goes with its own idempotency key, so a retry after a lost
 * answer never makes a second message. A refused row stops (it is shown to the person); a row that could not be sent waits for
 * the next run (WorkManager's backoff).
 */
@HiltWorker
class OutboxWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val outbox: OutboxDao,
    private val api: WorkspaceApi,
    private val json: Json,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        for (item in outbox.due()) {
            outbox.tried(item.clientId)
            val result = send(item)
            when (OutboxRules.stepOf(result)) {
                OutboxStep.DONE -> outbox.remove(item.clientId)
                OutboxStep.REFUSED -> outbox.refused(item.clientId, (result as? ApiResult.Err)?.failure?.key ?: "refused")
                OutboxStep.RETRY_LATER -> return Result.retry()
            }
        }
        return Result.success()
    }

    private suspend fun send(item: OutboxItem): ApiResult<*> = when (item.kind) {
        KIND_CHAT_SEND -> apiCall { api.send(item.target, json.decodeFromString(SendBody.serializer(), item.payload)) }
        else -> ApiResult.Ok(Unit) // a kind this build does not know (written by a newer one): dropped rather than stuck
    }

    companion object { const val KIND_CHAT_SEND = "chat.send" }
}

/** Sends the crash reports kept on the phone (20 at a time) and deletes what the server took. */
@HiltWorker
class ClientErrorUploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val store: CrashStore,
    private val api: WorkspaceApi,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val batch = store.pending()
        if (batch.isEmpty()) return Result.success()
        return when (val r = apiCall { api.clientErrors(ClientErrorBatch(batch.map { it.second })) }) {
            is ApiResult.Ok -> { batch.forEach { it.first.delete() }; Result.success() }
            // not signed in yet, or too many this hour: the files wait for the next run
            is ApiResult.Err -> if (r.failure.status == 422) { batch.forEach { it.first.delete() }; Result.success() } else Result.retry()
        }
    }
}

/** The background jobs, started once per sign-in and at every start (the same unique names: never twice). */
@Singleton
class Schedules @Inject constructor(@ApplicationContext private val context: Context) {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensure() {
        val wm = WorkManager.getInstance(context)
        wm.enqueueUniquePeriodicWork(
            "client-errors",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ClientErrorUploadWorker>(6, TimeUnit.HOURS).setConstraints(online).build(),
        )
        wm.enqueueUniqueWork(
            "client-errors-now",
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ClientErrorUploadWorker>().setConstraints(online).build(),
        )
        flushOutbox()
    }

    /** Sends what waits in the outbox as soon as there is a network (a new row calls this). */
    fun flushOutbox() {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "outbox",
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<OutboxWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build(),
        )
    }
}
