package io.zakiai.workspace.feature.work

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.zakiai.workspace.ui.components.nameColor
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.components.TaskTick
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.CountPill
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.filled.ViewColumn
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.automirrored.filled.Comment
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.border
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.TaskSheet
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.shortTime
import io.zakiai.workspace.ui.theme.Zk
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * ONE TASK: the sheet the site's page shows — title, status (the board's columns), done, priority, the day, «لمين» (a higher rank marked
 * «طلب»: the server makes it a request), a pending request with its answer, the steps, the comments and «ذكّرني». A person who may only read
 * gets the same sheet without the controls; the server refuses any write it would not allow anyway.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskScreen(onBack: () -> Unit, vm: TaskViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val sheet = state.data

    Scaffold(
        containerColor = Zk.colors.surface,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            ZkBar(
                title = sheet?.task?.key.orEmpty(),
                start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) },
            ) {
                if (sheet?.remind == true) RemindButton(sheet.task.title, vm)
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when {
                sheet == null && state.failure == null -> Loading()
                sheet == null -> Failure(state.failure!!.message, onRetry = if (state.closed) null else ({ vm.refresh() }))
                else -> Sheet(sheet, busy, vm)
            }
        }
    }
}

@Composable
private fun Sheet(s: TaskSheet, busy: Boolean, vm: TaskViewModel) {
    val t = s.task
    val edit = s.canEdit && !busy
    val done = t.completedAt != null || t.columnDone
    val open = edit && !s.lockedFields
    var renaming by remember { mutableStateOf(false) }
    var describing by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var returning by remember { mutableStateOf<String?>(null) }

    LazyColumn(Modifier.fillMaxSize().navigationBarsPadding(), contentPadding = PaddingValues(top = 6.dp, bottom = 24.dp)) {
        item {
            // the head: the title 22sp bold (✎ when it may be renamed), who made it, the status and priority as pills, the big done button
            Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, top = 8.dp, bottom = 6.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(
                        t.title,
                        fontSize = 22.sp,
                        lineHeight = 29.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).padding(top = 6.dp),
                        color = if (done) Zk.colors.fgMuted else Zk.colors.fg,
                        textDecoration = if (done) TextDecoration.LineThrough else null,
                    )
                    if (open) RoundIcon(Icons.Filled.Edit, W.save, tint = Zk.colors.fgMuted, size = 18.dp) { renaming = true }
                }
                Spacer(Modifier.height(4.dp))
                Text("${W.creator}: ${t.creatorName}", fontSize = 13.sp, color = Zk.colors.fgMuted)
                Spacer(Modifier.height(10.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusPill(W.columnLabel(t.status), if (done) Zk.colors.ok else Zk.colors.info)
                    StatusPill(W.priorityLabel(t.priority), priorityColor(t.priority))
                    W.dueLabel(t.dueDate)?.let { StatusPill(it, if (!done && W.isLate(t.dueDate)) Zk.colors.danger else Zk.colors.fgMuted) }
                }
                if (!s.canEdit) {
                    Spacer(Modifier.height(10.dp))
                    Text(W.readOnly, fontSize = 13.sp, color = Zk.colors.warn, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Zk.colors.warn.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 6.dp))
                }
                if (s.canEdit) {
                    Spacer(Modifier.height(14.dp))
                    val shape = RoundedCornerShape(50)
                    Row(
                        Modifier.fillMaxWidth().height(46.dp).then(if (done) Modifier else Modifier.cardShadow(shape, Zk.theme.dark)).clip(shape)
                            .background(if (done) Zk.colors.surface2 else Zk.colors.accent).clickable(enabled = !busy) { vm.complete(!done) },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (done) Icons.Filled.Replay else Icons.Filled.CheckCircle, null, tint = if (done) Zk.colors.fg else Zk.colors.accentFg, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (done) W.reopen else W.markDone, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = if (done) Zk.colors.fg else Zk.colors.accentFg)
                    }
                }
            }
        }
        // a request to give the task to somebody of a higher rank: the addressee (or the owner) answers it; the asker waits
        for (r in s.assignRequests) item(key = "req-${r.id}") {
            val shape = RoundedCornerShape(16.dp)
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.info.copy(alpha = 0.10f))
                    .border(1.dp, Zk.colors.info.copy(alpha = 0.35f), shape).padding(14.dp),
            ) {
                Text("${W.requestFor}: ${r.fromName} ← ${r.toName}", fontSize = 14.sp, color = Zk.colors.fg)
                if (r.mode == "addressee" || r.mode == "owner") {
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmallPillButton(W.accept, Zk.colors.ok, enabled = !busy) { vm.accept(r.id) }
                        SmallPillButton(W.giveBack, Zk.colors.danger, enabled = !busy) { returning = r.id }
                    }
                } else Text(W.waitingAnswer, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp))
            }
        }
        item {
            SoftCard {
                Field(Icons.Filled.ViewColumn, W.status, first = true) {
                    Picker(W.columnLabel(t.status), enabled = open, options = s.columns.map { it.id to W.columnLabel(it.name) }) { vm.move(it) }
                }
                Field(Icons.Filled.Flag, W.priority) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PriorityDot(t.priority)
                        Spacer(Modifier.width(6.dp))
                        Picker(W.priorityLabel(t.priority), enabled = open, options = W.PRIORITIES.map { it to W.priorityLabel(it) }) { vm.priority(it) }
                    }
                }
                Field(Icons.Filled.Event, W.due) { DuePicker(t.dueDate, enabled = open) { vm.due(it) } }
                Field(Icons.Filled.Person, W.assignees) {
                    val people = s.members.filter { it.id in t.assigneeIds }.map { it.name }.ifEmpty { listOfNotNull(t.assigneeName) }
                    Row(
                        Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = open) { picking = true }.padding(vertical = 4.dp, horizontal = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        for (n in people.take(3)) { Avatar(n, size = 24.dp); Spacer(Modifier.width(4.dp)) }
                        Text(people.joinToString("، ").ifEmpty { "—" }, fontSize = 14.sp, color = if (open) Zk.colors.accent else Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        item {
            SoftCard(W.description, Icons.AutoMirrored.Filled.Notes) {
                Text(
                    t.description?.ifBlank { null } ?: W.noDescription,
                    fontSize = 15.sp,
                    lineHeight = 23.sp,
                    color = if (t.description.isNullOrBlank()) Zk.colors.fgMuted else Zk.colors.fg,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled = open) { describing = true }.padding(vertical = 4.dp),
                )
            }
        }
        s.steps?.let { steps ->
            item {
                SoftCard(W.steps, Icons.Filled.Checklist, count = null) {
                    // the progress: «done/total» over a thin bar of the accent
                    val total = steps.progress.total
                    if (total > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.surface2)) {
                                Box(Modifier.fillMaxWidth(steps.progress.done.toFloat() / total).height(6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.accent))
                            }
                            Spacer(Modifier.width(10.dp))
                            Text("${steps.progress.done}/$total", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted)
                        }
                        Spacer(Modifier.height(4.dp))
                    }
                    steps.steps.forEachIndexed { i, st ->
                        if (i > 0) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f), thickness = 1.dp, modifier = Modifier.padding(start = 40.dp))
                        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                            TaskTick(done = st.done, late = false, enabled = steps.canEdit && !busy, description = st.title) { vm.tickStep(st.id, !st.done) }
                            Text(
                                st.title,
                                fontSize = 15.sp,
                                modifier = Modifier.weight(1f),
                                color = if (st.done) Zk.colors.fgMuted else Zk.colors.fg,
                                textDecoration = if (st.done) TextDecoration.LineThrough else null,
                            )
                            if (steps.canEdit) RoundIcon(Icons.Filled.Close, W.cancel, tint = Zk.colors.fgMuted, size = 16.dp, enabled = !busy) { vm.deleteStep(st.id) }
                        }
                    }
                    if (steps.canEdit) { Spacer(Modifier.height(6.dp)); AddLine(W.addStep, enabled = !busy) { vm.addStep(it) } }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.Comment, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(W.comments, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                if (t.comments.isNotEmpty()) CountPill(t.comments.size, background = Zk.colors.surface2, foreground = Zk.colors.fgMuted)
            }
            if (t.comments.isEmpty()) Text(W.noComments, fontSize = 14.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp))
        }
        // newest first, as the site shows them: each one a chat bubble of «the others» beside its author's picture
        for (c in t.comments) item(key = "c-${c.id}") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.Bottom) {
                Avatar(c.author, size = 32.dp)
                Spacer(Modifier.width(8.dp))
                Column(
                    Modifier.weight(1f, fill = false).clip(RoundedCornerShape(topStart = 17.dp, topEnd = 17.dp, bottomEnd = 17.dp, bottomStart = 4.dp))
                        .background(Zk.colors.bubbleIn).padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text(c.author, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = nameColor(c.author))
                    Text(c.body, fontSize = 15.sp, lineHeight = 22.sp, color = Zk.colors.bubbleInFg)
                    Text(shortTime(c.createdAt), fontSize = 11.sp, color = Zk.colors.bubbleInFg.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.End))
                }
                if (c.authorId == s.viewerId) RoundIcon(Icons.Filled.Close, W.deleteComment, tint = Zk.colors.fgMuted, size = 16.dp, enabled = !busy) { vm.deleteComment(c.id) }
            }
        }
        // a partner reads without writing: the server refuses a comment it would not take, the box is offered only to who may write
        if (s.canEdit) item { Box(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) { AddLine(W.writeComment, enabled = !busy, send = true) { vm.comment(it) } } }
    }

    if (renaming) TextDialog(W.taskTitle, t.title, single = true, onDismiss = { renaming = false }) { vm.rename(it); renaming = false }
    if (describing) TextDialog(W.description, t.description.orEmpty(), single = false, onDismiss = { describing = false }) { vm.describe(it); describing = false }
    if (picking) PeoplePicker(s, onDismiss = { picking = false }) { vm.assign(it); picking = false }
    returning?.let { rid -> TextDialog(W.reason, "", single = false, onDismiss = { returning = null }) { if (it.isNotBlank()) vm.giveBack(rid, it); returning = null } }
}

