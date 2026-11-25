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
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = T.back) } },
                title = { Text(sheet?.task?.key.orEmpty(), maxLines = 1) },
                actions = {
                    if (sheet?.remind == true) RemindButton(sheet.task.title, vm)
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Zk.colors.surface1),
            )
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
    var renaming by remember { mutableStateOf(false) }
    var describing by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var returning by remember { mutableStateOf<String?>(null) }

    LazyColumn(Modifier.fillMaxSize().navigationBarsPadding()) {
        item {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(t.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), color = if (done) Zk.colors.fgMuted else Zk.colors.fg)
                    if (edit && !s.lockedFields) IconButton(onClick = { renaming = true }) { Icon(Icons.Filled.Edit, contentDescription = W.save, tint = Zk.colors.fgMuted) }
                }
                Text("${W.creator}: ${t.creatorName}", style = MaterialTheme.typography.labelMedium, color = Zk.colors.fgMuted)
                if (!s.canEdit) Text(W.readOnly, style = MaterialTheme.typography.labelMedium, color = Zk.colors.warn, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.height(10.dp))
                if (s.canEdit) {
                    Button(
                        onClick = { vm.complete(!done) },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = if (done) Zk.colors.surface2 else Zk.colors.accent, contentColor = if (done) Zk.colors.fg else Zk.colors.accentFg),
                    ) { Text(if (done) W.reopen else W.markDone) }
                }
            }
        }
        // a request to give the task to somebody of a higher rank: the addressee (or the owner) answers it; the asker waits
        for (r in s.assignRequests) item(key = "req-${r.id}") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.info.copy(alpha = 0.12f)).padding(12.dp)) {
                Text("${W.requestFor}: ${r.fromName} ← ${r.toName}", style = MaterialTheme.typography.bodyMedium)
                if (r.mode == "addressee" || r.mode == "owner") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(enabled = !busy, onClick = { vm.accept(r.id) }) { Text(W.accept, color = Zk.colors.ok) }
                    TextButton(enabled = !busy, onClick = { returning = r.id }) { Text(W.giveBack, color = Zk.colors.danger) }
                } else Text(W.waitingAnswer, style = MaterialTheme.typography.labelMedium, color = Zk.colors.fgMuted)
            }
        }
        item {
            HorizontalDivider(color = Zk.colors.border)
            Field(W.status) {
                Picker(W.columnLabel(t.status), enabled = edit && !s.lockedFields, options = s.columns.map { it.id to W.columnLabel(it.name) }) { vm.move(it) }
            }
            Field(W.priority) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PriorityDot(t.priority)
                    Spacer(Modifier.width(6.dp))
                    Picker(W.priorityLabel(t.priority), enabled = edit && !s.lockedFields, options = W.PRIORITIES.map { it to W.priorityLabel(it) }) { vm.priority(it) }
                }
            }
            Field(W.due) { DuePicker(t.dueDate, enabled = edit && !s.lockedFields) { vm.due(it) } }
            Field(W.assignees) {
                val names = s.members.filter { it.id in t.assigneeIds }.map { it.name }.ifEmpty { listOfNotNull(t.assigneeName) }
                Text(
                    names.joinToString("، ").ifEmpty { "—" },
                    color = if (edit && !s.lockedFields) Zk.colors.accent else Zk.colors.fg,
                    modifier = Modifier.clickable(enabled = edit && !s.lockedFields) { picking = true }.padding(vertical = 4.dp),
                )
            }
            HorizontalDivider(color = Zk.colors.border)
            SectionLabel(W.description)
            Text(
                t.description?.ifBlank { null } ?: W.noDescription,
                color = if (t.description.isNullOrBlank()) Zk.colors.fgMuted else Zk.colors.fg,
                modifier = Modifier.fillMaxWidth().clickable(enabled = edit && !s.lockedFields) { describing = true }.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }
        s.steps?.let { steps ->
            item {
                HorizontalDivider(color = Zk.colors.border)
                SectionLabel("${W.steps} (${steps.progress.done}/${steps.progress.total})")
            }
            for (st in steps.steps) item(key = "step-${st.id}") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(st.done, { vm.tickStep(st.id, it) }, enabled = steps.canEdit && !busy)
                    Text(st.title, modifier = Modifier.weight(1f), color = if (st.done) Zk.colors.fgMuted else Zk.colors.fg)
                    if (steps.canEdit) IconButton(onClick = { vm.deleteStep(st.id) }, enabled = !busy) { Icon(Icons.Filled.Close, contentDescription = W.cancel, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp)) }
                }
            }
            if (steps.canEdit) item { AddLine(W.addStep, enabled = !busy) { vm.addStep(it) } }
        }
        item {
            HorizontalDivider(color = Zk.colors.border)
            SectionLabel(W.comments)
            if (t.comments.isEmpty()) Text(W.noComments, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        // newest first, as the site shows them
        for (c in t.comments) item(key = "c-${c.id}") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.Top) {
                Avatar(c.author, size = 32.dp)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(10.dp)) {
                    Row {
                        Text(c.author, style = MaterialTheme.typography.labelLarge, color = Zk.colors.accent, modifier = Modifier.weight(1f))
                        Text(shortTime(c.createdAt), style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted)
                    }
                    Text(c.body, style = MaterialTheme.typography.bodyMedium)
                }
                if (c.authorId == s.viewerId) IconButton(onClick = { vm.deleteComment(c.id) }, enabled = !busy) { Icon(Icons.Filled.Close, contentDescription = W.deleteComment, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp)) }
            }
        }
        // a partner reads without writing: the server refuses a comment it would not take, the box is offered only to who may write
        if (s.canEdit) item { AddLine(W.writeComment, enabled = !busy, send = true) { vm.comment(it) } }
        item { Spacer(Modifier.height(24.dp)) }
    }

    if (renaming) TextDialog(W.taskTitle, t.title, single = true, onDismiss = { renaming = false }) { vm.rename(it); renaming = false }
    if (describing) TextDialog(W.description, t.description.orEmpty(), single = false, onDismiss = { describing = false }) { vm.describe(it); describing = false }
    if (picking) PeoplePicker(s, onDismiss = { picking = false }) { vm.assign(it); picking = false }
    returning?.let { rid -> TextDialog(W.reason, "", single = false, onDismiss = { returning = null }) { if (it.isNotBlank()) vm.giveBack(rid, it); returning = null } }
}

