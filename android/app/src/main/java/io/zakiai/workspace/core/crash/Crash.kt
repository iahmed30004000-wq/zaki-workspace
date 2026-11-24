package io.zakiai.workspace.core.crash

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.BuildConfig
import io.zakiai.workspace.core.net.ClientErrorReport
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * KEEPS WHAT WENT WRONG UNTIL IT CAN BE SENT («أعطال التطبيق»).
 *
 * A crash cannot make a network call — the process is dying — so every report is a small JSON file in the app's own storage,
 * written at once, and `ClientErrorUploadWorker` sends them (20 at a time) to `/api/client-errors` once somebody is signed in,
 * then deletes what the server took. At most 50 files are kept: a crash loop must not fill the phone. A report holds the
 * exception and the screen's name only — never a message, a file name or anything the person typed.
 */
@Singleton
class CrashStore @Inject constructor(@ApplicationContext context: Context) {
    private val dir = File(context.filesDir, "client-errors").apply { mkdirs() }
    private val json = Json { encodeDefaults = false }

    /** The screen the person is on, set by the navigation — the one piece of context a stack lacks. */
    @Volatile var currentScreen: String? = null

    fun record(kind: String, message: String, stack: String?) {
        runCatching {
            val report = ClientErrorReport(
                kind = kind,
                message = message.take(2000),
                stack = stack?.take(16_000),
                screen = currentScreen?.take(80),
                appVersion = BuildConfig.VERSION_NAME.take(40),
                versionCode = BuildConfig.VERSION_CODE,
                device = "${Build.MANUFACTURER} ${Build.MODEL}".take(120),
                osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})".take(60),
                occurredAt = Instant.now().toString(),
            )
            File(dir, "${System.currentTimeMillis()}-${kind.lowercase()}.json").writeText(json.encodeToString(report))
            trim()
        }
    }

    fun pending(limit: Int = 20): List<Pair<File, ClientErrorReport>> =
        dir.listFiles { f -> f.extension == "json" }.orEmpty().sortedBy { it.name }.take(limit).mapNotNull { f ->
            runCatching { f to json.decodeFromString<ClientErrorReport>(f.readText()) }.getOrElse { f.delete(); null }
        }

    fun count(): Int = dir.listFiles { f -> f.extension == "json" }?.size ?: 0

    private fun trim() {
        val files = dir.listFiles { f -> f.extension == "json" }.orEmpty().sortedBy { it.name }
        if (files.size > MAX_FILES) files.take(files.size - MAX_FILES).forEach { it.delete() }
    }

    companion object { const val MAX_FILES = 50 }
}

/** The uncaught-exception hook: the report is on disk before the process goes, then the system's own handler runs. */
@Singleton
class CrashReporter @Inject constructor(private val store: CrashStore) {
    fun install() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            store.record("CRASH", "${error.javaClass.name}: ${error.message.orEmpty()} [${thread.name}]", error.stackTraceToString())
            previous?.uncaughtException(thread, error)
        }
    }

    /** A caught error worth knowing about (an answer the app could not read). */
    fun caught(error: Throwable, where: String) {
        store.record("ERROR", "$where: ${error.javaClass.simpleName}: ${error.message.orEmpty()}", error.stackTraceToString())
    }
}

/**
 * A FROZEN SCREEN IS A BUG TOO: a thread pings the main thread every second; when a ping waits 4 seconds the main thread's stack
 * is recorded as an ANR (once per freeze), the moment the system's own «التطبيق لا يستجيب» would be near.
 */
@Singleton
class MainThreadWatchdog @Inject constructor(private val store: CrashStore) {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var lastPong = SystemClock.uptimeMillis()
    @Volatile private var reported = false

    fun start() {
        val t = Thread({
            while (true) {
                main.post { lastPong = SystemClock.uptimeMillis(); reported = false }
                try { Thread.sleep(1000) } catch (e: InterruptedException) { return@Thread }
                val waited = SystemClock.uptimeMillis() - lastPong
                if (waited > 4000 && !reported) {
                    reported = true
                    val stack = Looper.getMainLooper().thread.stackTrace.joinToString("\n") { "\tat $it" }
                    store.record("ANR", "main thread blocked ${waited}ms", stack)
                }
            }
        }, "zaki-watchdog")
        t.isDaemon = true
        t.start()
    }
}
