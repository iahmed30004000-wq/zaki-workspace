package io.zakiai.workspace.feature.shell

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.Config
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Connectivity
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.crash.CrashStore
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.Spaces
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.chat.ChatInfoScreen
import io.zakiai.workspace.feature.chat.ChatListScreen
import io.zakiai.workspace.feature.chat.ConversationScreen
import io.zakiai.workspace.feature.chat.NewChatScreen
import io.zakiai.workspace.feature.chat.SpaceTopicsScreen
import io.zakiai.workspace.feature.work.MyWorkScreen
import io.zakiai.workspace.feature.work.TaskScreen
import io.zakiai.workspace.feature.work.TodayScreen
import io.zakiai.workspace.feature.notifications.NotificationsScreen
import io.zakiai.workspace.feature.settings.SettingsScreen
import io.zakiai.workspace.feature.web.WebBridge
import io.zakiai.workspace.feature.web.WebPage
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.handleOf
import io.zakiai.workspace.ui.components.CountBadge
import io.zakiai.workspace.ui.components.OfflineBar
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The numbers and the spaces of the shell (one `/api/workspaces` + the two unread counts, every 30 seconds while on screen). */
@HiltViewModel
class ShellViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    val session: Session,
    val connectivity: Connectivity,
    private val crashes: CrashStore,
    private val http: okhttp3.OkHttpClient,
) : ViewModel() {
    private val _spaces = MutableStateFlow<Spaces?>(null)
    val spaces: StateFlow<Spaces?> = _spaces.asStateFlow()
    private val _chatUnread = MutableStateFlow(0)
    val chatUnread: StateFlow<Int> = _chatUnread.asStateFlow()
    private val _notesUnread = MutableStateFlow(0)
    val notesUnread: StateFlow<Int> = _notesUnread.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, Spaces.serializer())?.let { if (_spaces.value == null) _spaces.value = it } }
        // this view-model lives as long as the activity: what it holds of one person is dropped when their session ends
        viewModelScope.launch {
            session.gate.collect { g ->
                if (g == io.zakiai.workspace.core.Gate.SIGNED_OUT) {
                    _spaces.value = null
                    _chatUnread.value = 0
                    _notesUnread.value = 0
                }
            }
        }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, Spaces.serializer()) { apiCall { api.spaces() } }) {
            is ApiResult.Ok -> _spaces.value = r.value
            is ApiResult.Err -> if (r.failure.signedOut) session.expired(r.failure)
        }
        (apiCall { api.chatUnread() } as? ApiResult.Ok)?.let { _chatUnread.value = it.value.total }
        (apiCall { api.notifications() } as? ApiResult.Ok)?.let { _notesUnread.value = it.value.unreadCount }
    }

    /**
     * Enters a space: the site's own switch (`/go` sets the space's cookie). The redirect it answers with is NOT followed — it leads to a
     * whole page of the site, and the cookie is all the app needs; then the shell and the screens that read the current space reload.
     */
    fun enter(spaceId: String) = viewModelScope.launch {
        val url = Config.BASE.trimEnd('/') + "/go?space=" + Uri.encode(spaceId) + "&next=%2F"
        val noRedirect = http.newBuilder().followRedirects(false).followSslRedirects(false).build()
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { noRedirect.newCall(okhttp3.Request.Builder().url(url).build()).execute().close() }
        }
        refresh()
    }

    fun screen(name: String) { crashes.currentScreen = name }

    companion object { const val KEY = "spaces" }
}