@Composable
private fun Field(label: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Zk.colors.fgMuted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(90.dp))
        content()
    }
}

@Composable
private fun Picker(current: String, enabled: Boolean, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(current, color = if (enabled) Zk.colors.accent else Zk.colors.fg, modifier = Modifier.clickable(enabled = enabled) { open = true }.padding(vertical = 4.dp))
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
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
            color = when { W.isLate(iso) -> Zk.colors.danger; enabled -> Zk.colors.accent; else -> Zk.colors.fg },
            modifier = Modifier.clickable(enabled = enabled) {
                val d = current ?: LocalDate.now()
                DatePickerDialog(context, { _, y, m, day -> onPick(LocalDate.of(y, m + 1, day)) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
            }.padding(vertical = 4.dp),
        )
        if (enabled && current != null) IconButton(onClick = { onPick(null) }) { Icon(Icons.Filled.Close, contentDescription = W.dueNone, tint = Zk.colors.fgMuted, modifier = Modifier.size(16.dp)) }
    }
}

@Composable
private fun AddLine(hint: String, enabled: Boolean, send: Boolean = false, onAdd: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(text, { text = it.take(2000) }, placeholder = { Text(hint) }, modifier = Modifier.weight(1f), maxLines = 4)
        IconButton(enabled = enabled && text.isNotBlank(), onClick = { onAdd(text); text = "" }) {
            Icon(if (send) Icons.AutoMirrored.Filled.Send else Icons.Filled.CheckBox, contentDescription = hint, tint = Zk.colors.accent)
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
