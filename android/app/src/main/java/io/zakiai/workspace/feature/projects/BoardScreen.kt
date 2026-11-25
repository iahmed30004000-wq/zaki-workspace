package io.zakiai.workspace.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.absoluteOffset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.BoardAnswer
import io.zakiai.workspace.core.net.BoardCard
import io.zakiai.workspace.core.net.BoardColumn
import io.zakiai.workspace.feature.work.PriorityDot
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.feature.work.missingDoor
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.CountPill
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/** A board opened on its own (`/boards/<id>`): the bar with ← and the board's name over the project's, then the Kanban. */
@Composable
fun BoardScreen(boardId: String, onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit, vm: BoardViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(
            title = state.data?.board?.name.orEmpty(),
            start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) },
        )
        state.data?.board?.projectName?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 16.dp, top = 6.dp))
        }
        BoardContent(boardId, onOpenTask, onOpenSite, Modifier.weight(1f), vm)
    }
}

/**
 * THE KANBAN of the site's board (src/components/board-view.tsx) on the phone: the columns side by side (288 wide, radius 16, surface-2) in a
 * row that snaps column by column; each column's head is its colour dot, its name (13.5sp bold), its count and «+»; the cards are the site's
 * (radius 10, surface-1, the card shadow). A LONG PRESS lifts a card: it follows the finger across the columns (the row scrolls near its
 * edges) and lands where it is dropped — the same `POST /api/tasks/[id]/move` with the same index the site sends. A tap opens the task.
 */
