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
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Inventory2
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
import io.zakiai.workspace.ui.components.BarTab
import io.zakiai.workspace.ui.components.FloatingTabBar
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.ZkBar
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.sp
import io.zakiai.workspace.feature.work.MyWorkScreen
import io.zakiai.workspace.feature.projects.BoardScreen
import io.zakiai.workspace.feature.projects.GoalsScreen
import io.zakiai.workspace.feature.projects.ProjectScreen
import io.zakiai.workspace.feature.projects.ProjectsScreen
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocalLibrary
import androidx.compose.material.icons.filled.Movie
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
    /** «الشغل»: the site's work place, its tabs «مهامي» and «المشاريع» */
    const val WORK = "work?tab={tab}&v={v}"
    const val TASK = "task/{id}"
    const val PROJECT = "project/{id}"
    const val BOARD = "board/{id}"
    const val GOALS = "goals"
    const val LIBRARY = "library"
    const val DOCUMENT = "document/{id}"
    const val SHEET = "sheet/{id}"
    const val CALL = "call/{id}"
    const val APPROVAL = "approval/{id}"
    const val PEOPLE = "people"
    const val PERSON = "person/{id}"
    const val TICKET = "ticket/{id}"
    const val STALE = "stale"
    /** the cards of the space: a tab of the bar in a space of cards, a screen of its own elsewhere */
    const val CARDS = "cards"
    const val CARDS_OPENED = "cards-opened"
    const val CARD = "card/{id}"
    /** آ«ط¥ط¹ط¯ط§ط¯ط§طھظٹآ»: one section; آ«ط¯ظ„ظٹظ„ ط²ط§ظƒظٹآ» and one article */
    const val ME = "me/{section}"
    const val GUIDE = "guide"
    const val GUIDE_ARTICLE = "guide/{slug}"
    /** آ«ظ†طھظپط±ظ‘ط¬ ط³ظˆط§آ»: a tab of the bar, and one session */
    const val WATCH = "watch"
    const val WATCH_SESSION = "watch/{id}"
    const val DEPARTMENTS = "departments"
    const val CRM = "crm"
    const val REPORTS = "reports"
    const val OWNER_BOARD = "owner-board"
    const val OWNER_PERSON = "board-person/{id}"
    const val MFG = "mfg"
    const val MFG_MATERIAL = "mfg-material/{id}"
    const val MFG_PART = "mfg-part/{tab}"
    val TABS = setOf(TODAY, CHATS, WORK, LIBRARY, NOTIFICATIONS, SETTINGS, CARDS, WATCH)
    fun task(id: String) = "task/$id"
    /** [view] is the tab inside «الموافقات» (`?v=` of the site's link) */
    fun work(tab: String, view: String? = null) = "work?tab=$tab" + (view?.let { "&v=${Uri.encode(it)}" } ?: "")
    fun project(id: String) = "project/$id"
    fun board(id: String) = "board/$id"
    /** the screens that draw their own top bar (and the «بدون اتصال» line under it) */
    val OWN_BAR = setOf(CONVERSATION, SPACE, CHAT_INFO, NEW_CHAT, TASK, PROJECT, BOARD, GOALS, DOCUMENT, SHEET, CALL, APPROVAL, PEOPLE, PERSON, TICKET, STALE, CARDS_OPENED, CARD, ME, GUIDE, GUIDE_ARTICLE, WATCH_SESSION, DEPARTMENTS, CRM, REPORTS, OWNER_BOARD, OWNER_PERSON, MFG, MFG_MATERIAL, MFG_PART)
    fun conversation(id: String, at: String? = null) = "conversation/$id" + (at?.let { "?at=${Uri.encode(it)}" } ?: "")
    fun space(id: String) = "space/$id"
    fun chatInfo(id: String) = "chat-info/$id"
    fun newChat(group: Boolean) = "new-chat?group=$group"
    fun site(path: String) = "site?path=${Uri.encode(path)}"
}

