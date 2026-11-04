package io.zakiai.workspace

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** The notifications of the bell, refreshed while the screen is on. A tap marks one read and opens what it is about. */
@Composable
fun NotificationsScreen(state: AppState) {
    var data by remember { mutableStateOf<Notifications?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    suspend fun load() {
        try {
            val n = Api.notifications()
            data = n
            state.notesUnread = n.unreadCount
            error = null
        } catch (e: ApiException) {
            if (e.status == 401) state.signedIn = false else error = T.generic
        } catch (e: Exception) {
            error = T.offline
        }
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) load()
            delay(10_000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(T.notifications, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 14.dp))
            if ((data?.unreadCount ?: 0) > 0) {
                OutlinedButton(
                    onClick = { scope.launch { Api.readAllNotifications(); load() } },
                    modifier = Modifier.padding(end = 12.dp),
                ) { Text(T.markAllRead, fontSize = 12.sp) }
            }
        }
        HorizontalDivider(color = Zk.Surface3)
        val d = data
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Zk.Accent) }
            d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error ?: "", color = Zk.Danger) }
            d.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(T.noNotifications, color = Zk.Muted) }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(d.items, key = { it.id }) { n ->
                    Column(
                        Modifier.fillMaxWidth()
                            .background(if (n.readAt == null) Zk.Surface2 else Zk.Surface)
                            .clickable {
                                scope.launch { Api.readNotification(n.id) }
                                state.open(n.linkUrl)
                            }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    ) {
                        Text(n.title, fontSize = 15.sp, fontWeight = if (n.readAt == null) FontWeight.Bold else FontWeight.Normal)
                        if (!n.body.isNullOrBlank()) Text(n.body, fontSize = 13.sp, color = Zk.Muted, modifier = Modifier.padding(top = 2.dp))
                        Text(clock(n.createdAt), fontSize = 11.sp, color = Zk.Muted, modifier = Modifier.padding(top = 4.dp))
                    }
                    HorizontalDivider(color = Zk.Surface3)
                }
            }
        }
    }
}

/** A page of the site inside the app, signed in with the app's own session. Its back arrow walks back through the site, then leaves it. */
@Composable
fun WebScreen(state: AppState, host: WebHost) {
    BackHandler(enabled = host.webView.canGoBack()) { host.webView.goBack() }
    LaunchedEffect(state.webPath) { host.show(state.webPath) }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = {
            (host.webView.parent as? ViewGroup)?.removeView(host.webView)
            host.webView
        },
        update = { host.show(state.webPath) },
    )
}

@Composable
private fun SettingButton(label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = Zk.Surface3, contentColor = Zk.Text),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) { Text(label) }
}

private val PAGES = listOf(
    "المشاريع" to "/projects",
    "التقويم" to "/calendar",
    "الملفات" to "/files",
    "الأهداف" to "/goals",
    "الأفكار" to "/ideas",
    "الفريق" to "/teams",
    "الإعدادات" to "/settings",
    "الدليل" to "/guide",
)

/** What is left of the site while it becomes native screen by screen, the three permissions a ringing phone needs, and sign-out. */
@Composable
fun MoreScreen(state: AppState, onLogout: () -> Unit, askNotifications: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(lifecycle) {
        // the buttons of a granted permission disappear when the person comes back from the system settings
        while (isActive) {
            tick++
            delay(1500)
        }
    }
    val recheck = tick >= 0
    val notifications = recheck && (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val fullScreen = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val battery = pm.isIgnoringBatteryOptimizations(context.packageName)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header(T.more)
        Column(Modifier.padding(16.dp)) {
            if (!notifications || !fullScreen || !battery) {
                Text(T.permissions, color = Zk.Accent, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                if (!notifications) SettingButton(T.allowNotifications, askNotifications)
                if (!fullScreen && Build.VERSION.SDK_INT >= 34) {
                    SettingButton(T.allowFullScreen) {
                        context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
                    }
                }
                if (!battery) {
                    SettingButton(T.allowBattery) {
                        context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
            Text(T.pages, color = Zk.Accent, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
            for ((label, path) in PAGES) SettingButton(label) { state.open(path) }
            Spacer(Modifier.height(16.dp))
            Text(T.account, color = Zk.Accent, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
            Button(
                onClick = onLogout,
                colors = ButtonDefaults.buttonColors(containerColor = Zk.Danger, contentColor = Zk.Text),
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            ) { Text(T.logout) }
        }
    }
}
