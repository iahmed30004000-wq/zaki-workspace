package io.zakiai.workspace.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MarkChatRead
import androidx.compose.material.icons.filled.MarkChatUnread
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.ChatRow
import io.zakiai.workspace.core.net.MyChatState
import io.zakiai.workspace.core.net.SearchAnswer
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

/**
 * THE CHAT LIST: the search, the tabs (the built-in ones and the person's own folders), the rows (my pins first, then the newest), a
 * long press for my own state of a row, and «جديد» (a message to somebody, a group, the saved messages).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    onOpen: (id: String, at: String?) -> Unit,
    onOpenSpace: (String) -> Unit,
    onNewChat: (group: Boolean) -> Unit,
    vm: ChatListViewModel = hiltViewModel(),
) {
    val list by vm.list.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val connected by vm.live.connected.collectAsStateWithLifecycle()
    val found by vm.search.collectAsStateWithLifecycle()

    // the live line keeps the list current; without it, the list asks every 15 seconds (and once on opening, always)
    WhileOnScreen(if (connected) 120_000 else 15_000, connected) { vm.refresh() }

    var query by rememberSaveable { mutableStateOf("") }
    var tabKey by rememberSaveable { mutableStateOf(ListTab.All.key) }
    var menuOf by remember { mutableStateOf<ChatRow?>(null) }
    var newMenu by remember { mutableStateOf(false) }

    val rows = list?.rows.orEmpty()
    val folders = prefs?.let { p -> if (p.foldersOn) p.prefs.folders[p.orgId].orEmpty() else emptyList() }.orEmpty()
    val hidden = prefs?.prefs?.tabs?.hidden.orEmpty().toSet()
    val tabs = buildList {
        add(ListTab.All)
        for (t in listOf(ListTab.Unread, ListTab.Dms, ListTab.Spaces, ListTab.Mentions)) if (t.key !in hidden) add(t)
        folders.forEach { add(ListTab.Custom(it)) }
        if (rows.any { it.archivedByMe }) add(ListTab.Archive)
    }
    val tab = tabs.firstOrNull { it.key == tabKey } ?: ListTab.All

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            SearchField(query, onChange = { query = it; vm.search(it) })
            if (query.isBlank()) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (t in tabs) {
                        val label = when (t) {
                            ListTab.All -> C.all
                            ListTab.Unread -> C.unread
                            ListTab.Dms -> C.dms
                            ListTab.Spaces -> C.spaces
                            ListTab.Mentions -> C.mentions
                            ListTab.Archive -> C.archive
                            is ListTab.Custom -> listOfNotNull(t.folder.emoji, t.folder.name).joinToString(" ")
                        }
                        TabChip(label, ChatFilter.badge(rows, t), t.key == tab.key) { tabKey = t.key }
                    }
                }
                HorizontalDivider(color = Zk.colors.border)
            }
            Box(Modifier.weight(1f)) {
                when {
                    query.isNotBlank() -> SearchResults(found, rows, onOpen = onOpen, onPerson = { p -> if (p.dmId != null) onOpen(p.dmId, null) else vm.openDm(p.id) { onOpen(it, null) } })
                    list == null && failure == null -> Loading()
                    list == null -> Failure(failure!!.message, onRetry = vm::refresh)
                    else -> {
                        val shown = ChatMerge.ordered(ChatFilter.of(rows, tab))
                        if (shown.isEmpty()) Empty(if (tab == ListTab.Archive) C.noArchive else T.noChats)
                        else LazyColumn(Modifier.fillMaxSize()) {
                            items(shown, key = { it.kind + it.id }) { r ->
                                Row_(r, onClick = { if (r.kind == "SPACE") onOpenSpace(r.id) else onOpen(r.id, null) }, onLong = { menuOf = r })
                            }
                        }
                    }
                }
            }
        }
        Box(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
            FloatingActionButton(onClick = { newMenu = true }, containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg) {
                Icon(Icons.Filled.Create, contentDescription = C.newChat)
            }
            DropdownMenu(expanded = newMenu, onDismissRequest = { newMenu = false }) {
                DropdownMenuItem(text = { Text(C.newMessage) }, leadingIcon = { Icon(Icons.Filled.Search, null) }, onClick = { newMenu = false; onNewChat(false) })
                DropdownMenuItem(text = { Text(C.newGroup) }, leadingIcon = { Icon(Icons.Filled.GroupAdd, null) }, onClick = { newMenu = false; onNewChat(true) })
                DropdownMenuItem(text = { Text(C.saved) }, leadingIcon = { Icon(Icons.Filled.Bookmark, null) }, onClick = { newMenu = false; vm.openSaved { onOpen(it, null) } })
            }
        }
    }

    menuOf?.let { r ->
        ModalBottomSheet(onDismissRequest = { menuOf = null }, sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Zk.colors.surface1) {
            RowMenu(r, personal = list?.personal != false, vm = vm, close = { menuOf = null })
        }
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    TextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(C.search) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Close, contentDescription = C.cancel) } },
        singleLine = true,
        shape = RoundedCornerShape(24.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Zk.colors.surface2,
            unfocusedContainerColor = Zk.colors.surface2,
            focusedIndicatorColor = Zk.colors.surface2,
            unfocusedIndicatorColor = Zk.colors.surface2,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

@Composable
private fun TabChip(label: String, badge: Int, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(if (selected) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = if (selected) Zk.colors.accentFg else Zk.colors.fg, style = MaterialTheme.typography.labelLarge)
        if (badge > 0) {
            Spacer(Modifier.width(6.dp))
            Text(if (badge > 99) "99+" else "$badge", color = if (selected) Zk.colors.accentFg else Zk.colors.accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        }
    }
}

/** What a row's second line says: who wrote last (in a shared chat), what (a picture, a voice note, a list…), or that it was deleted. */
fun previewOf(r: ChatRow): String {
    val m = r.lastMessage ?: return ""
    val text = when {
        m.preview == null -> C.deletedPreview
        m.kind == "CHECKLIST" -> "☑️ ${m.preview}" + (m.checklist?.let { " (${it.done}/${it.total})" } ?: "")
        m.kind == "POLL" -> "📊 ${m.preview}"
        else -> m.preview
    }
    val who = when {
        m.kind == "SYSTEM" -> null
        m.mine -> C.you
        r.kind == "DM" -> null
        else -> m.authorName.takeIf { it.isNotBlank() }
    }
    return if (who != null) "$who: $text" else text
}