/** The sections not native yet, opened as the site's page (⚠️ WebBridge) until their phase. */
private data class SiteItem(val label: String, val path: String, val icon: ImageVector)

private val SITE_ITEMS = listOf(
    // «اللوحات» opens in every space (the site's /cards); in a space of cards it is also the first tab
    SiteItem(io.zakiai.workspace.feature.cards.K.title, "/cards", Icons.Filled.Dashboard),
    SiteItem(T.calendar, "/calendar", Icons.Filled.CalendarMonth),
    SiteItem(io.zakiai.workspace.feature.desks.Q.departments, "/departments", Icons.Filled.Groups),
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
        Destination.MyWork -> navigate(Routes.work("mine")) { popUpTo(Routes.CHATS); launchSingleTop = true }
        Destination.Projects -> navigate(Routes.work("projects")) { popUpTo(Routes.CHATS); launchSingleTop = true }
        is Destination.Project -> navigate(Routes.project(dest.id))
        is Destination.Board -> navigate(Routes.board(dest.id))
        Destination.Goals -> navigate(Routes.GOALS) { launchSingleTop = true }
        Destination.Library -> navigate(Routes.LIBRARY) { popUpTo(Routes.CHATS); launchSingleTop = true }
        is Destination.Document -> navigate("document/" + dest.id)
        is Destination.Sheet -> navigate("sheet/" + dest.id)
        is Destination.Call -> navigate("call/" + dest.id) { launchSingleTop = true }
        is Destination.Work -> navigate(Routes.work(dest.tab, dest.view)) { popUpTo(Routes.CHATS); launchSingleTop = true }
        is Destination.Approval -> navigate("approval/" + dest.id)
        Destination.People -> navigate(Routes.PEOPLE) { launchSingleTop = true }
        is Destination.Person -> navigate("person/" + dest.id)
        is Destination.Ticket -> navigate("ticket/" + dest.id)
        Destination.Stale -> navigate(Routes.STALE) { launchSingleTop = true }
        // the site's «جهات الاتصال» is the list of colleagues to message: the app's own new-chat list
        Destination.Contacts -> navigate(Routes.newChat(false)) { launchSingleTop = true }
        Destination.Cards -> navigate(Routes.CARDS_OPENED) { launchSingleTop = true }
        is Destination.Card -> navigate("card/" + dest.id)
        is Destination.Me -> navigate("me/" + dest.section)
        Destination.Guide -> navigate(Routes.GUIDE) { launchSingleTop = true }
        is Destination.GuideArticle -> navigate("guide/" + dest.slug)
        Destination.Watch -> navigate(Routes.WATCH) { popUpTo(Routes.CHATS); launchSingleTop = true }
        is Destination.WatchSession -> navigate("watch/" + dest.id)
        Destination.Departments -> navigate(Routes.DEPARTMENTS) { launchSingleTop = true }
        Destination.Crm -> navigate(Routes.CRM) { launchSingleTop = true }
        Destination.Reports -> navigate(Routes.REPORTS) { launchSingleTop = true }
        Destination.OwnerBoard -> navigate(Routes.OWNER_BOARD) { launchSingleTop = true }
        is Destination.OwnerBoardPerson -> navigate("board-person/" + dest.id)
        // the ledger's four parts replace one another (back leaves the ledger, not the last tab)
        Destination.Mfg -> if (!popBackStack(Routes.MFG, inclusive = false)) navigate(Routes.MFG) { launchSingleTop = true }
        is Destination.MfgMaterial -> navigate("mfg-material/" + dest.id)
        is Destination.MfgPart -> navigate("mfg-part/" + dest.tab) { popUpTo(Routes.MFG_PART) { inclusive = true }; launchSingleTop = true }
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
    // the chat search lives in the bar, as on the site's phone: null = the bar shows its title
    var chatQuery by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf<String?>(null) }
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
    // the manufacturing space the ledger opens on: the one the person is in, else the company's first one
    val mfgSpace: () -> String? = {
        val all = spaces?.organizations?.flatMap { it.workspaces }.orEmpty()
        (all.firstOrNull { it.id == spaces?.currentSpaceId && it.mfg } ?: all.firstOrNull { it.mfg })?.id
    }

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
                    // آ«ظ…ط®ط²ظˆظ† ط§ظ„طھطµظ†ظٹط¹آ»: only where the company has a space of آ«طھطµظ†ظٹط¹آ» (the ledger decides again who may open it)
                    if (spaces?.organizations?.any { o -> o.workspaces.any { it.mfg } } == true) NavigationDrawerItem(
                        label = { Text(io.zakiai.workspace.feature.mfg.w("mfg.title")) },
                        icon = { Icon(Icons.Filled.Inventory2, contentDescription = null) },
                        selected = false,
                        onClick = { nav.open(Destination.Mfg); scope.launch { drawer.close() } },
                        colors = NavigationDrawerItemDefaults.colors(unselectedContainerColor = Zk.colors.surface1),
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    for (item in SITE_ITEMS) {
                        NavigationDrawerItem(
                            label = { Text(item.label) },
                            icon = { Icon(item.icon, contentDescription = null) },
                            selected = false,
                            // a section that became native opens natively (the same rule as a link): «الأفكار» since N6
                            onClick = {
                                val native = when (item.path) {
                                    "/ideas" -> Destination.Work("ideas")
                                    "/calendar" -> Destination.Work("calendar")
                                    "/teams" -> Destination.People
                                    "/cards" -> Destination.Cards
                                    "/guide" -> Destination.Guide
                                    "/departments" -> Destination.Departments
                                    else -> null
                                }
                                nav.open(native ?: Destination.Site(item.path)); scope.launch { drawer.close() }
                            },
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
                    // the site's phone bar: 56 high on the surface, ☰, the title, and on the chats the search, which takes the bar's place
                    val query = chatQuery
                    if (route == Routes.CHATS && query != null) {
                        ChatSearchBar(query, onChange = { chatQuery = it }, onClose = { chatQuery = null })
                    } else {
                        ZkBar(
                            title = when (route) {
                                Routes.NOTIFICATIONS -> T.notifications
                                Routes.WORK -> io.zakiai.workspace.feature.projects.P.work
                                Routes.LIBRARY -> T.library
                                Routes.SETTINGS -> T.settings
                                Routes.CARDS -> io.zakiai.workspace.feature.cards.K.title
                                Routes.WATCH -> io.zakiai.workspace.feature.watch.V.title
                                else -> currentSpace?.let { "${it.emoji ?: ""} ${it.name}".trim() } ?: T.appName
                            },
                            start = { RoundIcon(Icons.Filled.Menu, T.menu, size = 24.dp) { scope.launch { drawer.open() } } },
                            actions = {
                                if (route == Routes.CHATS) RoundIcon(Icons.Filled.Search, io.zakiai.workspace.feature.chat.C.search) { chatQuery = "" }
                                // the site's bell at the top of every place, with its number
                                BellButton(notesUnread, route == Routes.NOTIFICATIONS) { nav.open(Destination.Notifications) }
                            },
                        )
                    }
                } else if (route == Routes.SITE) {
                    ZkBar(title = T.appName, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back) { nav.popBackStack() } })
                }
            },
            bottomBar = {
                if (onTab) {
                    // the floating tab bar of «شكل تيليجرام»
                    FloatingTabBar(
                        listOf(
                            // the site's phone places, in the site's order (src/lib/nav/places.ts): «المكتبة» and «نتفرّج سوا» are still the
                            // site's pages (⚠️ until their phase), «الإدارة» opens the phone's own settings and the site's panels from there
                            // a space of cards opens on «اللوحات» (the site's menu puts it first there, `CARDS_PLACE`), in «اليوم»'s place
                            if (currentSpace?.cards == true) BarTab(io.zakiai.workspace.feature.cards.K.title, Icons.Filled.Dashboard, route == Routes.CARDS, 0) {
                                nav.navigate(Routes.CARDS) { popUpTo(Routes.CHATS); launchSingleTop = true }
                            } else BarTab(T.today, Icons.Filled.Home, route == Routes.TODAY, 0) { nav.open(Destination.Today) },
                            BarTab(T.chat, Icons.Filled.ChatBubbleOutline, route == Routes.CHATS, chatUnread) { nav.open(Destination.Chats) },
                            BarTab(io.zakiai.workspace.feature.projects.P.work, Icons.Filled.TaskAlt, route == Routes.WORK, 0) { nav.open(Destination.MyWork) },
                            BarTab(T.library, Icons.Filled.LocalLibrary, route == Routes.LIBRARY, 0) { nav.open(Destination.Library) },
                            BarTab(T.watch, Icons.Filled.Movie, route == Routes.WATCH, 0) { nav.open(Destination.Watch) },
                            BarTab(T.admin, Icons.Filled.AdminPanelSettings, route == Routes.SETTINGS, 0) { nav.open(Destination.Settings) },
                        ),
                    )
                }
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                // a conversation has no shell bar above it: it draws the line under its own top bar
                OfflineBar(!online && route !in Routes.OWN_BAR)
                NavHost(nav, startDestination = Routes.CHATS, modifier = Modifier.weight(1f)) {
                    composable(Routes.CHATS) {
                        ChatListScreen(
                            query = chatQuery.orEmpty(),
                            onOpen = { id, at -> chatQuery = null; nav.open(Destination.Conversation(id, at)) },
                            onOpenSpace = { nav.navigate(Routes.space(it)) { launchSingleTop = true } },
                            onNewChat = { group -> nav.navigate(Routes.newChat(group)) { launchSingleTop = true } },
                        )
                    }
                    composable(Routes.NOTIFICATIONS) { NotificationsScreen(onOpenPath = openPath) }
                    // both read the space the person is in: entering another one reloads them
                    composable(Routes.TODAY) { TodayScreen(onOpenTask = { nav.open(Destination.Task(it)) }, onOpenPath = openPath, onOpenSite = { nav.open(Destination.Site(it)) }, spaceKey = spaces?.currentSpaceId) }
                    composable(
                        Routes.WORK,
                        arguments = listOf(
                            navArgument("tab") { type = NavType.StringType; defaultValue = "mine" },
                            navArgument("v") { type = NavType.StringType; nullable = true; defaultValue = null },
                        ),
                    ) { e ->
                        // «الشركة» (the space that holds no projects) is the view over every space: approvals there are not narrowed
                        val here = spaces?.organizations?.flatMap { it.workspaces }?.firstOrNull { it.id == spaces?.currentSpaceId }
                        WorkHub(
                            initial = e.arguments?.getString("tab") ?: "mine",
                            initialView = e.arguments?.getString("v"),
                            isHq = here?.holdsProjects == false,
                            onOpenTask = { nav.open(Destination.Task(it)) },
                            onOpenProject = { nav.open(Destination.Project(it)) },
                            onOpenGoals = { nav.open(Destination.Goals) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                            spaceKey = spaces?.currentSpaceId,
                            meId = me?.id,
                            onOpenApproval = { nav.open(Destination.Approval(it)) },
                            onOpenTicket = { nav.open(Destination.Ticket(it)) },
                            orgRole = (spaces?.organizations?.firstOrNull { o -> o.workspaces.any { it.id == spaces?.currentSpaceId } } ?: spaces?.organizations?.firstOrNull())?.role,
                            onOpenPath = openPath,
                        )
                    }
                    composable(Routes.PROJECT, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        ProjectScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.open(Destination.Task(it)) }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    composable(Routes.BOARD, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                        BoardScreen(boardId = e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onOpenTask = { nav.open(Destination.Task(it)) }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    composable(Routes.LIBRARY) {
                        io.zakiai.workspace.feature.library.LibraryHub(
                            spaceId = spaces?.currentSpaceId,
                            onOpenDoc = { nav.open(Destination.Document(it)) },
                            onOpenSheet = { nav.open(Destination.Sheet(it)) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                        )
                    }
                    composable(Routes.DOCUMENT, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.library.DocumentScreen(onBack = { nav.popBackStack() })
                    }
                    composable(Routes.APPROVAL, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.desk.ApprovalScreen(onBack = { nav.popBackStack() }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    // M2 N6 batch 2: «الناس», a person, one ticket
                    composable(Routes.PEOPLE) {
                        val org = spaces?.organizations?.firstOrNull { o -> o.workspaces.any { it.id == spaces?.currentSpaceId } } ?: spaces?.organizations?.firstOrNull()
                        io.zakiai.workspace.feature.office.PeopleScreen(
                            onBack = { nav.popBackStack() },
                            onOpenPerson = { nav.open(Destination.Person(it)) },
                            manager = org?.role == "OWNER" || org?.role == "ADMIN",
                            onOpenSite = { nav.open(Destination.Site(it)) },
                        )
                    }
                    composable(Routes.PERSON, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.office.ProfileScreen(onBack = { nav.popBackStack() }, onOpenChat = { nav.open(Destination.Conversation(it, null)) }, meId = me?.id, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    // M2 N6 batch 4: «اللوحات» (a tab in a space of cards, a screen of its own from the drawer or a link) and one card
                    composable(Routes.CARDS) {
                        io.zakiai.workspace.feature.cards.CardsScreen(spaceId = spaces?.currentSpaceId, onBack = null, onOpenCard = { nav.open(Destination.Card(it)) }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    composable(Routes.CARDS_OPENED) {
                        io.zakiai.workspace.feature.cards.CardsScreen(spaceId = spaces?.currentSpaceId, onBack = { nav.popBackStack() }, onOpenCard = { nav.open(Destination.Card(it)) }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    composable(Routes.CARD, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.cards.CardScreen(
                            onBack = { nav.popBackStack() },
                            onOpenCard = { nav.open(Destination.Card(it)) },
                            onOpenTask = { nav.open(Destination.Task(it)) },
                            onOpenChat = { id, at -> nav.open(Destination.Conversation(id, at)) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                            meId = me?.id,
                        )
                    }
                    composable(Routes.STALE) {
                        io.zakiai.workspace.feature.stale.StaleScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.open(Destination.Task(it)) })
                    }
                    composable(Routes.TICKET, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.office.TicketScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.open(Destination.Task(it)) }, onOpenSite = { nav.open(Destination.Site(it)) })
                    }
                    composable(Routes.CALL, arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                        io.zakiai.workspace.feature.calls.CallScreen(callId = e.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() })
                    }
                    composable(Routes.SHEET, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.library.SheetScreen(onBack = { nav.popBackStack() })
                    }
                    composable(Routes.GOALS) { GoalsScreen(onBack = { nav.popBackStack() }, onOpenSite = { nav.open(Destination.Site(it)) }) }
                    composable(Routes.TASK, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        TaskScreen(onBack = { nav.popBackStack() })
                    }
                    composable(Routes.SETTINGS) { SettingsScreen(
                            askNotifications = askNotifications,
                            onOpenMe = { nav.open(Destination.Me(it)) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                            onOpenAdmin = { key -> nav.open(when (key) { "board" -> Destination.OwnerBoard; "reports" -> Destination.Reports; else -> Destination.Crm }) },
                        )
                    }
                    // M2 N6 batch 7: آ«ط§ظ„ط¹ظ…ظ„ط§ط،آ», آ«ط§ظ„طھظ‚ط§ط±ظٹط±آ», the owner's board / panel and one person of it
                    // M2 N6 batch 8: آ«ظ…ط®ط²ظˆظ† ط§ظ„طھطµظ†ظٹط¹آ» of the manufacturing space (the space the person is in, else the company's first one)
                    composable(Routes.MFG) {
                        io.zakiai.workspace.feature.mfg.MfgHomeScreen(
                            spaceId = mfgSpace(),
                            onBack = { nav.popBackStack() },
                            onOpenMaterial = { nav.open(Destination.MfgMaterial(it)) },
                            onTab = { tab -> nav.open(Destination.MfgPart(tab)) },
                        )
                    }
                    composable(Routes.MFG_PART, arguments = listOf(navArgument("tab") { type = NavType.StringType })) { entry ->
                        val space = mfgSpace()
                        val back: () -> Unit = { if (!nav.popBackStack(Routes.MFG, inclusive = false)) nav.popBackStack() }
                        val tab: (String) -> Unit = { t -> nav.open(if (t == "materials") Destination.Mfg else Destination.MfgPart(t)) }
                        val material: (String) -> Unit = { nav.open(Destination.MfgMaterial(it)) }
                        when (entry.arguments?.getString("tab")) {
                            "orders" -> io.zakiai.workspace.feature.mfg.MfgOrdersScreen(space, back, tab, material)
                            "recipes" -> io.zakiai.workspace.feature.mfg.MfgRecipesScreen(space, back, tab, material)
                            else -> io.zakiai.workspace.feature.mfg.MfgReportsScreen(space, back, tab, material)
                        }
                    }
                    composable(Routes.MFG_MATERIAL, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.mfg.MaterialScreen(onBack = { nav.popBackStack() })
                    }
                    composable(Routes.CRM) { io.zakiai.workspace.feature.panel.CrmScreen(onBack = { nav.popBackStack() }) }
                    composable(Routes.REPORTS) { io.zakiai.workspace.feature.panel.ReportsScreen(onBack = { nav.popBackStack() }) }
                    composable(Routes.OWNER_BOARD) {
                        io.zakiai.workspace.feature.panel.BoardScreen(
                            meId = me?.id,
                            onBack = { nav.popBackStack() },
                            onOpenPerson = { nav.navigate("board-person/" + it) { if (it == me?.id) popUpTo(Routes.OWNER_BOARD) { inclusive = true } } },
                            onOpenPath = openPath,
                            onOpenSite = { nav.open(Destination.Site(it)) },
                        )
                    }
                    composable(Routes.OWNER_PERSON, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.panel.BoardPersonScreen(onBack = { nav.popBackStack() }, onOpenTask = { nav.open(Destination.Task(it)) })
                    }
                    // M2 N6 batch 5: آ«ط¥ط¹ط¯ط§ط¯ط§طھظٹآ» and آ«ط¯ظ„ظٹظ„ ط²ط§ظƒظٹآ»
                    composable(Routes.ME, arguments = listOf(navArgument("section") { type = NavType.StringType })) { e ->
                        io.zakiai.workspace.feature.me.MeSectionScreen(
                            section = e.arguments?.getString("section").orEmpty(),
                            onBack = { nav.popBackStack() },
                            onOpenSection = { nav.open(Destination.Me(it)) },
                            onOpenGuide = { nav.open(Destination.Guide) },
                            onOpenChat = { nav.open(Destination.Conversation(it)) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                        )
                    }
                    // M2 N6 batch 6: آ«ظ†طھظپط±ظ‘ط¬ ط³ظˆط§آ» (the room itself is the site's page inside the app, marked: YouTube's own player)
                    composable(Routes.WATCH) {
                        io.zakiai.workspace.feature.watch.WatchHomeScreen(onOpen = { nav.open(Destination.WatchSession(it)) }, spaceKey = spaces?.currentSpaceId)
                    }
                    composable(Routes.WATCH_SESSION, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                        io.zakiai.workspace.feature.watch.WatchSessionScreen(
                            onBack = { nav.popBackStack() },
                            onOpenChat = { nav.open(Destination.Conversation(it)) },
                            onOpenSite = { nav.open(Destination.Site(it)) },
                        )
                    }
                    composable(Routes.DEPARTMENTS) {
                        io.zakiai.workspace.feature.desks.DepartmentsScreen(
                            onBack = { nav.popBackStack() },
                            onOpenCampaigns = { nav.open(Destination.Work("campaigns", it)) },
                            onOpenTickets = { nav.open(Destination.Work("tickets")) },
                        )
                    }
                    composable(Routes.GUIDE) {
                        io.zakiai.workspace.feature.me.GuideScreen(onBack = { nav.popBackStack() }, onOpen = { nav.open(Destination.GuideArticle(it)) })
                    }
                    composable(Routes.GUIDE_ARTICLE, arguments = listOf(navArgument("slug") { type = NavType.StringType })) { e ->
                        io.zakiai.workspace.feature.me.GuideArticleScreen(
                            slug = e.arguments?.getString("slug").orEmpty(),
                            onBack = { nav.popBackStack() },
                            onOpen = { nav.navigate("guide/" + it) { popUpTo(Routes.GUIDE) } },
                            onOpenPath = openPath,
                        )
                    }
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

/** The search of the chats in the bar's place (the site's phone): â†گ, the field (16sp, no border), âœ• while it holds text. */
@Composable
private fun ChatSearchBar(query: String, onChange: (String) -> Unit, onClose: () -> Unit) {
    val focus = androidx.compose.runtime.remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    androidx.activity.compose.BackHandler(onBack = onClose)
    Column(Modifier.fillMaxWidth().background(Zk.colors.surface).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onClose)
            androidx.compose.foundation.text.BasicTextField(
                value = query,
                onValueChange = onChange,
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(Zk.colors.accent),
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp).focusRequester(focus),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (query.isEmpty()) Text(io.zakiai.workspace.feature.chat.C.search, fontSize = 16.sp, color = Zk.colors.fgMuted)
                        inner()
                    }
                },
            )
            if (query.isNotEmpty()) RoundIcon(Icons.Filled.Close, io.zakiai.workspace.feature.chat.C.cancel) { onChange("") }
        }
        HorizontalDivider(color = Zk.colors.border, thickness = 1.dp)
    }
}

/**
 * «الشغل», the site's work place on the phone: its tabs in the chat's folder strip — «مهامي» and «المشاريع» here, «الأهداف» as its own screen.
 */
@Composable
private fun WorkHub(
    initial: String,
    onOpenTask: (String) -> Unit,
    onOpenProject: (String) -> Unit,
    onOpenGoals: () -> Unit,
    onOpenSite: (String) -> Unit,
    spaceKey: String?,
    meId: String? = null,
    initialView: String? = null,
    isHq: Boolean = false,
    onOpenApproval: (String) -> Unit = {},
    onOpenTicket: (String) -> Unit = {},
    /** the person's rank in the company of the space they are in (what the site's tabs and marks depend on) */
    orgRole: String? = null,
    /** a site address, opened natively where the app has the page */
    onOpenPath: (String) -> Unit = onOpenSite,
) {
    var tab by androidx.compose.runtime.saveable.rememberSaveable(initial) { androidx.compose.runtime.mutableStateOf(initial) }
    Column(Modifier.fillMaxSize()) {
        io.zakiai.workspace.ui.components.PillStrip {
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.projects.P.myWork, 0, tab == "mine") { tab = "mine" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.projects.P.projects, 0, tab == "projects") { tab = "projects" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.office.O.calendar, 0, tab == "calendar") { tab = "calendar" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.projects.P.goals, 0, false) { onOpenGoals() }
            // M2 N6: the site's other work tabs, native
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.requests.R.title, 0, tab == "requests") { tab = "requests" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.desk.D.approvals, 0, tab == "approvals") { tab = "approvals" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.desk.D.ideas, 0, tab == "ideas") { tab = "ideas" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.desk.D.checkins, 0, tab == "checkins") { tab = "checkins" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.office.O.tickets, 0, tab == "tickets") { tab = "tickets" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.office.O.time, 0, tab == "time") { tab = "time" }
            // M2 N6 batch 6: آ«ط§ظ„ط­ظ…ظ„ط§طھآ» and آ«ط§ظ„ط±ظˆطھظٹظ† ط§ظ„ظٹظˆظ…ظٹآ» (each refuses for itself who may not read it, as the site's pages do)
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.desks.Q.campaigns, 0, tab == "campaigns") { tab = "campaigns" }
            io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.desks.Q.routine, 0, tab == "production") { tab = "production" }
            // the owner and the admins run spaces: «مهام قديمة» (the server decides who may; a space manager reaches it by its link too)
            if (orgRole == "OWNER" || orgRole == "ADMIN") io.zakiai.workspace.ui.components.PillTab(io.zakiai.workspace.feature.stale.S.title, 0, false) { onOpenPath("/my-work/stale") }
        }
        Box(Modifier.weight(1f)) {
            if (tab == "projects") {
                ProjectsScreen(onOpenProject = onOpenProject, onOpenSite = onOpenSite, spaceKey = spaceKey)
            } else if (tab == "approvals") {
                io.zakiai.workspace.feature.desk.ApprovalsScreen(spaceId = spaceKey, onOpen = onOpenApproval, narrowTo = if (isHq) null else spaceKey, initialView = initialView, onOpenSite = onOpenSite)
            } else if (tab == "ideas") {
                io.zakiai.workspace.feature.desk.IdeasScreen(spaceKey = spaceKey, meId = meId, isHq = isHq)
            } else if (tab == "checkins") {
                io.zakiai.workspace.feature.desk.CheckinsScreen(spaceId = spaceKey, onOpenSite = onOpenSite)
            } else if (tab == "requests") {
                io.zakiai.workspace.feature.requests.RequestsScreen(
                    spaceKey = spaceKey,
                    onOpenPath = onOpenPath,
                    approvalsFallback = {
                        io.zakiai.workspace.feature.desk.ApprovalsScreen(spaceId = spaceKey, onOpen = onOpenApproval, narrowTo = if (isHq) null else spaceKey, initialView = initialView, onOpenSite = onOpenSite)
                    },
                )
            } else if (tab == "calendar") {
                io.zakiai.workspace.feature.office.CalendarScreen(spaceKey = spaceKey, onOpenTask = onOpenTask, onOpenSite = onOpenSite, guest = orgRole == "GUEST")
            } else if (tab == "tickets") {
                io.zakiai.workspace.feature.office.TicketsScreen(onOpenTicket = onOpenTicket, onOpenSite = onOpenSite, manager = orgRole == "OWNER" || orgRole == "ADMIN")
            } else if (tab == "campaigns") {
                io.zakiai.workspace.feature.desks.CampaignsScreen(initialDept = initialView, meId = meId, onOpenTask = onOpenTask)
            } else if (tab == "production") {
                io.zakiai.workspace.feature.desks.ProductionScreen(onOpenTask = onOpenTask)
            } else if (tab == "time") {
                io.zakiai.workspace.feature.office.TimeScreen(spaceKey = spaceKey, onOpenTask = onOpenTask, onOpenSite = onOpenSite)
            } else {
                MyWorkScreen(onOpenTask = onOpenTask, onOpenSite = onOpenSite, spaceKey = spaceKey)
            }
        }
    }
}

/** The site's bell: a 44 round button with the unread number on its corner; the accent while the notifications are open. */
@Composable
private fun BellButton(count: Int, here: Boolean, onClick: () -> Unit) {
    Box {
        RoundIcon(Icons.Filled.Notifications, T.notifications, tint = if (here) Zk.colors.accent else Zk.colors.fg, onClick = onClick)
        if (count > 0) {
            Box(Modifier.align(Alignment.TopEnd).padding(top = 4.dp, end = 2.dp)) {
                io.zakiai.workspace.ui.components.CountPill(count, background = Zk.colors.danger, foreground = Zk.colors.dangerFg)
            }
        }
    }
}
