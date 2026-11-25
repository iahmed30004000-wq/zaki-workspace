package io.zakiai.workspace.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Shortcut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.core.net.ConversationHeader
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.OfflineBar
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.shortTime
import io.zakiai.workspace.ui.theme.Zk
import io.zakiai.workspace.ui.components.GlassHeader
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.components.chatWallpaper
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.SentimentSatisfied
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The six reactions a long press offers first (the site's own quick row). */
val QUICK_REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

/** The day a message belongs to, in the phone's time: «اليوم», «مبارح», or the date (Arabic month names, Western digits). */
fun dayLabel(iso: String, today: LocalDate = LocalDate.now()): String {
    val d = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull() ?: return ""
    return when (d) {
        today -> C.today
        today.minusDays(1) -> C.yesterday
        else -> d.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("ar")).withDecimalStyle(java.time.format.DecimalStyle.STANDARD))
    }
}

/** ONE CONVERSATION: the header, the pinned bar, the messages (newest at the bottom), the composer pinned above the keyboard. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    offline: Boolean,
    onBack: () -> Unit,
    onOpenPath: (String) -> Unit,
    onInfo: (String) -> Unit,
    vm: ConversationViewModel = hiltViewModel(),
) {
    val files = vm.files
    val playing by files.playing.collectAsStateWithLifecycle()
    val window by vm.window.collectAsStateWithLifecycle()
    val header by vm.header.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val calling by vm.calling.collectAsStateWithLifecycle()
    val mode by vm.mode.collectAsStateWithLifecycle()
    val focus by vm.focus.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val typingAll by vm.typing.collectAsStateWithLifecycle()
    val connected by vm.live.connected.collectAsStateWithLifecycle()

    // the live line brings what changes; without it the conversation asks every 5 seconds
    WhileOnScreen(if (connected) 300_000 else 5_000, connected) { vm.refresh() }
    // a row of the outbox was just sent: fetch it at once rather than wait for the next tick
    LaunchedEffect(pending.count { it.sentAt != null }) { if (!connected) vm.refresh() }

    val lines = remember(window.messages, pending) { vm.linesOf(window.messages, pending) }
    val shown = remember(lines) { lines.asReversed() }
    val entries = remember(shown, window.firstUnreadId) { Entry.of(shown, window.firstUnreadId) { dayLabel(it) } }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val clipboard = LocalClipboardManager.current

    var actionsOf by remember { mutableStateOf<Message?>(null) }
    var forwardOf by remember { mutableStateOf<Message?>(null) }
    var deleteOf by remember { mutableStateOf<Message?>(null) }
    var viewer by remember { mutableStateOf<Pair<List<Attachment>, Int>?>(null) }

    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }

    // a jump (a reply's quote, the pinned bar, a search hit): scroll to it once it is in the window
    LaunchedEffect(focus, entries) {
        val f = focus ?: return@LaunchedEffect
        val i = entries.indexOfFirst { it.key == f }
        if (i >= 0) { list.animateScrollToItem(i); vm.focused() }
    }

    // near the top: the older page; at the bottom of a window that does not reach «now»: the newer one; the newest seen: the read mark
    LaunchedEffect(list, entries) {
        snapshotFlow { list.layoutInfo.visibleItemsInfo.map { it.key } }.distinctUntilChanged().collect { keys ->
            val last = list.layoutInfo.totalItemsCount
            val maxIndex = list.layoutInfo.visibleItemsInfo.maxOfOrNull { it.index } ?: 0
            if (last > 0 && maxIndex >= last - 5) vm.older()
            if (list.firstVisibleItemIndex == 0 && window.hasNewer) vm.newer()
            // the newest SERVER message on screen (an outbox line of mine at the bottom is skipped, never a reason to stop)
            keys.firstOrNull { it is String && !(it as String).startsWith("day-") && !it.startsWith("outbox-") && it != "unread" }?.let { vm.seen(it as String) }
        }
    }

    val atBottom by remember { derivedStateOf { list.firstVisibleItemIndex <= 1 } }
    // a new message of mine, or one that arrives while the person is at the bottom: follow it
    LaunchedEffect(shown.firstOrNull()?.id) { if (atBottom || shown.firstOrNull()?.message?.mine == true) list.scrollToItem(0) }

    BackHandler(enabled = mode != ComposeMode.New) { vm.cancelMode() }

    Scaffold(
        containerColor = Zk.colors.surface,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) },
        topBar = { Header(header, typingAll[vm.id].orEmpty().filter { it.until > System.currentTimeMillis() }, calling, onBack, onInfo = { onInfo(vm.id) }, onCall = { vm.startCall { onOpenPath("/calls/$it") } }, onVideo = { vm.startCall(video = true) { onOpenPath("/calls/$it") } }) },
        bottomBar = {
            val h = header
            when {
                h == null -> Unit
                h.me.canPost && !h.closed -> Composer(vm, mode, files)
                h.me.canJoin -> Column(Modifier.fillMaxWidth().background(Zk.colors.surface1).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(T.silentReading, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { vm.join() }, modifier = Modifier.fillMaxWidth()) { Text(T.joinChat, color = Zk.colors.accent, style = MaterialTheme.typography.titleSmall) }
                }
                else -> Text(T.cannotPost, color = Zk.colors.fgMuted, modifier = Modifier.fillMaxWidth().background(Zk.colors.surface1).navigationBarsPadding().padding(16.dp))
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OfflineBar(offline)
            // the pinned bar of «شكل تيليجرام»: 44 high on surface-1, the pin in the accent, «رسالة مثبّتة #N» over «فلان: …»; a tap goes to the
            // next pin and cycles
            val pins = header?.pinnedMessages.orEmpty()
            if (pins.isNotEmpty()) {
                var at by rememberSaveable(pins.size) { mutableStateOf(0) }
                val p = pins[at.coerceIn(0, pins.lastIndex)]
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).background(Zk.colors.surface1).clickable { vm.jumpTo(p.id); at = (at + 1) % pins.size }.padding(horizontal = 12.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Filled.PushPin, contentDescription = null, tint = Zk.colors.accent, modifier = Modifier.size(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(C.pinned + if (pins.size > 1) " #${pins.size - at.coerceIn(0, pins.lastIndex)}" else "", color = Zk.colors.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Text("${p.authorName}: ${p.preview ?: C.deletedPreview}", fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Zk.colors.fg)
                    }
                }
                HorizontalDivider(color = Zk.colors.border, thickness = 1.dp)
            }
            // the messages on the chat's wallpaper (the theme's colour and the site's «boxes» pattern)
            val wallpaper = Zk.colors.chatWallpaper
            val pattern = Zk.colors.chatPattern
            Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().chatWallpaper(wallpaper, pattern)) {
                when {
                    !window.loaded && window.messages.isEmpty() && failure == null -> Loading()
                    window.messages.isEmpty() && failure != null && pending.isEmpty() -> Failure(failure!!.message, onRetry = { vm.refresh() })
                    else -> {
                        val multi = header?.kind != "DM"
                        val readersAt = window.readers.groupBy { it.messageId }
                        val act = BubbleActions(
                            onLong = { actionsOf = it },
                            onReplyTap = { vm.jumpTo(it) },
                            onReact = { m, e -> vm.react(m, e) },
                            onMedia = { media, i -> viewer = media to i },
                            onFile = { a -> if (a.kind == "AUDIO") files.play(a) else files.open(a) { msg -> scope.launch { snack.showSnackbar(msg) } } },
                            onVote = { m, ids -> vm.vote(m, ids) },
                            onTick = { m, item, done -> vm.tick(m, item, done) },
                            onRetry = { vm.retry(it) },
                            onDiscard = { vm.discard(it) },
                        )
                        LazyColumn(Modifier.fillMaxSize(), state = list, reverseLayout = true, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
                            items(entries, key = { it.key }) { e ->
                                when (e) {
                                    is Entry.Day -> DayLine(e.label)
                                    Entry.Unread -> UnreadLine()
                                    is Entry.Of -> {
                                        val line = e.line
                                        if (line.message.kind == "SYSTEM") SystemLine(line.message)
                                        else {
                                            val older = e.older
                                            fun sameRun(a: Message?, b: Message) = a != null && a.kind != "SYSTEM" && a.authorId == b.authorId && a.mine == b.mine
                                            val first = !sameRun(older, line.message)
                                            val last = !sameRun(e.newer, line.message)
                                            Bubble(line, first, last, multi, if (multi) readersAt[line.id].orEmpty().filter { it.userId != vm.me } else emptyList(), act, playing)
                                        }
                                    }
                                }
                            }
                        }
                        if (!atBottom) {
                            // the site's jump button: 44 round, the surface with a hairline, the accent's arrow, at the bottom end
                            Box(
                                Modifier.align(Alignment.BottomEnd).padding(12.dp).size(44.dp).cardShadow(CircleShape, Zk.theme.dark).clip(CircleShape)
                                    .background(Zk.colors.surface).border(1.dp, Zk.colors.border, CircleShape)
                                    .clickable { scope.launch { if (window.hasNewer) vm.refresh(); list.animateScrollToItem(0) } },
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = C.toBottom, tint = Zk.colors.accent, modifier = Modifier.size(22.dp)) }
                        }
                    }
                }
            }
        }
    }

    actionsOf?.let { m ->
        ModalBottomSheet(onDismissRequest = { actionsOf = null }, sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Zk.colors.surface1) {
            Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    for (e in QUICK_REACTIONS) {
                        Text(e, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.clip(CircleShape).clickable { vm.react(m, e); actionsOf = null }.padding(8.dp))
                    }
                }
                HorizontalDivider(color = Zk.colors.border)
                val h = header
                val canPost = h?.me?.canPost == true && h.closed.not()
                if (canPost && !m.deleted) MenuItem(C.reply, Icons.AutoMirrored.Filled.Reply) { vm.reply(m); actionsOf = null }
                if (!m.body.isNullOrBlank() && !m.deleted) MenuItem(C.copy, Icons.Filled.ContentCopy) {
                    clipboard.setText(AnnotatedString(m.body)); actionsOf = null; scope.launch { snack.showSnackbar(C.copied) }
                }
                if (!m.deleted && m.kind != "POLL" && m.kind != "CHECKLIST" && m.kind != "SYSTEM") MenuItem(C.forward, Icons.Filled.Shortcut) { forwardOf = m; vm.loadTargets(); actionsOf = null }
                if (m.mine && !m.deleted && m.kind == "TEXT" && canPost) MenuItem(C.edit, Icons.Filled.Edit) { vm.edit(m); actionsOf = null }
                if (canPost && !m.deleted) MenuItem(if (m.pinned) C.unpinMessage else C.pinMessage, Icons.Filled.PushPin) { vm.pin(m); actionsOf = null }
                if (m.poll?.canClose == true) MenuItem(C.closePoll, Icons.Filled.Close) { vm.closePoll(m); actionsOf = null }
                MenuItem(C.deleteForMe, Icons.Filled.DeleteOutline) { vm.deleteForMe(m); actionsOf = null }
                if (!m.deleted && (m.mine || h?.me?.canModerate == true)) MenuItem(C.deleteForAll, Icons.Filled.Delete, danger = true) { deleteOf = m; actionsOf = null }
            }
        }
    }

    deleteOf?.let { m ->
        AlertDialog(
            onDismissRequest = { deleteOf = null },
            text = { Text(C.deleteAsk) },
            confirmButton = { TextButton(onClick = { vm.deleteForAll(m); deleteOf = null }) { Text(C.delete, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { deleteOf = null }) { Text(C.cancel) } },
            containerColor = Zk.colors.surface1,
        )
    }

    forwardOf?.let { m ->
        val targets by vm.targets.collectAsStateWithLifecycle()
        ModalBottomSheet(onDismissRequest = { forwardOf = null }, containerColor = Zk.colors.surface1) {
            Text(C.forwardTo, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            val t = targets
            if (t == null) Loading(Modifier.fillMaxWidth().height(120.dp))
            else LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding()) {
                items(t, key = { it.id }) { target ->
                    Row(Modifier.fillMaxWidth().clickable {
                        vm.forward(m, target) { scope.launch { snack.showSnackbar(C.forwarded) } }
                        forwardOf = null
                    }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(target.title, url = target.avatarUrl, emoji = if (target.kind == "SAVED") "🔖" else target.emoji, size = 40.dp)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(if (target.kind == "SAVED") C.saved else target.title, style = MaterialTheme.typography.titleSmall, maxLines = 1)
                            target.spaceName?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted) }
                        }
                    }
                }
            }
        }
    }

    viewer?.let { (media, start) -> MediaViewer(media, start, files, onClose = { viewer = null }) }
}

/** What the conversation's list draws, newest first (it is laid out from the bottom): a message, the day between two, «رسائل جديدة». */
sealed interface Entry {
    val key: String
    data class Of(val line: Line, val older: Message?, val newer: Message? = null) : Entry { override val key get() = line.id }
    data class Day(val label: String, val after: String) : Entry { override val key get() = "day-$after" }
    data object Unread : Entry { override val key = "unread" }