private object Routes {
    const val CHATS = "chats"
    const val NOTIFICATIONS = "notifications"
    const val SETTINGS = "settings"
    const val CONVERSATION = "conversation/{id}?at={at}"
    const val SPACE = "space/{id}"
    const val CHAT_INFO = "chat-info/{id}"
    const val NEW_CHAT = "new-chat?group={group}"
    const val SITE = "site?path={path}"
    const val TODAY = "today"
    const val MY_WORK = "my-work"
    const val TASK = "task/{id}"
    val TABS = setOf(TODAY, CHATS, MY_WORK, NOTIFICATIONS, SETTINGS)
    fun task(id: String) = "task/$id"
    /** the screens that draw their own top bar (and the «بدون اتصال» line under it) */
    val OWN_BAR = setOf(CONVERSATION, SPACE, CHAT_INFO, NEW_CHAT, TASK)
    fun conversation(id: String, at: String? = null) = "conversation/$id" + (at?.let { "?at=${Uri.encode(it)}" } ?: "")
    fun space(id: String) = "space/$id"
    fun chatInfo(id: String) = "chat-info/$id"
    fun newChat(group: Boolean) = "new-chat?group=$group"
    fun site(path: String) = "site?path=${Uri.encode(path)}"
}

/** The sections not native yet, opened as the site's page (⚠️ WebBridge) until their phase. */
private data class SiteItem(val label: String, val path: String, val icon: ImageVector)

private val SITE_ITEMS = listOf(
    SiteItem(T.projects, "/projects", Icons.Filled.ViewKanban),
    SiteItem(T.calendar, "/calendar", Icons.Filled.CalendarMonth),
    SiteItem(T.files, "/files", Icons.Filled.Folder),
    SiteItem(T.goals, "/goals", Icons.Filled.Flag),
    SiteItem(T.ideas, "/ideas", Icons.Filled.Lightbulb),
    SiteItem(T.teams, "/teams", Icons.Filled.Groups),
    // the profile, the password, the company's settings: the native «الإعدادات» tab has only what lives on the phone
    SiteItem(T.accountSettings, "/settings", Icons.Filled.ManageAccounts),
    SiteItem(T.guide, "/guide", Icons.AutoMirrored.Filled.MenuBook),
)

fun NavHostController.open(dest: Destination) {
    when (dest) {
        // never «single top» here: another conversation (or another message of this one) must get a screen of its own, not the open one
        is Destination.Conversation -> navigate(Routes.conversation(dest.id, dest.at))
        Destination.Chats -> navigate(Routes.CHATS) { popUpTo(Routes.CHATS); launchSingleTop = true }
        Destination.Notifications -> navigate(Routes.NOTIFICATIONS) { popUpTo(Routes.CHATS); launchSingleTop = true }
        Destination.Settings -> navigate(Routes.SETTINGS) { popUpTo(Routes.CHATS); launchSingleTop = true }
        Destination.Today -> navigate(Routes.TODAY) { popUpTo(Routes.CHATS); launchSingleTop = true }
        Destination.MyWork -> navigate(Routes.MY_WORK) { popUpTo(Routes.CHATS); launchSingleTop = true }
        is Destination.Task -> navigate(Routes.task(dest.id))
        is Destination.Site -> navigate(Routes.site(dest.path)) { launchSingleTop = true }
    }
}

/**
 * THE SHELL: the drawer (the person, the spaces with their numbers, the sections), the top bar, the three tabs (الدردشات ·
 * الإشعارات · الإعدادات), the «بدون اتصال» bar, and the navigation between screens. A link that arrived from a notification
 * or a call ([link]) opens here.
 */
