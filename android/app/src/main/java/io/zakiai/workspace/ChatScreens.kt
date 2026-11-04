package io.zakiai.workspace

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private val TIME = DateTimeFormatter.ofPattern("HH:mm")

/** «14:05» in the phone's own time zone, from the server's ISO time ("" when it cannot be read). */
fun clock(iso: String?): String =
    try {
        if (iso.isNullOrBlank()) "" else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(TIME)
    } catch (e: Exception) {
        ""
    }

@Composable
fun Badge(count: Int) {
    if (count <= 0) return
    Box(
        modifier = Modifier.clip(CircleShape).background(Zk.Accent).padding(horizontal = 7.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Zk.OnAccent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ChatRow(emoji: String?, title: String, preview: String?, time: String, unread: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Zk.Surface3), contentAlignment = Alignment.Center) {
            Text(emoji?.takeIf { it.isNotBlank() } ?: title.take(1), fontSize = 20.sp)
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!preview.isNullOrBlank()) Text(preview, fontSize = 13.sp, color = Zk.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (time.isNotEmpty()) Text(time, fontSize = 12.sp, color = Zk.Muted)
            Badge(unread)
        }
    }
}

/** The chat list: the topics of the person's spaces and their private chats, refreshed while the screen is on. */
@Composable
fun ChatListScreen(state: AppState) {
    var home by remember { mutableStateOf<Home?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(state.openConversation) {
        while (isActive) {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && state.openConversation == null) {
                try {
                    home = Api.home()
                    error = null
                    state.chatUnread = Api.chatUnread()
                } catch (e: ApiException) {
                    if (e.status == 401) state.signedIn = false else error = T.generic
                } catch (e: Exception) {
                    error = T.offline
                }
            }
            delay(8000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header(T.chat)
        val h = home
        when {
            h == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Zk.Accent) }
            h == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error ?: "", color = Zk.Danger) }
            h.spaces.all { s -> s.topics.none { !it.archived } } && h.dms.isEmpty() ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(T.noChats, color = Zk.Muted) }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                for (space in h.spaces) {
                    val topics = space.topics.filter { !it.archived }
                    if (topics.isEmpty()) continue
                    item(key = "space-${space.id}") {
                        Text(
                            "${space.emoji ?: ""} ${space.name}".trim(),
                            color = Zk.Accent,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                    }
                    items(topics, key = { "t-${it.id}" }) { t ->
                        ChatRow(t.emoji, t.title, t.lastMessage?.preview, clock(t.lastMessage?.at), t.unread) { state.openConversation = t.id }
                    }
                }
                if (h.dms.isNotEmpty()) {
                    item(key = "dm-header") {
                        Text(
                            T.privateChats,
                            color = Zk.Accent,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                    }
                    items(h.dms, key = { "d-${it.id}" }) { d ->
                        ChatRow(null, d.peer.name, d.lastMessage?.preview, clock(d.lastMessage?.at), d.unread) { state.openConversation = d.id }
                    }
                }
            }
        }
    }
}

@Composable
fun Header(title: String) {
    Column {
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp))
        HorizontalDivider(color = Zk.Surface3)
    }
}

@Composable
private fun Bubble(m: Message, showAuthor: Boolean, onAttachment: (String) -> Unit) {
    val system = m.kind == "SYSTEM"
    if (system) {
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            Text(T.systemMessage, color = Zk.Muted, fontSize = 12.sp)
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 3.dp), horizontalArrangement = if (m.mine) Arrangement.Start else Arrangement.End) {
        Column(
            Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(16.dp)).background(if (m.mine) Zk.Mine else Zk.Surface3).padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (showAuthor && !m.mine) Text(m.authorName, color = Zk.Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            when {
                m.deleted -> Text(T.deletedMessage, color = Zk.Muted, fontSize = 14.sp)
                !m.body.isNullOrBlank() -> Text(m.body, fontSize = 16.sp)
            }
            for (a in m.attachments) {
                Text(
                    "📎 ${a.name.ifBlank { T.attachment }}",
                    color = Zk.Accent,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 4.dp).clickable { onAttachment(a.url) },
                )
            }
            Text(clock(m.createdAt), color = Color(0xB3FFFFFF), fontSize = 11.sp, modifier = Modifier.align(Alignment.End).padding(top = 2.dp))
        }
    }
}