/** One row: 72 dp, the round picture, title + time (and my pin, my mute), preview + the unread number (grey when muted). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Row_(r: ChatRow, onClick: () -> Unit, onLong: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLong).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(r.title, url = r.avatarUrl, emoji = r.emoji, size = 54.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (r.restricted) Icon(Icons.Filled.Lock, contentDescription = null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp).padding(end = 2.dp))
                Text(r.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (r.muted) Icon(Icons.Filled.NotificationsOff, contentDescription = C.mute, tint = Zk.colors.fgMuted, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                Spacer(Modifier.weight(1f))
                val last = r.lastMessage
                if (last?.mine == true && last.status != null) {
                    Icon(if (last.status == "sent") Icons.Filled.Done else Icons.Filled.DoneAll, contentDescription = null, tint = if (last.status == "read") Zk.colors.accent else Zk.colors.fgMuted, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(3.dp))
                }
                Text(shortTime(last?.at), style = MaterialTheme.typography.labelMedium, color = if (ChatFilter.hasUnread(r) && !r.muted) Zk.colors.accent else Zk.colors.fgMuted)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    if (r.space != null && r.kind == "TOPIC") Text(r.space.name, style = MaterialTheme.typography.labelSmall, color = Zk.colors.accent, maxLines = 1)
                    Text(previewOf(r), style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (r.kind == "SPACE" && r.topicChips.isNotEmpty()) {
                        Text(r.topicChips.joinToString("  ·  ") { listOfNotNull(it.emoji, it.title).joinToString(" ") }, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (r.mentionsUnread > 0) {
                    Box(Modifier.padding(start = 6.dp).size(20.dp).clip(CircleShape).background(Zk.colors.accent), contentAlignment = Alignment.Center) {
                        Text("@", color = Zk.colors.accentFg, style = MaterialTheme.typography.labelSmall)
                    }
                }
                if (r.pinnedByMe && !ChatFilter.hasUnread(r)) Icon(Icons.Filled.PushPin, contentDescription = C.pin, tint = Zk.colors.fgMuted, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                Spacer(Modifier.width(6.dp))
                if (r.markedUnread && r.unread == 0) Box(Modifier.size(12.dp).clip(CircleShape).background(if (r.muted) Zk.colors.badgeMuted else Zk.colors.accent))
                else CountBadge(r.unread, muted = r.muted)
            }
        }
    }
}

/** A long press on a row: my own pin, archive, unread mark and mute — mine alone, nobody else sees them. */
@Composable
private fun RowMenu(r: ChatRow, personal: Boolean, vm: ChatListViewModel, close: () -> Unit) {
    Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
        Text(r.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (ChatFilter.hasUnread(r)) MenuItem(C.markRead, Icons.Filled.MarkChatRead) { vm.markRead(r); close() }
        if (!personal || r.kind == "SPACE") return@Column
        if (!ChatFilter.hasUnread(r)) MenuItem(C.markUnread, Icons.Filled.MarkChatUnread) { vm.setState(r, MyChatState(markedUnread = true)); close() }
        MenuItem(if (r.pinnedByMe) C.unpin else C.pin, Icons.Filled.PushPin) { vm.setState(r, MyChatState(pinned = !r.pinnedByMe)); close() }
        MenuItem(if (r.archivedByMe) C.fromArchive else C.toArchive, if (r.archivedByMe) Icons.Filled.Unarchive else Icons.Filled.Archive) { vm.setState(r, MyChatState(archived = !r.archivedByMe)); close() }
        if (r.muted) MenuItem(C.unmute, Icons.Filled.NotificationsActive) { vm.setState(r, MyChatState(), unmute = true); close() }
        else {
            SectionLabel(C.mute)
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((label, until) in listOf(C.muteHour to { ChatListViewModel.muteFor(1) }, C.mute8 to { ChatListViewModel.muteFor(8) }, C.muteDay to { ChatListViewModel.muteFor(24) }, C.muteForever to { ChatListViewModel.FOREVER })) {
                    TabChip(label, 0, false) { vm.setState(r, MyChatState(mutedUntil = until())); close() }
                }
            }
        }
    }
}

