package io.zakiai.workspace

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * The app: native sign-in, chat and notifications, and the rest of the site in a web view inside it. A tapped notification or call opens here
 * (the address arrives as the intent's data and goes through AppState.open).
 */
class MainActivity : ComponentActivity() {
    private val state = AppState()
    private lateinit var web: WebHost

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(applicationContext)
        web = WebHost(this)
        Notifier.channels(this)
        Notifier.cancelRing(this)
        state.signedIn = Api.hasSession()
        if (state.signedIn) {
            Api.syncToWebView()
            StreamService.start(this)
        }
        handle(intent)

        setContent {
            ZakiTheme {
                // the app reads right to left whatever language the phone is in
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    Box(Modifier.fillMaxSize().background(Zk.Surface)) {
                        ZakiApp(state, web, askNotifications = { askNotificationPermission() }, onSignedIn = { next -> afterSignIn(next) }, onLogout = { logout() })
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Notifier.cancelRing(this)
        handle(intent)
    }

    override fun onDestroy() {
        if (isFinishing) web.destroy()
        super.onDestroy()
    }

    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        if (state.signedIn) state.open(uri.toString())
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** Signed in: the phone becomes a device of the person (the live line's key), asks for notifications, and a page that is still owed opens first. */
    private fun afterSignIn(next: String) {
        state.signedIn = true
        state.tab = Tab.CHAT
        askNotificationPermission()
        lifecycleScopeLaunch {
            runCatching {
                val key = Api.registerDevice()
                Config.setToken(this@MainActivity, key.token, key.id)
                StreamService.start(this@MainActivity)
            }
        }
        if (next.startsWith("/onboarding")) state.open(next)
    }

    private fun logout() {
        lifecycleScopeLaunch {
            Api.removeDevice(Config.deviceId(this@MainActivity))
            Api.logout()
            Config.clearToken(this@MainActivity)
            stopService(Intent(this@MainActivity, StreamService::class.java))
            Api.forgetSession()
            state.signedIn = false
            state.openConversation = null
        }
    }

    private fun lifecycleScopeLaunch(block: suspend () -> Unit) {
        lifecycleScope.launch { block() }
    }
}

@Composable
fun ZakiApp(state: AppState, web: WebHost, askNotifications: () -> Unit, onSignedIn: (String) -> Unit, onLogout: () -> Unit) {
    if (!state.signedIn) {
        LoginScreen(onSignedIn = onSignedIn)
        return
    }
    val scope = rememberCoroutineScope()

    // a session that the server no longer honours sends the person back to sign-in
    LaunchedEffect(state.signedIn) {
        try {
            Api.checkSession()
        } catch (e: ApiException) {
            if (e.status == 401) {
                Api.forgetSession()
                state.signedIn = false
            }
        } catch (e: Exception) {
            // offline: stay signed in, the screens say so
        }
    }

    val conversation = state.openConversation
    if (conversation != null && state.tab == Tab.CHAT) {
        ConversationScreen(state, conversation) { callId ->
            state.openConversation = null
            state.open("/calls/$callId")
        }
        return
    }

    Scaffold(
        containerColor = Zk.Surface,
        bottomBar = {
            NavigationBar(containerColor = Zk.Surface2) {
                @Composable
                fun item(label: String, selected: Boolean, badge: Int, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
                    NavigationBarItem(
                        selected = selected,
                        onClick = onClick,
                        label = { Text(label) },
                        icon = {
                            BadgedBox(badge = { if (badge > 0) Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) { Icon(icon, contentDescription = label) }
                        },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = Zk.OnAccent, indicatorColor = Zk.Accent, unselectedIconColor = Zk.Muted, unselectedTextColor = Zk.Muted, selectedTextColor = Zk.Accent),
                    )
                }
                item(T.chat, state.tab == Tab.CHAT, state.chatUnread, Icons.Filled.Email) { state.tab = Tab.CHAT }
                item(T.today, state.tab == Tab.WEB && state.webPath == "/", 0, Icons.Filled.Home) { state.webPath = "/"; state.tab = Tab.WEB }
                item(T.tasks, state.tab == Tab.WEB && state.webPath == "/my-work", 0, Icons.Filled.List) { state.webPath = "/my-work"; state.tab = Tab.WEB }
                item(T.notifications, state.tab == Tab.NOTES, state.notesUnread, Icons.Filled.Notifications) { state.tab = Tab.NOTES }
                item(T.more, state.tab == Tab.MORE, 0, Icons.Filled.Menu) { state.tab = Tab.MORE }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when (state.tab) {
                Tab.CHAT -> ChatListScreen(state)
                Tab.WEB -> WebScreen(state, web)
                Tab.NOTES -> NotificationsScreen(state)
                Tab.MORE -> MoreScreen(state, onLogout = { scope.launch { onLogout() } }, askNotifications = askNotifications)
            }
        }
    }
}
