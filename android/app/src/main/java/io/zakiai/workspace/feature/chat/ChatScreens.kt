package io.zakiai.workspace.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.ChatHome
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.CountBadge
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.OfflineBar
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.clock
import io.zakiai.workspace.ui.components.shortTime
import io.zakiai.workspace.ui.theme.Zk

/** One row of the list: 72 dp, the round picture, title + time, preview + badge (the Telegram anatomy the owner asked for). */
@Composable
private fun ChatRow(title: String, emoji: String?, preview: String?, time: String, unread: Int, mentions: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(title, emoji = emoji, size = 54.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (time.isNotEmpty()) Text(time, style = MaterialTheme.typography.labelMedium, color = if (unread > 0) Zk.colors.accent else Zk.colors.fgMuted)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(preview.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (mentions > 0) {
                    Box(Modifier.padding(start = 6.dp).size(20.dp).clip(CircleShape).background(Zk.colors.accent), contentAlignment = Alignment.Center) {
                        Text("@", color = Zk.colors.accentFg, style = MaterialTheme.typography.labelSmall)
                    }
                }
                Spacer(Modifier.width(6.dp))
                CountBadge(unread)
            }
        }
    }
}

/** The chat list: each space with its topics, then the private chats. */
@Composable
fun ChatListScreen(onOpen: (String) -> Unit, vm: ChatListViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    WhileOnScreen(15_000) { vm.refresh() }
    val home: ChatHome? = state.data
    when {
        home == null && state.failure == null -> Loading()
        home == null -> Failure(state.failure!!.message, onRetry = vm::refresh)
        home.spaces.all { s -> s.topics.none { !it.archived } } && home.dms.isEmpty() -> Empty(T.noChats)
        else -> LazyColumn(Modifier.fillMaxSize()) {
            for (space in home.spaces) {
                val topics = space.topics.filter { !it.archived }
                if (topics.isEmpty()) continue
                item(key = "space-${space.id}") { SectionLabel("${space.emoji ?: ""} ${space.name}".trim()) }
                items(topics, key = { "t-${it.id}" }) { t ->
                    ChatRow(t.title, t.emoji, t.lastMessage?.preview, shortTime(t.lastMessage?.at), t.unread, t.mentions) { onOpen(t.id) }
                }
            }
            if (home.dms.isNotEmpty()) {
                item(key = "dm-header") { SectionLabel(T.privateChats) }
                items(home.dms, key = { "d-${it.id}" }) { d ->
                    ChatRow(d.peer.name, null, d.lastMessage?.preview, shortTime(d.lastMessage?.at), d.unread, 0) { onOpen(d.id) }
                }
            }
        }
    }
}

