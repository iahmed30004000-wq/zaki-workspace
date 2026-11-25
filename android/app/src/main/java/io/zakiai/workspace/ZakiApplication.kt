package io.zakiai.workspace

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import io.zakiai.workspace.core.crash.CrashReporter
import io.zakiai.workspace.core.crash.MainThreadWatchdog
import javax.inject.Inject

/**
 * The application. Three things start here and nowhere else:
 *  - the crash reporter (an uncaught exception is written to disk before the process dies, and sent on a later start);
 *  - the main-thread watchdog (a screen frozen for 4 seconds is recorded as an ANR, with the main thread's stack);
 *  - WorkManager, with Hilt's worker factory (the outbox and the crash upload); the notification channels.
 */
@HiltAndroidApp
class ZakiApplication : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var crashReporter: CrashReporter
    @Inject lateinit var watchdog: MainThreadWatchdog

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        crashReporter.install()
        watchdog.start()
        Notifier.channels(this)
    }
}