@Composable
fun Shell(
    link: String?,
    onLinkUsed: () -> Unit,
    makeBridge: () -> WebBridge,
    askNotifications: () -> Unit,
    vm: ShellViewModel = hiltViewModel(),
) {
    val nav = rememberNavController()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val me by vm.session.me.collectAsStateWithLifecycle()
    val spaces by vm.spaces.collectAsStateWithLifecycle()
    val chatUnread by vm.chatUnread.collectAsStateWithLifecycle()
    val notesUnread by vm.notesUnread.collectAsStateWithLifecycle()
    val online by vm.connectivity.online.collectAsStateWithLifecycle()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: Routes.CHATS
    WhileOnScreen(30_000) { vm.refresh() }
    LaunchedEffect(route) { vm.screen(route.substringBefore('/').substringBefore('?')) }

    LaunchedEffect(link) {
        if (link != null) {
            Links.destinationOf(link, Config.BASE)?.let { nav.open(it) }
            onLinkUsed()
        }
    }
    val openPath: (String) -> Unit = { path -> Links.destinationOf(path, Config.BASE)?.let { nav.open(it) } }

    val currentSpace = spaces?.organizations?.flatMap { it.workspaces }?.firstOrNull { it.id == spaces?.currentSpaceId }

    // «رجوع» with the drawer open closes the drawer, never the app
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }

    ModalNavigationDrawer(
        drawerState = drawer,
        // the drawer opens by its button only, as the owner asked of the orders app (no swipe that fights the lists)
        gesturesEnabled = drawer.isOpen,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = Zk.colors.surface1) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    val m = me
                    Column(Modifier.fillMaxWidth().background(Zk.colors.surface2).padding(20.dp)) {
                        Avatar(m?.name.orEmpty(), url = m?.avatarUrl, size = 64.dp, hue = m?.hue)
                        Spacer(Modifier.height(10.dp))
                        Text(m?.name.orEmpty(), style = MaterialTheme.typography.titleMedium)
                        val handle = m?.username?.let { handleOf(it) } ?: m?.email
                        if (handle != null) Text(handle, style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted)
                    }
                    Text(T.spaces, color = Zk.colors.accent, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 4.dp))
                    for (org in spaces?.organizations.orEmpty()) {
                        for (s in org.workspaces) {
                            val here = s.id == spaces?.currentSpaceId
                            Row(
                                Modifier.fillMaxWidth().clickable { vm.enter(s.id); scope.launch { drawer.close() } }
                                    .background(if (here) Zk.colors.selectedRow else Zk.colors.surface1)
                                    .padding(horizontal = 20.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(Modifier.size(32.dp).clip(CircleShape).background(Zk.colors.surface2), contentAlignment = Alignment.Center) {
                                    Text(s.emoji?.takeIf { it.isNotBlank() } ?: s.name.take(1))
                                }
                                Spacer(Modifier.width(12.dp))
                                Text(s.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f), color = if (here) Zk.colors.selectedRowFg else Zk.colors.fg)
                                CountBadge(s.unread + (s.waiting ?: 0))
                            }
                        }
                    }
                    HorizontalDivider(color = Zk.colors.border, modifier = Modifier.padding(vertical = 8.dp))
                    for (item in SITE_ITEMS) {
                        NavigationDrawerItem(
                            label = { Text(item.label) },
                            icon = { Icon(item.icon, contentDescription = null) },
                            selected = false,
                            onClick = { nav.open(Destination.Site(item.path)); scope.launch { drawer.close() } },
                            colors = NavigationDrawerItemDefaults.colors(unselectedContainerColor = Zk.colors.surface1),
                            modifier = Modifier.padding(horizontal = 8.dp),
                        )
                    }
                }
            }
        },
    ) {
        val onTab = route in Routes.TABS
        Scaffold(
            containerColor = Zk.colors.surface,
            // the bars below take their own insets; a screen without them (a conversation) takes its own: never twice
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                if (onTab) {
                    TopAppBar(
                        navigationIcon = { IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, contentDescription = T.menu) } },
                        title = {
                            Text(
                                when (route) {
                                    Routes.NOTIFICATIONS -> T.notifications
                                    Routes.MY_WORK -> io.zakiai.workspace.feature.work.W.myWork
                                    Routes.SETTINGS -> T.settings
                                    else -> currentSpace?.let { "${it.emoji ?: ""} ${it.name}".trim() } ?: T.appName
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
                    )
                } else if (route == Routes.SITE) {
                    TopAppBar(
                        navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                        title = { Text(T.appName) },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
                    )
                }
            },
            bottomBar = {
                if (onTab) {
                    NavigationBar(containerColor = Zk.colors.surface1) {
                        TabItem(T.today, route == Routes.TODAY, 0, Icons.Filled.Today) { nav.open(Destination.Today) }
                        TabItem(T.chats, route == Routes.CHATS, chatUnread, Icons.Filled.ChatBubble) { nav.open(Destination.Chats) }
                        TabItem(T.myWork, route == Routes.MY_WORK, 0, Icons.Filled.TaskAlt) { nav.open(Destination.MyWork) }
                        TabItem(T.notifications, route == Routes.NOTIFICATIONS, notesUnread, Icons.Filled.Notifications) { nav.open(Destination.Notifications) }
                        TabItem(T.settings, route == Routes.SETTINGS, 0, Icons.Filled.Settings) { nav.open(Destination.Settings) }
                    }
                }
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                // a conversation has no shell bar above it: it draws the line under its own top bar
                OfflineBar(!online && route !in Routes.OWN_BAR)
                NavHost(nav, startDestination = Routes.CHATS, modifier = Modifier.weight(1f)) {
                    composable(Routes.CHATS) {
                        ChatListScreen(
                            onOpen = { id, at -> nav.open(Destination.Conversation(id, at)) },
                            onOpenSpace = { nav.navigate(Routes.space(it)) { launchSingleTop = true } },
                            onNewChat = { group -> nav.navigate(Routes.newChat(group)) { launchSingleTop = true } },
                        )
                    }
                    composable(Routes.NOTIFICATIONS) { NotificationsScreen(onOpenPath = openPath) }
                    // both read the space the person is in: entering another one reloads them
                    composable(Routes.TODAY) { TodayScreen(onOpenTask = { nav.open(Destination.Task(it)) }, onOpenPath = openPath, onOpenSite = { nav.open(Destination.Site(it)) }, spaceKey = spaces?.currentSpaceId) }
                    composable(Routes.MY_WORK) { MyWorkScreen(onOpenTask = { nav.open(Destination.Task(it)) }, onOpenSite = { nav.open(Destination.Site(it)) }, spaceKey = spaces?.currentSpaceId) }
                    composable(Routes.TASK, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        TaskScreen(onBack = { nav.popBackStack() })
                    }
                    composable(Routes.SETTINGS) { SettingsScreen(askNotifications = askNotifications) }
                    composable(
                        Routes.CONVERSATION,
                        arguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("at") { type = NavType.StringType; nullable = true; defaultValue = null }),
                    ) {
                        ConversationScreen(
                            offline = !online,
                            onBack = { nav.popBackStack() },
                            onOpenPath = openPath,
                            onInfo = { nav.navigate(Routes.chatInfo(it)) { launchSingleTop = true } },
                        )
                    }
                    composable(Routes.SPACE, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        SpaceTopicsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.open(Destination.Conversation(it)) })
                    }
                    composable(Routes.CHAT_INFO, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        ChatInfoScreen(
                            onBack = { nav.popBackStack() },
                            onLeft = { nav.navigate(Routes.CHATS) { popUpTo(Routes.CHATS) { inclusive = true } } },
                            onOpen = { nav.open(Destination.Conversation(it)) },
                        )
                    }
                    composable(Routes.NEW_CHAT, arguments = listOf(navArgument("group") { type = NavType.BoolType; defaultValue = false })) {
                        NewChatScreen(onBack = { nav.popBackStack() }, onOpen = { id ->
                            nav.navigate(Routes.conversation(id)) { popUpTo(Routes.CHATS) }
                        })
                    }
                    composable(Routes.SITE, arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = "/" })) { e ->
                        WebPage(e.arguments?.getString("path") ?: "/", makeBridge) { nav.popBackStack() }
                    }
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, selected: Boolean, badge: Int, icon: ImageVector, onClick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        icon = { BadgedBox(badge = { if (badge > 0) Badge(containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg) { Text(if (badge > 99) "99+" else badge.toString()) } }) { Icon(icon, contentDescription = label) } },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Zk.colors.accentFg,
            indicatorColor = Zk.colors.accent,
            selectedTextColor = Zk.colors.accent,
            unselectedIconColor = Zk.colors.fgMuted,
            unselectedTextColor = Zk.colors.fgMuted,
        ),
    )
}