@Composable
private fun Bubble(line: Line, showAuthor: Boolean, onAttachment: (String) -> Unit, onRetry: () -> Unit, onDiscard: () -> Unit) {
    if (line.kind == "SYSTEM") {
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            Text(line.body ?: T.systemMessage, color = Zk.colors.fgMuted, style = MaterialTheme.typography.labelMedium)
        }
        return
    }
    val c = Zk.colors
    // right to left: my bubbles sit at the start (the right), the others' at the end — as on the site
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 2.dp), horizontalArrangement = if (line.mine) Arrangement.Start else Arrangement.End) {
        Column(
            Modifier.widthIn(max = 310.dp)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = if (line.mine) 4.dp else 16.dp, bottomEnd = if (line.mine) 16.dp else 4.dp))
                .background(if (line.mine) c.bubbleOut else c.bubbleIn)
                .padding(horizontal = 12.dp, vertical = 7.dp),
        ) {
            val fg = if (line.mine) c.bubbleOutFg else c.bubbleInFg
            if (showAuthor && !line.mine) Text(line.authorName, color = c.accent, style = MaterialTheme.typography.labelLarge)
            when {
                line.deleted -> Text(T.deletedMessage, color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.bodyMedium)
                !line.body.isNullOrBlank() -> Text(line.body, color = fg, style = MaterialTheme.typography.bodyLarge)
            }
            for (a in line.attachments) {
                Text("📎 ${a.name.ifBlank { T.attachment }}", color = if (line.mine) fg else c.accent, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp).clickable { onAttachment(a.url) })
            }
            Row(Modifier.align(Alignment.End).padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                when (line.outbox) {
                    "waiting" -> Icon(Icons.Filled.Schedule, contentDescription = T.waitingToSend, tint = fg.copy(alpha = 0.7f), modifier = Modifier.size(12.dp))
                    "refused" -> Icon(Icons.Filled.ErrorOutline, contentDescription = T.refusedToSend, tint = c.danger, modifier = Modifier.size(12.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text(clock(line.createdAt), color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
            }
            if (line.outbox == "refused") {
                Row {
                    TextButton(onClick = onRetry) { Text(T.retrySend, color = fg) }
                    TextButton(onClick = onDiscard) { Text(T.deleteUnsent, color = fg) }
                }
            }
        }
    }
}

/** One conversation: the messages (newest at the bottom), the composer pinned above the keyboard, and a call button. */
@Composable
fun ConversationScreen(offline: Boolean, onBack: () -> Unit, onOpenPath: (String) -> Unit, vm: ConversationViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val calling by vm.calling.collectAsStateWithLifecycle()
    WhileOnScreen(5_000) { vm.refresh() }
    // a row that left the outbox was sent: fetch it at once rather than wait for the next tick
    LaunchedEffect(pending.size) { vm.refresh() }
    val conv = state.data
    val lines = remember(conv, pending) { vm.linesOf(conv, pending) }

    Scaffold(
        containerColor = Zk.colors.chatWallpaper,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (conv != null) Avatar(conv.title, emoji = conv.emoji, size = 38.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(conv?.title.orEmpty(), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                actions = {
                    val canCall = conv != null && conv.calls != false && conv.me.canCall != false
                    if (canCall) {
                        IconButton(enabled = !calling, onClick = { vm.startCall { callId -> onOpenPath("/calls/$callId") } }) {
                            Icon(Icons.Filled.Call, contentDescription = T.call, tint = Zk.colors.accent)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
            )
        },
        bottomBar = {
            if (conv != null) {
                when {
                    conv.me.canPost && !conv.closed -> Composer(onSend = vm::send)
                    // the owner reading an open topic in silence: say so, and offer to join it (as the site does)
                    conv.me.canJoin -> Column(Modifier.fillMaxWidth().background(Zk.colors.surface1).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
                        Text(T.silentReading, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { vm.join() }, modifier = Modifier.fillMaxWidth()) { Text(T.joinChat, color = Zk.colors.accent, style = MaterialTheme.typography.titleSmall) }
                    }
                    else -> Text(T.cannotPost, color = Zk.colors.fgMuted, modifier = Modifier.fillMaxWidth().background(Zk.colors.surface1).navigationBarsPadding().padding(16.dp))
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
          OfflineBar(offline)
          Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                conv == null && state.failure == null -> Loading()
                conv == null -> Failure(state.failure!!.message, onRetry = vm::refresh)
                else -> {
                    val multi = conv.kind != "DM"
                    val shown = lines.asReversed()
                    LazyColumn(Modifier.fillMaxSize(), reverseLayout = true) {
                        items(shown.size, key = { shown[it].id }) { i ->
                            val line = shown[i]
                            val prev = shown.getOrNull(i + 1)
                            val showAuthor = multi && (prev == null || prev.authorName != line.authorName || prev.mine != line.mine)
                            Bubble(
                                line,
                                showAuthor,
                                onAttachment = { url -> onOpenPath(url) },
                                onRetry = { vm.retry(line.id.removePrefix("outbox-")) },
                                onDiscard = { vm.discard(line.id.removePrefix("outbox-")) },
                            )
                        }
                    }
                }
            }
          }
        }
    }
}

/** The composer: only the field redraws while typing; the text survives a rotation. */
@Composable
private fun Composer(onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    // pinned above the keyboard: the navigation bar's inset, or the keyboard's when it is open
    Column(Modifier.background(Zk.colors.surface1).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))) {
        HorizontalDivider(color = Zk.colors.border)
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            TextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text(T.writeMessage) },
                modifier = Modifier.weight(1f),
                maxLines = 6,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Zk.colors.surface1,
                    unfocusedContainerColor = Zk.colors.surface1,
                    focusedIndicatorColor = Zk.colors.surface1,
                    unfocusedIndicatorColor = Zk.colors.surface1,
                ),
            )
            IconButton(enabled = text.isNotBlank(), onClick = { onSend(text); text = "" }) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = T.send, tint = if (text.isNotBlank()) Zk.colors.accent else Zk.colors.fgMuted)
            }
        }
    }
}