    companion object {
        /** Pure (unit-tested): each line, then (above it on screen) the unread mark and the day line it opens. */
        fun of(shown: List<Line>, firstUnreadId: String?, day: (String) -> String): List<Entry> = buildList {
            for (i in shown.indices) {
                val line = shown[i]
                val older = shown.getOrNull(i + 1)
                add(Of(line, older?.message, shown.getOrNull(i - 1)?.message))
                if (line.id == firstUnreadId) add(Unread)
                val d = day(line.message.createdAt)
                if (older == null || day(older.message.createdAt) != d) add(Day(d, line.id))
            }
        }
    }
}


/**
 * The conversation's header of «شكل تيليجرام»: a floating card above the messages — ←, the 40 picture, the title 16sp semibold over the
 * subtitle 12sp (the typing line in the accent), the call.
 */
@Composable
private fun Header(h: ConversationHeader?, typing: List<Typist>, calling: Boolean, onBack: () -> Unit, onInfo: () -> Unit, onCall: () -> Unit, onVideo: () -> Unit = {}) {
    GlassHeader {
        RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack)
        Row(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable(enabled = h != null, onClick = onInfo).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (h != null) Avatar(h.title, url = h.peer?.avatarUrl, emoji = h.emoji, size = 40.dp)
            Spacer(Modifier.width(10.dp))
            Column {
                Text(h?.title.orEmpty(), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Zk.colors.fg)
                val sub = when {
                    typing.size == 1 -> (if (h?.kind == "DM") "" else typing[0].name + " ") + C.typing
                    typing.size > 1 -> typing.joinToString("، ") { it.name } + " " + C.typingMany
                    h?.kind == "DM" -> h.peerLastSeenAt?.let { "${C.lastSeen} ${shortTime(it)}" }
                    h != null && h.memberCount > 0 -> "${h.memberCount} ${C.members}"
                    else -> null
                }
                if (sub != null) Text(sub, fontSize = 12.sp, color = if (typing.isNotEmpty()) Zk.colors.accent else Zk.colors.fgMuted, maxLines = 1)
            }
        }
        val canCall = h != null && h.calls != false && h.me.canCall != false && h.kind != "TOPIC" || (h?.kind == "TOPIC" && h.me.canCall == true)
        // the site's call menu, as two buttons: آ«ظ…ظƒط§ظ„ظ…ط© ظپظٹط¯ظٹظˆآ» and آ«ظ…ظƒط§ظ„ظ…ط© طµظˆطھآ»
        if (canCall) RoundIcon(Icons.Filled.Videocam, io.zakiai.workspace.feature.calls.K.video, tint = Zk.colors.accent, enabled = !calling, onClick = onVideo)
        if (canCall) RoundIcon(Icons.Filled.Call, T.call, tint = Zk.colors.accent, enabled = !calling, onClick = onCall)
    }
}

