package io.zakiai.workspace.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.ConversationHeader
import io.zakiai.workspace.core.net.ConversationPeople
import io.zakiai.workspace.core.net.Directory
import io.zakiai.workspace.core.net.DmBody
import io.zakiai.workspace.core.net.GroupChange
import io.zakiai.workspace.core.net.MyChatState
import io.zakiai.workspace.core.net.NewGroupBody
import io.zakiai.workspace.core.net.NewTopicBody
import io.zakiai.workspace.core.net.SpaceTopics
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.core.sync.UserMark
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.CountBadge
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.shortTime
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// ── one space as a forum (a SPACE row of the list) ────────────────────────────────────────────────────────

@HiltViewModel
class SpaceTopicsViewModel @Inject constructor(savedState: SavedStateHandle, private val api: WorkspaceApi, private val session: Session) : ViewModel() {
    val spaceId: String = checkNotNull(savedState["id"])
    private val _state = MutableStateFlow<SpaceTopics?>(null)
    val state: StateFlow<SpaceTopics?> = _state.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()

    fun refresh() = viewModelScope.launch {
        when (val r = apiCall { api.spaceTopics(spaceId) }) {
            is ApiResult.Ok -> { _state.value = r.value; _failure.value = null }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
    }

    fun create(title: String, then: (String) -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.newTopic(spaceId, NewTopicBody(title)) }) {
            is ApiResult.Ok -> then(r.value.id)
            is ApiResult.Err -> _failure.value = r.failure
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpaceTopicsScreen(onBack: () -> Unit, onOpen: (String) -> Unit, vm: SpaceTopicsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }
    WhileOnScreen(20_000) { vm.refresh() }
    Scaffold(
        containerColor = Zk.colors.surface,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                title = { Text(listOfNotNull(state?.space?.emoji, state?.space?.name).joinToString(" "), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
            )
        },
        floatingActionButton = {
            if (state?.space?.canCreateTopic == true) FloatingActionButton(onClick = { creating = true }, containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg) { Icon(Icons.Filled.Add, contentDescription = C.create) }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val s = state
            when {
                s == null && failure == null -> Loading()
                s == null -> Failure(failure!!.message, onRetry = { vm.refresh() })
                s.rows.isEmpty() -> Empty(T.noChats)
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item { SectionLabel(C.topics) }
                    items(ChatMerge.ordered(s.rows), key = { it.id }) { r ->
                        Row(Modifier.fillMaxWidth().clickable { onOpen(r.id) }.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(r.title, emoji = r.emoji, size = 46.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (r.restricted) Icon(Icons.Filled.Lock, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp))
                                    Text(r.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    if (r.closed) Text(C.closedTopic, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted)
                                    Text(" " + shortTime(r.lastMessage?.at), style = MaterialTheme.typography.labelMedium, color = Zk.colors.fgMuted)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(previewOf(r), style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    CountBadge(r.unread, muted = r.muted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating) {
        var title by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { creating = false },
            containerColor = Zk.colors.surface1,
            title = { Text(C.topics) },
            text = { OutlinedTextField(title, { title = it.take(120) }, label = { Text(C.listTitle) }, singleLine = true) },
            confirmButton = { TextButton(enabled = title.isNotBlank(), onClick = { creating = false; vm.create(title.trim()) { onOpen(it) } }) { Text(C.create) } },
            dismissButton = { TextButton(onClick = { creating = false }) { Text(C.cancel) } },
        )
    }
}

// ── a new private chat, or a new group: the people of the company ─────────────────────────────────────────

@HiltViewModel
class NewChatViewModel @Inject constructor(savedState: SavedStateHandle, private val api: WorkspaceApi, private val user: UserMark) : ViewModel() {
    val group: Boolean = savedState.get<Boolean>("group") ?: false
    private val _people = MutableStateFlow<Directory?>(null)
    val people: StateFlow<Directory?> = _people.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    val me: String get() = user.id.orEmpty()

    init { load() }

    fun load() = viewModelScope.launch {
        when (val r = apiCall { api.directory() }) {
            is ApiResult.Ok -> _people.value = r.value
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun dm(userId: String, then: (String) -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.openDm(DmBody(userId = userId)) }) {
            is ApiResult.Ok -> then(r.value.id)
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun create(title: String, members: List<String>, then: (String) -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.newGroup(NewGroupBody(title = title, memberIds = members)) }) {
            is ApiResult.Ok -> then(r.value.id)
            is ApiResult.Err -> _failure.value = r.failure
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(onBack: () -> Unit, onOpen: (String) -> Unit, vm: NewChatViewModel = hiltViewModel()) {
    val people by vm.people.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(setOf<String>()) }
    Scaffold(
        containerColor = Zk.colors.surface,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                title = { Text(if (vm.group) C.newGroup else C.newMessage) },
                actions = {
                    if (vm.group) TextButton(enabled = title.trim().length >= 2 && picked.isNotEmpty(), onClick = { vm.create(title.trim(), picked.toList()) { onOpen(it) } }) {
                        Text(C.create, color = Zk.colors.accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (vm.group) OutlinedTextField(title, { title = it.take(60) }, label = { Text(C.groupName) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
            OutlinedTextField(query, { query = it }, label = { Text(C.search) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
            failure?.let { Text(it.message, color = Zk.colors.danger, modifier = Modifier.padding(12.dp)) }
            val list = people?.people.orEmpty().filter { it.user.id != vm.me && (query.isBlank() || it.user.name.contains(query.trim(), ignoreCase = true)) }
            when {
                people == null && failure == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(list, key = { it.user.id }) { p ->
                        val on = p.user.id in picked
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                if (vm.group) picked = if (on) picked - p.user.id else picked + p.user.id else vm.dm(p.user.id) { onOpen(it) }
                            }.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(p.user.name, url = p.user.avatarUrl, size = 44.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(p.user.name, style = MaterialTheme.typography.titleSmall)
                                p.user.jobTitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted) }
                            }
                            if (vm.group) Checkbox(on, { picked = if (on) picked - p.user.id else picked + p.user.id })
                        }
                    }
                }
            }
        }
    }
}

// ── who is in a conversation, and what I may do with it ───────────────────────────────────────────────────

@HiltViewModel
class ChatInfoViewModel @Inject constructor(savedState: SavedStateHandle, private val api: WorkspaceApi, private val store: ChatStore, private val user: UserMark) : ViewModel() {
    val id: String = checkNotNull(savedState["id"])
    private val _header = MutableStateFlow<ConversationHeader?>(null)
    val header: StateFlow<ConversationHeader?> = _header.asStateFlow()
    private val _people = MutableStateFlow<ConversationPeople?>(null)
    val people: StateFlow<ConversationPeople?> = _people.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    val me: String get() = user.id.orEmpty()

    init { load() }

    fun load() = viewModelScope.launch {
        launch { (apiCall { api.header(id) } as? ApiResult.Ok)?.let { _header.value = it.value } }
        when (val r = apiCall { api.people(id) }) {
            is ApiResult.Ok -> _people.value = r.value
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun mute(on: Boolean) = viewModelScope.launch {
        val r = if (on) apiCall { api.myState(id, MyChatState(mutedUntil = ChatListViewModel.FOREVER)) }
        else apiCall { api.myStateRaw(id, kotlinx.serialization.json.buildJsonObject { put("mutedUntil", kotlinx.serialization.json.JsonNull) }) }
        if (r is ApiResult.Err) _failure.value = r.failure else { store.patchRow(id) { it.copy(muted = on) }; load() }
    }

    fun removeMember(userId: String) = viewModelScope.launch {
        when (val r = apiCall { api.changeGroup(id, GroupChange(removeMemberIds = listOf(userId))) }) {
            is ApiResult.Ok -> load()
            is ApiResult.Err -> _failure.value = r.failure
        }
    }

    fun leave(then: () -> Unit) = viewModelScope.launch {
        when (val r = apiCall { api.leave(id) }) {
            is ApiResult.Ok -> then()
            is ApiResult.Err -> _failure.value = r.failure
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatInfoScreen(onBack: () -> Unit, onLeft: () -> Unit, onOpen: (String) -> Unit, vm: ChatInfoViewModel = hiltViewModel()) {
    val h by vm.header.collectAsStateWithLifecycle()
    val people by vm.people.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    var leaving by remember { mutableStateOf(false) }
    Scaffold(
        containerColor = Zk.colors.surface,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                title = { Text(C.info) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize().navigationBarsPadding()) {
            item {
                Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Avatar(h?.title.orEmpty(), url = h?.peer?.avatarUrl, emoji = h?.emoji, size = 84.dp)
                    Spacer(Modifier.size(10.dp))
                    Text(h?.title.orEmpty(), style = MaterialTheme.typography.titleLarge)
                    h?.space?.let { Text(it.name, style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted) }
                    val count = h?.memberCount ?: 0
                    if (count > 0) Text("$count ${C.members}", style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted)
                }
                // ⚠️ the honest line of a private chat (P0.4): somebody outside it may read it
                if (h?.oversightNotice == true) Text(C.oversightNotice, color = Zk.colors.warn, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                failure?.let { Text(it.message, color = Zk.colors.danger, modifier = Modifier.padding(horizontal = 20.dp)) }
                HorizontalDivider(color = Zk.colors.border)
                val muted = h?.me?.muted == true
                MenuItem(if (muted) C.unmute else C.mute, if (muted) Icons.Filled.NotificationsActive else Icons.Filled.NotificationsOff) { vm.mute(!muted) }
                if (h?.kind == "GROUP") MenuItem(C.leave, Icons.AutoMirrored.Filled.ExitToApp, danger = true) { leaving = true }
                HorizontalDivider(color = Zk.colors.border)
                SectionLabel(C.people)
            }
            val members = people?.members.orEmpty()
            if (people == null && failure == null) item { Loading(Modifier.fillMaxWidth().padding(24.dp)) }
            items(members, key = { it.id }) { m ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        Avatar(m.name, url = m.avatarUrl, size = 42.dp)
                        if (m.online) Box(Modifier.align(Alignment.BottomEnd).size(10.dp).padding(1.dp)) { Icon(Icons.Filled.Check, null, tint = Zk.colors.ok, modifier = Modifier.size(10.dp)) }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(m.name, style = MaterialTheme.typography.titleSmall)
                        m.role?.let { Text(io.zakiai.workspace.feature.chat.roleLabel(it), style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted) }
                    }
                    val header = h
                    if (header?.kind == "GROUP" && header.me.canModerate && m.id != vm.me) {
                        IconButton(onClick = { vm.removeMember(m.id) }) { Icon(Icons.Filled.PersonRemove, contentDescription = C.remove, tint = Zk.colors.fgMuted) }
                    }
                }
            }
        }
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            containerColor = Zk.colors.surface1,
            text = { Text(C.leaveAsk) },
            confirmButton = { TextButton(onClick = { leaving = false; vm.leave(onLeft) }) { Text(C.leave, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text(C.cancel) } },
        )
    }
}

/** A member's role in a conversation, in Arabic (never the raw word). */
fun roleLabel(role: String): String = when (role.uppercase()) {
    "OWNER" -> "المالك"
    "ADMIN" -> "مشرف"
    "LEAD" -> "قائد"
    "GUEST" -> "شريك خارجي"
    "MODERATOR" -> "مشرف"
    else -> "عضو"
}
