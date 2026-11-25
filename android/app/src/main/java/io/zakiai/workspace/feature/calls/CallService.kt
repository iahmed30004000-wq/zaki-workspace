package io.zakiai.workspace.feature.calls

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * While a call runs: a foreground service of the microphone (and the camera when it is allowed), so Android keeps the call when the
 * screen goes off or another app opens; its ongoing notification opens the call and has «اطلع». It stops with the call.
 */
@AndroidEntryPoint
class CallService : Service() {
    @Inject lateinit var engine: CallEngine

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_LEAVE) {
            engine.leave()
            stopSelf()
            return START_NOT_STICKY
        }
        val granted = { p: String -> ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED }
        var types = 0
        if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (types == 0) { stopSelf(); return START_NOT_STICKY }
        runCatching { ServiceCompat.startForeground(this, ID, notification(), types) }.onFailure { stopSelf() }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, K.inCall, NotificationManager.IMPORTANCE_LOW))
        }
        val callId = engine.ui.value.callId
        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            if (callId != null) data = android.net.Uri.parse(io.zakiai.workspace.Config.BASE + "/calls/" + callId)
            action = Intent.ACTION_VIEW
        }
        val openPi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val leavePi = PendingIntent.getService(this, 2, Intent(this, CallService::class.java).setAction(ACTION_LEAVE), PendingIntent.FLAG_IMMUTABLE)
        val title = engine.ui.value.detail?.let { it.conversationTitle ?: it.title ?: it.startedBy?.name } ?: K.inCall
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_outgoing)
            .setContentTitle(K.inCall)
            .setContentText(title)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(openPi)
            .addAction(0, K.leave, leavePi)
            .build()
    }

    companion object {
        private const val ID = 7301
        private const val CHANNEL = "call-ongoing"
        private const val ACTION_LEAVE = "io.zakiai.workspace.call.LEAVE"

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, CallService::class.java)) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallService::class.java)) }
        }
    }
}