/** One conversation: its messages (the newest at the bottom), the composer, and a call button. Refreshes every few seconds while open. */
@Composable
fun ConversationScreen(state: AppState, id: String, onCall: (callId: String) -> Unit) {
    var conv by remember(id) { mutableStateOf<Conversation?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var text by remember(id) { mutableStateOf("") }
    var pending by remember(id) { mutableStateOf<List<Message>>(emptyList()) }
    var calling by remember(id) { mutableStateOf(false) }
    var lastRead by remember(id) { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    BackHandler { state.openConversation = null }

    LaunchedEffect(id) {
        while (isActive) {
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                try {
                    val c = Api.conversation(id)
                    conv = c
                    error = null
                    val last = c.messages.lastOrNull()
                    if (last != null && last.id != lastRead) {
                        lastRead = last.id
                        Api.markRead(id)
                    }
                    // the messages the server now has replace the ones that were waiting
                    pending = pending.filter { p -> c.messages.none { it.id == p.id } }
                } catch (e: ApiException) {
                    if (e.status == 401) state.signedIn = false else error = if (e.status == 403 || e.status == 404) T.cannotPost else T.generic
                } catch (e: Exception) {
                    error = T.offline
                }
            }
            delay(4000)
        }
    }

    fun send() {
        val body = text.trim()
        if (body.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        text = ""
        pending = pending + Message(id = "pending-$clientId", body = body, mine = true, createdAt = OffsetDateTime.now().toString())
        scope.launch {
            try {
                Api.send(id, body, clientId)
                conv = Api.conversation(id)
                pending = pending.filter { it.id != "pending-$clientId" }
            } catch (e: Exception) {
                pending = pending.filter { it.id != "pending-$clientId" }
                text = body
                error = if (e is ApiException) T.generic else T.offline
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { state.openConversation = null }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) }
            Text(
                "${conv?.emoji ?: ""} ${conv?.title ?: ""}".trim(),
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            val canCall = conv?.calls != false && conv?.me?.canCall != false
            if (conv != null && canCall) {
                IconButton(
                    enabled = !calling,
                    onClick = {
                        calling = true
                        scope.launch {
                            try {
                                onCall(Api.startCall(id).id)
                            } catch (e: Exception) {
                                error = if (e is ApiException) T.generic else T.offline
                            } finally {
                                calling = false
                            }
                        }
                    },
                ) { Icon(Icons.Filled.Phone, contentDescription = T.call, tint = Zk.Accent) }
            }
        }
        HorizontalDivider(color = Zk.Surface3)
        val c = conv
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (c == null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (error != null) Text(error!!, color = Zk.Danger) else CircularProgressIndicator(color = Zk.Accent)
                }
            } else {
                val shown = c.messages + pending
                val multi = c.kind != "DM"
                LazyColumn(Modifier.fillMaxSize(), reverseLayout = true) {
                    items(shown.asReversed(), key = { it.id }) { m -> Bubble(m, multi) { url -> state.open(url) } }
                }
            }
        }
        if (error != null && c != null) Text(error!!, color = Zk.Danger, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
        if (c != null && (!c.me.canPost || c.closed)) {
            Text(T.cannotPost, color = Zk.Muted, modifier = Modifier.fillMaxWidth().padding(16.dp))
        } else {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text(T.writeMessage, color = Zk.Muted) },
                    maxLines = 5,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = { send() },
                    enabled = text.isNotBlank(),
                    modifier = Modifier.size(52.dp).clip(CircleShape).background(if (text.isNotBlank()) Zk.Accent else Zk.Surface3),
                ) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = T.send, tint = Zk.OnAccent) }
            }
        }
        Spacer(Modifier.height(0.dp))
    }
}