@Composable
fun MenuItem(label: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(label, color = if (danger) Zk.colors.danger else Zk.colors.fg) },
        leadingContent = { Icon(icon, contentDescription = null, tint = if (danger) Zk.colors.danger else Zk.colors.fgMuted) },
        colors = ListItemDefaults.colors(containerColor = Zk.colors.surface1),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

/** The search: chats by name (the phone's own rows first), people (a tap opens or makes the private chat), and messages. */
@Composable
private fun SearchResults(found: SearchAnswer?, rows: List<ChatRow>, onOpen: (String, String?) -> Unit, onPerson: (io.zakiai.workspace.core.net.PersonHit) -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        val chats = found?.chats.orEmpty()
        if (chats.isNotEmpty()) {
            item { SectionLabel(C.searchChats) }
            items(chats, key = { "c-${it.id}" }) { c ->
                val row = rows.firstOrNull { it.id == c.id }
                HitRow(c.title, c.emoji, row?.avatarUrl, c.context) { onOpen(c.id, null) }
            }
        }
        val people = found?.people.orEmpty()
        if (people.isNotEmpty()) {
            item { SectionLabel(C.searchPeople) }
            items(people, key = { "p-${it.id}" }) { p -> HitRow(p.name, null, p.avatarUrl, p.jobTitle) { onPerson(p) } }
        }
        val messages = found?.messages.orEmpty()
        if (messages.isNotEmpty()) {
            item { SectionLabel(C.searchMessages) }
            items(messages, key = { "m-${it.id}" }) { m -> HitRow(m.conversationTitle, null, null, "${m.authorName}: ${m.snippet}", shortTime(m.at)) { onOpen(m.conversationId, m.id) } }
        }
        if (found != null && chats.isEmpty() && people.isEmpty() && messages.isEmpty()) item { Empty(C.nothingFound, Modifier.fillMaxWidth().padding(32.dp)) }
    }
}

@Composable
private fun HitRow(title: String, emoji: String?, avatar: String?, sub: String?, time: String = "", onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(title, url = avatar, emoji = emoji, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!sub.isNullOrBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Zk.colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (time.isNotEmpty()) Text(time, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted)
    }
}