/** A quiet pill of a fact (status, priority, day): its colour at 12% with the colour's own text, 12sp semibold. */
@Composable
private fun StatusPill(label: String, color: Color) {
    Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color, maxLines = 1, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 5.dp))
}

@Composable
private fun priorityColor(p: String): Color = when (p) { "URGENT" -> Zk.colors.danger; "HIGH" -> Zk.colors.warn; "LOW" -> Zk.colors.fgMuted; else -> Zk.colors.info }

/** A small tonal button: the colour at 14%, its text in the colour, 36 high. */
@Composable
private fun SmallPillButton(label: String, color: Color, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (enabled) color else Zk.colors.fgMuted,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

/** One line of the details card: its icon, the label (muted, 96 wide), the value; a hairline above every line but the first. */
@Composable
private fun Field(icon: ImageVector, label: String, first: Boolean = false, content: @Composable () -> Unit) {
    if (!first) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f), thickness = 1.dp)
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(label, color = Zk.colors.fgMuted, fontSize = 14.sp, modifier = Modifier.width(86.dp))
        Box(Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun Picker(current: String, enabled: Boolean, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled) { open = true }.padding(vertical = 4.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(current, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = if (enabled) Zk.colors.accent else Zk.colors.fg)
            if (enabled) Icon(Icons.Filled.ExpandMore, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Zk.colors.surface1) {
            for ((value, label) in options) DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(value) })
        }
    }
}