/** The emojis a tap of ☺ offers (the composer's quick set). */
private val QUICK_EMOJIS = listOf("👍", "❤️", "😂", "😊", "🙏", "👏", "🔥", "✅", "🎉", "😮", "😢", "🤝", "💪", "👌", "🌹", "😅", "🤔", "👀", "💯", "⭐")

/**
 * The composer of «شكل تيليجرام» (composer-surface.tsx): on the surface with a hairline above it, padding 12; a pill (radius 23, surface-1, the
 * card shadow) holding ☺, the field (16sp, from 44 up to 240) and the paperclip; beside it the 46 round button of the accent — the microphone
 * while the box is empty, send when there is something, ✓ while editing. Above it the reply / edit bar (a 3px accent edge).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Composer(vm: ConversationViewModel, mode: ComposeMode, files: ChatFiles) {
    // the draft belongs to the conversation: a reply keeps what was typed; an edit puts it aside and gives it back afterwards
    var text by rememberSaveable { mutableStateOf("") }
    var draft by rememberSaveable { mutableStateOf("") }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var emojis by remember { mutableStateOf(false) }
    LaunchedEffect(mode) {
        if (mode is ComposeMode.Edit && editing != mode.of.id) {
            if (editing == null) draft = text
            text = mode.of.body.orEmpty()
            editing = mode.of.id
        } else if (mode !is ComposeMode.Edit && editing != null) {
            text = draft
            draft = ""
            editing = null
        }
    }
    val dark = Zk.theme.dark
    Column(Modifier.background(Zk.colors.surface).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))) {
        HorizontalDivider(color = Zk.colors.border, thickness = 1.dp)
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val target = when (mode) { is ComposeMode.Reply -> mode.to; is ComposeMode.Edit -> mode.of; else -> null }
            if (target != null) {
                val shape = RoundedCornerShape(12.dp)
                Row(
                    Modifier.fillMaxWidth().cardShadow(shape, dark).clip(shape).background(Zk.colors.surface1),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(3.dp).height(44.dp).background(Zk.colors.accent))
                    Spacer(Modifier.width(10.dp))
                    Icon(if (mode is ComposeMode.Edit) Icons.Filled.Edit else Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = Zk.colors.accent, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (mode is ComposeMode.Edit) C.editing else "${C.replyingTo} ${target.authorName}", color = Zk.colors.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        Text(target.body ?: target.attachments.firstOrNull()?.name.orEmpty(), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Zk.colors.fg)
                    }
                    RoundIcon(Icons.Filled.Close, C.cancel, tint = Zk.colors.fgMuted) { vm.cancelMode() }
                }
            }
            Uploads(vm, files)
            // leaving the conversation stops a recording that was started here (it is never sent anywhere else)
            DisposableEffect(vm.id) { onDispose { files.abandonRecording(vm.id) } }
            if (emojis) {
                FlowRow(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Zk.colors.surface1).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (e in QUICK_EMOJIS) Text(e, fontSize = 24.sp, modifier = Modifier.clip(CircleShape).clickable { text += e }.padding(6.dp))
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val pill = RoundedCornerShape(23.dp)
                Row(
                    Modifier.weight(1f).cardShadow(pill, dark).clip(pill).background(Zk.colors.surface1).padding(horizontal = 4.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    RoundIcon(Icons.Filled.SentimentSatisfied, C.emoji, tint = if (emojis) Zk.colors.accent else Zk.colors.fgMuted, size = 24.dp) { emojis = !emojis }
                    BasicTextField(
                        value = text,
                        onValueChange = { text = it; if (it.isNotBlank()) vm.typing() },
                        textStyle = TextStyle(fontSize = 16.sp, lineHeight = 23.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
                        cursorBrush = SolidColor(Zk.colors.accent),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        modifier = Modifier.weight(1f).heightIn(min = 44.dp, max = 240.dp).padding(horizontal = 6.dp, vertical = 11.dp),
                        decorationBox = { inner ->
                            Box {
                                if (text.isEmpty()) Text(T.writeMessage, fontSize = 16.sp, color = Zk.colors.fgMuted)
                                inner()
                            }
                        },
                    )
                    if (mode !is ComposeMode.Edit) AttachButton(vm, files)
                }
                val ups by files.ready(vm.id).collectAsStateWithLifecycle()
                val done = ups.filter { it.state == "done" }
                val busy = ups.any { it.state == "uploading" }
                val header by vm.header.collectAsStateWithLifecycle()
                if (text.isBlank() && ups.isEmpty() && mode !is ComposeMode.Edit && header?.voiceNotes != false) {
                    VoiceButton(vm, files)
                } else {
                    val edit = mode is ComposeMode.Edit
                    val ready = if (edit) text.isNotBlank() else !busy && (text.isNotBlank() || done.isNotEmpty())
                    Box(
                        Modifier.size(46.dp).cardShadow(CircleShape, dark).clip(CircleShape).background(if (ready) Zk.colors.accent else Zk.colors.surface2)
                            .clickable(enabled = ready) {
                                // an edit changes the words only: the files waiting for the next message stay where they are
                                if (edit) vm.send(text) else { vm.send(text, done.map { it.uploadedId }); files.consumed(vm.id) }
                                text = ""
                                emojis = false
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(if (edit) Icons.Filled.Check else Icons.AutoMirrored.Filled.Send, contentDescription = T.send, tint = if (ready) Zk.colors.accentFg else Zk.colors.fgMuted, modifier = Modifier.size(24.dp))
                    }
                }
            }
        }
    }
}
