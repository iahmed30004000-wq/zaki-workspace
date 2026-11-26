package io.zakiai.workspace.feature.settings

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.BuildConfig
import io.zakiai.workspace.core.AppLock
import io.zakiai.workspace.core.LookSettings
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.crash.CrashStore
import io.zakiai.workspace.core.db.OutboxDao
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.handleOf
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.ZK_THEMES
import io.zakiai.workspace.ui.theme.ZkTheme
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    val session: Session,
    val lock: AppLock,
    look: LookSettings,
    private val crashes: CrashStore,
    outbox: OutboxDao,
) : ViewModel() {
    val theme = look.theme
    val outboxCount = outbox.count().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)
    fun crashCount(): Int = crashes.count()
    fun pickTheme(key: String) = session.pickTheme(key)
    fun signOut() = viewModelScope.launch { session.signOut() }
}

@Composable
private fun Row2(title: String, hint: String? = null, trailing: @Composable () -> Unit = {}, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted)
        }
        trailing()
    }
}

@Composable
private fun ThemeSwatch(t: ZkTheme, selected: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(78.dp).clickable(onClick = onClick).padding(vertical = 6.dp)) {
        Box(
            Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(t.colors.surface)
                .border(BorderStroke(if (selected) 3.dp else 1.dp, if (selected) Zk.colors.accent else Zk.colors.border), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.size(14.dp).clip(CircleShape).background(t.colors.accent))
                Box(Modifier.size(14.dp).clip(CircleShape).background(t.colors.bubbleOut))
                Box(Modifier.size(14.dp).clip(CircleShape).background(t.colors.accent2))
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(t.label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}

/** The person, the look, the lock, what the ringing phone needs, the app's own health, and sign-out. */
@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel(), askNotifications: () -> Unit, onOpenMe: (String) -> Unit = {}, onOpenSite: (String) -> Unit = {}, onOpenAdmin: (String) -> Unit = {}) {
    val context = LocalContext.current
    val me by vm.session.me.collectAsStateWithLifecycle()
    val theme by vm.theme.collectAsStateWithLifecycle()
    val lockOn by vm.lock.enabled.collectAsStateWithLifecycle()
    val outboxCount by vm.outboxCount.collectAsStateWithLifecycle()
    // the permission rows disappear when the person comes back from the system's settings
    var tick by remember { mutableIntStateOf(0) }
    WhileOnScreen(3_000) { tick++ }
    val perms = remember(tick) { PermissionState.of(context) }
    val crashes = remember(tick) { vm.crashCount() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        val m = me
        if (m != null) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(m.name, url = m.avatarUrl, size = 64.dp, hue = m.hue)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(m.name, style = MaterialTheme.typography.titleLarge)
                    val handle = m.username?.let { handleOf(it) } ?: m.email
                    if (handle != null) Text(handle, style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted)
                    if (!m.jobTitle.isNullOrBlank()) Text(m.jobTitle, style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted)
                }
            }
            HorizontalDivider(color = Zk.colors.border)
        }

        // «إعداداتي» (the site's /settings/me), its sections natively
        SectionLabel(io.zakiai.workspace.feature.me.M.title)
        io.zakiai.workspace.feature.me.MeSectionRows(onOpen = onOpenMe, onOpenSite = onOpenSite)

        // the board / panel, the reports, the customers: each only for who may open it (the server decides again)
        io.zakiai.workspace.feature.panel.AdminRows(onOpen = onOpenAdmin)

        SectionLabel(T.theme)
        Row(Modifier.fillMaxWidth().horizontalScrollRow().padding(horizontal = 8.dp)) {
            for (t in ZK_THEMES) ThemeSwatch(t, t.key == theme) { vm.pickTheme(t.key) }
        }

        SectionLabel(T.security)
        val available = remember { vm.lock.available() }
        Row2(T.lockTitle, if (available) T.lockHint else T.lockUnavailable, trailing = {
            Switch(
                checked = lockOn,
                enabled = available,
                onCheckedChange = { vm.lock.setEnabled(it) },
                colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent, checkedThumbColor = Zk.colors.accentFg),
            )
        })

        if (!perms.notifications || !perms.fullScreen || !perms.battery) {
            SectionLabel(T.permissions)
            if (!perms.notifications) Row2(T.allowNotifications, onClick = askNotifications)
            if (!perms.fullScreen && Build.VERSION.SDK_INT >= 34) {
                Row2(T.allowFullScreen, onClick = { context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))) })
            }
            if (!perms.battery) {
                Row2(T.allowBattery, onClick = { context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))) })
            }
        }

        SectionLabel(T.crashes)
        Row2(if (crashes > 0) T.crashesWaiting.format(crashes) else T.crashesNone)
        if (outboxCount > 0) Row2(T.outboxWaiting.format(outboxCount))
        Row2(T.version.format(BuildConfig.VERSION_NAME))

        SectionLabel(T.account)
        OutlinedButton(
            onClick = { vm.signOut() },
            border = BorderStroke(1.dp, Zk.colors.danger),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        ) { Text(T.logout, color = Zk.colors.danger) }
        Spacer(Modifier.height(24.dp))
    }
}

/** A row that scrolls sideways (the theme swatches). */
@Composable
private fun Modifier.horizontalScrollRow(): Modifier = this.then(Modifier.horizontalScroll(rememberScrollState()))

/** What the ringing phone still needs from the system. */
data class PermissionState(val notifications: Boolean, val fullScreen: Boolean, val battery: Boolean) {
    companion object {
        fun of(context: Context): PermissionState {
            val notifications = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val fullScreen = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            return PermissionState(notifications, fullScreen, pm.isIgnoringBatteryOptimizations(context.packageName))
        }
    }
}
