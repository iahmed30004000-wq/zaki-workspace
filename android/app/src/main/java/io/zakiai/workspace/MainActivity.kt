package io.zakiai.workspace

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * The app: native sign-in, chat and notifications; a page of the site opens over them when it is asked for and is thrown away when it is
 * left. A tapped notification or call opens here (the address arrives as the intent's data and goes through AppState.open).
 */
class MainActivity : ComponentActivity() {
    private val state = AppState()
    private var web: WebHost? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // the system's questions for a page of the site (microphone, camera, a file): asked here, answered to the page
    private var permissionAnswer: ((Map<String, Boolean>) -> Unit)? = null
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        permissionAnswer?.invoke(granted)
        permissionAnswer = null
    }
    private var fileAnswer: ((ActivityResult) -> Unit)? = null
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileAnswer?.invoke(result)
        fileAnswer = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Api.init(applicationContext)
        Notifier.channels(this)
        Notifier.cancelRing(this)
        state.signedIn = Api.hasSession()
        if (state.signedIn) StreamService.start(this)
        handle(intent)

        setContent {
            ZakiTheme {
                // the app reads right to left whatever language the phone is in
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    // a Surface gives every Text the theme's text colour (a bare Box leaves it black on the dark paper)
                    Surface(modifier = Modifier.fillMaxSize(), color = Zk.Surface, contentColor = Zk.Text) {
                        ZakiApp(
                            state,
                            webHost = { webHost() },
                            releaseWeb = { releaseWeb() },
                            askNotifications = { askNotificationPermission() },
                            onSignedIn = { next -> afterSignIn(next) },
                            onLogout = { logout() },
                        )
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
        releaseWeb()
        super.onDestroy()
    }

    /** The page's window, made when a page is opened. */
    private fun webHost(): WebHost =
        web ?: WebHost(
            this,
            askPermissions = { permissions, answer ->
                permissionAnswer = answer
                permissionLauncher.launch(permissions)
            },
            pickFiles = { intent, answer ->
                fileAnswer = answer
                fileLauncher.launch(intent)
            },
        ).also { web = it }

    private fun releaseWeb() {
        web?.destroy()
        web = null
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
        lifecycleScope.launch {
            runCatching {
                val key = Api.registerDevice()
                Config.setToken(this@MainActivity, key.token, key.id)
                StreamService.start(this@MainActivity)
            }
        }
        if (next.startsWith("/onboarding")) state.open(next)
    }

    private fun logout() {
        lifecycleScope.launch {
            Api.removeDevice(Config.deviceId(this@MainActivity))
            Api.logout()
            Config.clearToken(this@MainActivity)
            stopService(Intent(this@MainActivity, StreamService::class.java))
            Api.forgetSession()
            state.webPath = null
            state.openConversation = null
            state.signedIn = false
        }
    }
}

@Composable
fun ZakiApp(
    state: AppState,
    webHost: () -> WebHost,
    releaseWeb: () -> Unit,
    askNotifications: () -> Unit,
    onSignedIn: (String) -> Unit,
    onLogout: () -> Unit,
) {
    if (!state.signedIn) {
        LoginScreen(onSignedIn = onSignedIn)
        return
    }

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

    // a page of the site, over everything, until it is closed
    val page = state.webPath
    if (page != null) {
        WebOverlay(state, webHost, releaseWeb)
        return
    }

    val conversation = state.openConversation
    if (conversation != null) {
        ConversationScreen(state, conversation) { callId ->
            state.openConversation = null
            state.open("/calls/$callId")
        }
        return
    }

    val scope = rememberCoroutineScope()
    Scaffold(
        containerColor = Zk.Surface,
        bottomBar = {
            NavigationBar(containerColor = Zk.Surface2) {
                Tabs(state)
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when (state.tab) {
                Tab.CHAT -> ChatListScreen(state)
                Tab.NOTES -> NotificationsScreen(state)
                Tab.MORE -> MoreScreen(state, onLogout = { scope.launch { onLogout() } }, askNotifications = askNotifications)
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Tabs(state: AppState) {
    TabItem(T.chat, state.tab == Tab.CHAT, state.chatUnread, Icons.Filled.Email) { state.tab = Tab.CHAT }
    TabItem(T.notifications, state.tab == Tab.NOTES, state.notesUnread, Icons.Filled.Notifications) { state.tab = Tab.NOTES }
    TabItem(T.more, state.tab == Tab.MORE, 0, Icons.Filled.Menu) { state.tab = Tab.MORE }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, selected: Boolean, badge: Int, icon: ImageVector, onClick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        icon = {
            BadgedBox(badge = { if (badge > 0) Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) { Icon(icon, contentDescription = label) }
        },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Zk.OnAccent,
            indicatorColor = Zk.Accent,
            unselectedIconColor = Zk.Muted,
            unselectedTextColor = Zk.Muted,
            selectedTextColor = Zk.Accent,
        ),
    )
}