/** The day: the phone's date picker (the site stores a plain day at noon in the company's zone), or none. */
@Composable
private fun DuePicker(iso: String?, enabled: Boolean, onPick: (LocalDate?) -> Unit) {
    val context = LocalContext.current
    val current = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate() }.getOrNull()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            W.dueLabel(iso) ?: W.dueNone,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            color = when { W.isLate(iso) -> Zk.colors.danger; enabled -> Zk.colors.accent; else -> Zk.colors.fg },
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled) {
                val d = current ?: LocalDate.now()
                DatePickerDialog(context, { _, y, m, day -> onPick(LocalDate.of(y, m + 1, day)) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
            }.padding(vertical = 4.dp, horizontal = 2.dp),
        )
        if (enabled && current != null) RoundIcon(Icons.Filled.Close, W.dueNone, tint = Zk.colors.fgMuted, size = 16.dp) { onPick(null) }
    }
}

/** The add box: the composer's pill (radius 23, surface-1, a hairline) with the 40 round button of the accent beside it. */
@Composable
private fun AddLine(hint: String, enabled: Boolean, send: Boolean = false, onAdd: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val pill = RoundedCornerShape(23.dp)
        BasicTextField(
            value = text,
            onValueChange = { text = it.take(2000) },
            textStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
            cursorBrush = SolidColor(Zk.colors.accent),
            maxLines = 4,
            modifier = Modifier.weight(1f).defaultMinSize(minHeight = 44.dp).clip(pill).background(if (send) Zk.colors.surface1 else Zk.colors.surface)
                .border(1.dp, Zk.colors.border, pill).padding(horizontal = 16.dp, vertical = 11.dp),
            decorationBox = { inner ->
                Box {
                    if (text.isEmpty()) Text(hint, fontSize = 15.sp, color = Zk.colors.fgMuted)
                    inner()
                }
            },
        )
        val ready = enabled && text.isNotBlank()
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(if (ready) Zk.colors.accent else Zk.colors.surface2).clickable(enabled = ready) { onAdd(text); text = "" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (send) Icons.AutoMirrored.Filled.Send else Icons.Filled.Add, contentDescription = hint, tint = if (ready) Zk.colors.accentFg else Zk.colors.fgMuted, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun TextDialog(title: String, initial: String, single: Boolean, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Zk.colors.surface1,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, singleLine = single, maxLines = if (single) 1 else 8, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(enabled = !single || text.isNotBlank(), onClick = { onSave(text) }) { Text(W.save) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(W.cancel) } },
    )
}