@Composable
fun BoardContent(boardId: String, onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit, modifier: Modifier = Modifier, vm: BoardViewModel = hiltViewModel()) {
    LaunchedEffect(boardId) { vm.open(boardId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(45_000, boardId) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val data = state.data
    Box(modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/boards/$boardId")
            data == null && state.closed -> Empty(W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> Kanban(data, onOpenTask, vm)
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Kanban(data: BoardAnswer, onOpenTask: (String) -> Unit, vm: BoardViewModel) {
    val row = rememberLazyListState()
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    // where everything is on screen, for the drop: each column's box and each card's box (root coordinates)
    val columnBounds = remember { HashMap<String, Rect>() }
    val cardBounds = remember { HashMap<String, Rect>() }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var boardBox by remember { mutableStateOf(Rect.Zero) }
    // the card in the hand: which, where the finger is, where on the card it was taken
    var lifted by remember { mutableStateOf<BoardCard?>(null) }
    var finger by remember { mutableStateOf(Offset.Zero) }
    var grip by remember { mutableStateOf(Offset.Zero) }
    var liftedWidth by remember { mutableStateOf(0) }

    // near an edge of the board the row scrolls on its own, so a card can travel to a column off screen
    LaunchedEffect(lifted) {
        while (lifted != null) {
            val edge = with(density) { 56.dp.toPx() }
            val x = finger.x
            val step = with(density) { 14.dp.toPx() }
            val towardLeft = x < boardBox.left + edge
            val towardRight = x > boardBox.right - edge
            if (towardLeft || towardRight) {
                // in Arabic the row starts on the right: the left edge is its END
                val forward = if (rtl) towardLeft else towardRight
                row.scrollBy(if (forward) step else -step)
            }
            delay(16)
        }
    }

    val current by androidx.compose.runtime.rememberUpdatedState(data)

    fun columnAt(p: Offset): String? = columnBounds.entries.firstOrNull { p.x >= it.value.left && p.x <= it.value.right }?.key

    fun drop() {
        val card = lifted ?: return
        val target = columnAt(finger)
        lifted = null
        if (target == null) return
        // its index among the other cards of the target column: how many of them sit above the finger
        val others = BoardLogic.column(current.tasks, target).filter { it.id != card.id }
        val above = others.count { o -> cardBounds[o.id]?.let { it.center.y < finger.y } ?: false }
        val index = if (above >= others.size) null else above
        vm.move(card.id, target, index)
    }

    Box(
        Modifier.fillMaxSize()
            .onGloballyPositioned {
                origin = it.positionInRoot()
                boardBox = it.boundsInRoot()
            }
            .pointerInput(Unit) {
                // a long press on a card lifts it; the board holds the gesture, so it lives on while the row scrolls under it
                detectDragGesturesAfterLongPress(
                    onDragStart = { at ->
                        val p = at + origin
                        val hit = cardBounds.entries.firstOrNull { it.value.contains(p) }
                        val card = hit?.let { h -> current.tasks.firstOrNull { it.id == h.key } }
                        if (card != null && current.canEdit) {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            grip = p - hit.value.topLeft
                            finger = p
                            liftedWidth = hit.value.width.roundToInt()
                            lifted = card
                        }
                    },
                    onDrag = { change, delta ->
                        if (lifted != null) {
                            change.consume()
                            finger += delta
                        }
                    },
                    onDragEnd = { drop() },
                    onDragCancel = { lifted = null },
                )
            },
    ) {
        LazyRow(
            state = row,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            flingBehavior = rememberSnapFlingBehavior(row),
            userScrollEnabled = lifted == null,
        ) {
            items(data.columns, key = { it.id }) { col ->
                val cards = BoardLogic.column(data.tasks, col.id)
                val hovered = lifted != null && columnAt(finger) == col.id
                ColumnBox(
                    col = col,
                    cards = cards,
                    canEdit = data.canEdit,
                    hovered = hovered,
                    liftedId = lifted?.id,
                    columns = data.columns,
                    onBounds = { columnBounds[col.id] = it },
                    onCardBounds = { id, r -> cardBounds[id] = r },
                    onOpenTask = onOpenTask,
                    onAdd = { title -> vm.addCard(col.id, title) },
                    onMoveTo = { card, to -> vm.move(card.id, to, null) },
                    onGone = { id -> columnBounds.remove(id); cardBounds.remove(id) },
                    lifting = lifted != null,
                )
            }
            if (data.canEdit) item(key = "add-column") { AddColumn { vm.addColumn(it) } }
        }
        // the card in the hand, over everything, under the finger (the site's `DragOverlay`)
        lifted?.let { card ->
            val pos = finger - grip - origin
            Box(
                Modifier.align(androidx.compose.ui.AbsoluteAlignment.TopLeft)
                    .absoluteOffset { IntOffset(pos.x.roundToInt(), pos.y.roundToInt()) }
                    .width(with(density) { liftedWidth.toDp() }),
            ) {
                Card(card, Modifier.alpha(0.95f), raised = true)
            }
        }
    }
}

@Composable
private fun ColumnBox(
    col: BoardColumn,
    cards: List<BoardCard>,
    canEdit: Boolean,
    hovered: Boolean,
    liftedId: String?,
    columns: List<BoardColumn>,
    onBounds: (Rect) -> Unit,
    onCardBounds: (String, Rect) -> Unit,
    onOpenTask: (String) -> Unit,
    onAdd: (String) -> Unit,
    onMoveTo: (BoardCard, String) -> Unit,
    onGone: (String) -> Unit,
    lifting: Boolean,
) {
    val shape = RoundedCornerShape(16.dp)
    var adding by remember { mutableStateOf(false) }
    androidx.compose.runtime.DisposableEffect(col.id) { onDispose { onGone(col.id); cards.forEach { onGone(it.id) } } }
    Column(
        Modifier.width(288.dp).fillMaxHeight().clip(shape).background(Zk.colors.surface2)
            .then(if (hovered) Modifier.border(2.dp, Zk.colors.accent.copy(alpha = 0.5f), shape) else Modifier)
            .onGloballyPositioned { onBounds(it.boundsInRoot()) },
    ) {
        // the head: the colour dot, the name, the count, «+»
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 2.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(hexColor(col.color)))
            Spacer(Modifier.width(8.dp))
            Text(W.columnLabel(col.name), fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (cards.isNotEmpty()) CountPill(cards.size)
            if (canEdit) RoundIcon(Icons.Filled.Add, P.newTask, tint = Zk.colors.fgMuted, size = 20.dp) { adding = true }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState(), enabled = !lifting).padding(horizontal = 8.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (adding) QuickAdd(onCancel = { adding = false }) { onAdd(it); adding = false }
            if (cards.isEmpty() && !adding) {
                Text(P.dropHere, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 20.dp))
            }
            for (card in cards) {
                var menu by remember(card.id) { mutableStateOf(false) }
                Box(
                    Modifier.fillMaxWidth()
                        .onGloballyPositioned { onCardBounds(card.id, it.boundsInRoot()) }
,
                ) {
                    Card(
                        card,
                        Modifier.alpha(if (card.id == liftedId) 0.35f else 1f),
                        onClick = { onOpenTask(card.id) },
                        onMenu = if (canEdit) ({ menu = true }) else null,
                    )
                    // «انقل إلى…»: the same move without dragging (for a long trip, or a hand that prefers a list)
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Zk.colors.surface1) {
                        Text(P.moveTo, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                        for (c in columns) {
                            DropdownMenuItem(
                                text = { Text(W.columnLabel(c.name)) },
                                leadingIcon = { Box(Modifier.size(8.dp).clip(CircleShape).background(hexColor(c.color))) },
                                trailingIcon = { if (c.id == card.columnId) Icon(Icons.Filled.Check, null, tint = Zk.colors.accent) },
                                enabled = c.id != card.columnId,
                                onClick = { menu = false; onMoveTo(card, c.id) },
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}

/**
 * One card, as the site draws it: the key (monospace) and «متأخرة», the title 13.5sp semibold (struck through when finished), up to three
 * labels and the priority dot, then the people, the day, the comments and the steps.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Card(card: BoardCard, modifier: Modifier = Modifier, raised: Boolean = false, onClick: (() -> Unit)? = null, onMenu: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(10.dp)
    val late = !card.completed && W.isLate(card.dueDate)
    Column(
        modifier.fillMaxWidth().cardShadow(shape, Zk.theme.dark).then(if (raised) Modifier.border(1.dp, Zk.colors.accent.copy(alpha = 0.5f), shape) else Modifier)
            .clip(shape).background(Zk.colors.surface1)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(card.key, fontSize = 11.5.sp, fontFamily = FontFamily.Monospace, color = Zk.colors.fgMuted)
            if (late) {
                Spacer(Modifier.width(6.dp))
                Text(P.late, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.danger)
            }
            if (card.pinned) {
                Spacer(Modifier.width(4.dp))
                Icon(Icons.Filled.PushPin, null, tint = Zk.colors.accent2, modifier = Modifier.size(13.dp))
            }
            Spacer(Modifier.weight(1f))
            if (onMenu != null) {
                Box(Modifier.size(28.dp).clip(CircleShape).clickable(onClick = onMenu), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.MoreHoriz, P.moveTo, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
                }
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(
            card.title,
            fontSize = 13.5.sp,
            lineHeight = 19.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (card.completed) Zk.colors.fgMuted else Zk.colors.fg,
            textDecoration = if (card.completed) TextDecoration.LineThrough else null,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )
        if (card.labels.isNotEmpty() || card.priority == "URGENT" || card.priority == "HIGH") {
            Spacer(Modifier.height(6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (l in card.labels.take(3)) {
                    Row(
                        Modifier.clip(RoundedCornerShape(6.dp)).background(Zk.colors.surface2).border(1.dp, Zk.colors.border, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(hexColor(l.color)))
                        Spacer(Modifier.width(4.dp))
                        Text(l.name, fontSize = 11.sp, color = Zk.colors.fg, maxLines = 1)
                    }
                }
                if (card.priority == "URGENT" || card.priority == "HIGH") Box(Modifier.padding(top = 3.dp)) { PriorityDot(card.priority) }
            }
        }
        Spacer(Modifier.height(6.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(card.assigneeNames.joinToString("، ").ifBlank { P.unassigned }, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            W.dueLabel(card.dueDate)?.let { Meta(Icons.Filled.CalendarMonth, it, if (late) Zk.colors.danger else Zk.colors.fgMuted) }
            if (card.commentCount > 0) Meta(Icons.Filled.ChatBubbleOutline, "${card.commentCount}", Zk.colors.fgMuted)
            card.steps?.takeIf { it.total > 0 }?.let { Meta(Icons.Filled.Checklist, "${it.done}/${it.total}", if (it.done == it.total) Zk.colors.ok else Zk.colors.fgMuted) }
            if (card.running) Meta(Icons.Filled.Timer, "", Zk.colors.ok)
            if (card.recurring) Meta(Icons.Filled.Repeat, "", Zk.colors.fgMuted)
        }
    }
}

@Composable
private fun Meta(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, tint: androidx.compose.ui.graphics.Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(13.dp))
        if (text.isNotEmpty()) {
            Spacer(Modifier.width(3.dp))
            Text(text, fontSize = 12.sp, color = tint, maxLines = 1)
        }
    }
}

/** The quick add inside a column: the site's ring of the accent around a small field, «إضافة» and ✕. */
@Composable
private fun QuickAdd(onCancel: () -> Unit, onAdd: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(Zk.colors.surface1).border(1.dp, Zk.colors.accent.copy(alpha = 0.5f), shape).padding(8.dp)) {
        BasicTextField(
            value = text,
            onValueChange = { text = it.take(280) },
            textStyle = TextStyle(fontSize = 14.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
            cursorBrush = SolidColor(Zk.colors.accent),
            modifier = Modifier.fillMaxWidth().padding(4.dp),
            decorationBox = { inner -> Box { if (text.isEmpty()) Text(P.taskTitle, fontSize = 14.sp, color = Zk.colors.fgMuted); inner() } },
        )
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            val ready = text.isNotBlank()
            Text(
                P.add,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (ready) Zk.colors.accentFg else Zk.colors.fgMuted,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(if (ready) Zk.colors.accent else Zk.colors.surface2).clickable(enabled = ready) { onAdd(text) }.padding(horizontal = 14.dp, vertical = 6.dp),
            )
            RoundIcon(Icons.Filled.Close, P.cancel, tint = Zk.colors.fgMuted, size = 18.dp, onClick = onCancel)
        }
    }
}

/** «إضافة عمود»: the site's button the width of a column, which becomes a name field. */
@Composable
private fun AddColumn(onAdd: (String) -> Unit) {
    var naming by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.width(288.dp).clip(shape).background(Zk.colors.surface2).padding(8.dp)) {
        if (!naming) {
            Row(Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(12.dp)).clickable { naming = true }, horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Add, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(P.addColumn, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted)
            }
        } else {
            QuickAddField(text, { text = it.take(60) }, P.columnName)
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                val ready = text.isNotBlank()
                Text(
                    P.add,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (ready) Zk.colors.accentFg else Zk.colors.fgMuted,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (ready) Zk.colors.accent else Zk.colors.surface1).clickable(enabled = ready) { onAdd(text); text = ""; naming = false }.padding(horizontal = 14.dp, vertical = 6.dp),
                )
                RoundIcon(Icons.Filled.Close, P.cancel, tint = Zk.colors.fgMuted, size = 18.dp) { naming = false; text = "" }
            }
        }
    }
}

@Composable
private fun QuickAddField(value: String, onChange: (String) -> Unit, hint: String) {
    val shape = RoundedCornerShape(10.dp)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(fontSize = 14.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
        cursorBrush = SolidColor(Zk.colors.accent),
        modifier = Modifier.fillMaxWidth().clip(shape).background(Zk.colors.surface1).border(1.dp, Zk.colors.accent.copy(alpha = 0.5f), shape).padding(10.dp),
        decorationBox = { inner -> Box { if (value.isEmpty()) Text(hint, fontSize = 14.sp, color = Zk.colors.fgMuted); inner() } },
    )
}