/** «لمين»: the space's people; somebody of a higher rank is marked «طلب» — choosing them sends a request, the server decides. */
@Composable
private fun PeoplePicker(s: TaskSheet, onDismiss: () -> Unit, onSave: (List<String>) -> Unit) {
    var picked by remember { mutableStateOf(s.task.assigneeIds) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Zk.colors.surface1,
        title = { Text(W.assignees) },
        text = {
            Column {
                LazyColumn(Modifier.height(360.dp)) {
                    for (m in s.members) item(key = m.id) {
                        val on = m.id in picked
                        Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - m.id else picked + m.id }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (on) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, null, tint = Zk.colors.accent)
                            Spacer(Modifier.width(8.dp))
                            Avatar(m.name, size = 30.dp)
                            Spacer(Modifier.width(8.dp))
                            Text(m.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (m.request) Text(W.request, color = Zk.colors.warn, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(picked) }) { Text(W.save) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(W.cancel) } },
    )
}

/** «ذكّرني»: three quick moments (in an hour, this evening, tomorrow morning). */
@Composable
private fun RemindButton(title: String, vm: TaskViewModel) {
    var open by remember { mutableStateOf(false) }
    Column {
        IconButton(onClick = { open = true }) { Icon(Icons.Filled.NotificationsActive, contentDescription = W.remind, tint = Zk.colors.accent) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((label, at) in TaskViewModel.quickMoments(LocalDateTime.now())) {
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; vm.remind(title, at) })
            }
        }
    }
}
