package io.zakiai.workspace.feature.work

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.InboxCard
import io.zakiai.workspace.core.net.TodayTask
import io.zakiai.workspace.core.net.WorkRow
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.Zk
import java.time.LocalDate

/** A card of «اليوم»: a soft surface with its title (cards are for dashboards — this is one). */
@Composable
private fun Card(title: String, icon: ImageVector? = null, count: Int? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if (count != null && count > 0) Text("$count", color = Zk.colors.accent, style = MaterialTheme.typography.labelLarge)
        }
        Spacer(Modifier.height(6.dp))
        content()
    }
}

/** A task line of «اليوم»: the circle that closes it (when the person may), the title, the project and the site's own due words. */
@Composable
private fun TaskLine(t: TodayTask, late: Boolean, onOpen: () -> Unit, onDone: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onDone, enabled = t.editable, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Filled.RadioButtonUnchecked, contentDescription = W.markDone, tint = if (t.editable) Zk.colors.accent else Zk.colors.fgMuted)
        }
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(t.projectName.ifBlank { null }, t.dueLabel).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = if (late) Zk.colors.danger else Zk.colors.fgMuted)
        }
        if (t.priority == "URGENT" || t.priority == "HIGH") PriorityDot(t.priority)
    }
}

@Composable
fun PriorityDot(p: String) {
    val color = when (p) { "URGENT" -> Zk.colors.danger; "HIGH" -> Zk.colors.warn; "LOW" -> Zk.colors.fgMuted; else -> Zk.colors.info }
    Box(Modifier.size(10.dp).clip(CircleShape).background(color))
}

/**
 * «اليوم»: the greeting and the day, the next mission, the week in numbers, the day's tasks (late, today, later), what waits for the
 * person's answer, who mentioned them, the reminders and the day's follow-ups, the pinned tasks, the projects — all as the site's own
 * page computes them for the space the person is in. «مهمة جديدة» at the foot.
 */
@Composable
fun TodayScreen(onOpenTask: (String) -> Unit, onOpenPath: (String) -> Unit, onOpenSite: (String) -> Unit, spaceKey: String? = null, vm: TodayViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val reminders by vm.reminders.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    var adding by remember { mutableStateOf(false) }

    val data = state.data
    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() -> SiteOnly(onOpenSite)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 88.dp)) {
                val d = data.today
                item {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text("${if (d.greeting.period == "morning") W.morning else W.evening} ${d.greeting.firstName}".trim(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                        Text(d.dateLabel, style = MaterialTheme.typography.bodyMedium, color = Zk.colors.fgMuted)
                    }
                }
                data.mission?.let { m ->
                    item {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).background(Zk.colors.accent).clickable { onOpenTask(m.id) }.padding(16.dp)) {
                            Text(W.mission, color = Zk.colors.accentFg.copy(alpha = 0.8f), style = MaterialTheme.typography.labelLarge)
                            Text(m.title, color = Zk.colors.accentFg, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(m.projectName.ifBlank { null }, m.dueLabel).joinToString(" · "), color = Zk.colors.accentFg.copy(alpha = 0.85f), style = MaterialTheme.typography.bodySmall)
                            if (m.editable) TextButton(onClick = { vm.complete(m.id) }) { Text(W.markDone, color = Zk.colors.accentFg, fontWeight = FontWeight.Bold) }
                        }
                    }
                }
                data.dashboard?.mine?.let { w ->
                    item {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat(W.myWeek, w.percent?.let { "$it%" } ?: "${w.doneWeek}/${w.weekTotal}")
                            Stat(W.overdue, "${w.overdue}", danger = w.overdue > 0)
                            Stat(W.dueToday, "${w.dueToday}")
                            Stat(W.open, "${w.open}")
                            if (data.dashboard.unreadChat > 0) Stat(W.unreadChat, "${data.dashboard.unreadChat}")
                        }
                    }
                }
                val bySpace = data.bySpace
                if (bySpace != null) {
                    item {
                        Card(W.spaces) {
                            for (s in bySpace) Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("${s.emoji ?: ""} ${s.name}".trim(), modifier = Modifier.weight(1f), maxLines = 1)
                                if (s.overdue > 0) Text("${s.overdue} ${W.overdue}", color = Zk.colors.danger, style = MaterialTheme.typography.labelMedium)
                                Spacer(Modifier.width(8.dp))
                                Text("${s.open} ${W.open}", color = Zk.colors.fgMuted, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                } else {
                    item {
                        Card(W.myWork, count = d.tasks.counts.open) {
                            if (d.tasks.overdue.isEmpty() && d.tasks.today.isEmpty() && d.tasks.later.isEmpty()) Text(W.nothingToday, color = Zk.colors.fgMuted)
                            if (d.tasks.overdue.isNotEmpty()) SectionLabel(W.overdue)
                            for (t in d.tasks.overdue) TaskLine(t, late = true, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) })
                            if (d.tasks.today.isNotEmpty()) SectionLabel(W.dueToday)
                            for (t in d.tasks.today) TaskLine(t, late = false, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) })
                            if (d.tasks.later.isNotEmpty()) SectionLabel(W.later)
                            for (t in d.tasks.later) TaskLine(t, late = false, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) })
                        }
                    }
                }
                inbox(data.waiting, W.waiting, Icons.Filled.HourglassTop, onOpenPath)
                inbox(data.mentions, W.mentions, Icons.Filled.AlternateEmail, onOpenPath)
                if (reminders.isNotEmpty() || data.followUps.isNotEmpty()) {
                    item {
                        Card(W.reminders, Icons.Filled.NotificationsActive) {
                            for (r in reminders) Row(Modifier.fillMaxWidth().clickable(enabled = r.href != null) { r.href?.let(onOpenPath) }.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(r.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(W.dueLabel(r.dueAt) ?: "", style = MaterialTheme.typography.labelMedium, color = if (r.fired) Zk.colors.danger else Zk.colors.fgMuted)
                                }
                                IconButton(onClick = { vm.dismissReminder(r.id) }) { Icon(Icons.Filled.Close, contentDescription = W.cancel, tint = Zk.colors.fgMuted) }
                            }
                            if (data.followUps.isNotEmpty()) SectionLabel(W.followUps)
                            for (f in data.followUps) Text("${f.title} · ${f.dueLabel}", color = if (f.late) Zk.colors.danger else Zk.colors.fg, modifier = Modifier.padding(vertical = 4.dp))
                        }
                    }
                }
                if (data.pinned.isNotEmpty()) {
                    item {
                        Card(W.pinned, Icons.Filled.PushPin) {
                            for (p in data.pinned) Row(Modifier.fillMaxWidth().clickable { onOpenTask(p.id) }.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (p.completed) Icons.Filled.CheckCircle else Icons.Filled.PushPin, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(p.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(p.projectName, color = Zk.colors.fgMuted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                            }
                        }
                    }
                }
                if (d.projects.isNotEmpty()) {
                    item {
                        Card(W.projects) {
                            for (p in d.projects) Row(Modifier.fillMaxWidth().clickable { onOpenPath("/projects/${p.id}") }.padding(vertical = 5.dp)) {
                                Text(p.name, modifier = Modifier.weight(1f), maxLines = 1)
                                Text("${p.openTasks} ${W.open} · ${p.statusLabel}", color = Zk.colors.fgMuted, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }
            }
        }
        val targets = data?.today?.quickAdd?.targets.orEmpty()
        if (targets.isNotEmpty()) {
            FloatingActionButton(onClick = { adding = true }, containerColor = Zk.colors.accent, contentColor = Zk.colors.accentFg, modifier = Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                Icon(Icons.Filled.Add, contentDescription = W.newTask)
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }

    if (adding) {
        val qa = data?.today?.quickAdd
        var title by rememberSaveable { mutableStateOf("") }
        var due by rememberSaveable { mutableStateOf<String?>(qa?.dueToday) }
        var target by rememberSaveable { mutableStateOf(0) }
        AlertDialog(
            onDismissRequest = { adding = false },
            containerColor = Zk.colors.surface1,
            title = { Text(W.newTask) },
            text = {
                Column {
                    OutlinedTextField(title, { title = it.take(280) }, label = { Text(W.taskTitle) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip(W.dueToday, due == qa?.dueToday) { due = qa?.dueToday }
                        Chip(W.dueTomorrow, due == qa?.dueTomorrow) { due = qa?.dueTomorrow }
                        Chip(W.dueNone, due == null) { due = null }
                    }
                    val targets = qa?.targets.orEmpty()
                    if (targets.size > 1) {
                        Spacer(Modifier.height(8.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            targets.forEachIndexed { i, t -> Chip(t.projectName, target == i) { target = i } }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = title.isNotBlank(), onClick = {
                    val t = qa?.targets?.getOrNull(target) ?: return@TextButton
                    vm.quickAdd(title, t, due) { adding = false }
                }) { Text(W.add) }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text(W.cancel) } },
        )
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.inbox(card: InboxCard?, title: String, icon: ImageVector, onOpenPath: (String) -> Unit) {
    if (card == null || card.rows.isEmpty()) return
    item {
        Card(title, icon, count = card.total) {
            for (r in card.rows) Row(Modifier.fillMaxWidth().clickable(enabled = r.href != null) { r.href?.let(onOpenPath) }.padding(vertical = 5.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(r.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    r.place?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted) }
                }
                if (r.count > 1) Text("${r.count}", color = Zk.colors.accent, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, danger: Boolean = false) {
    Column(Modifier.clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(horizontal = 14.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = if (danger) Zk.colors.danger else Zk.colors.fg)
        Text(label, style = MaterialTheme.typography.labelSmall, color = Zk.colors.fgMuted)
    }
}

@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (selected) Zk.colors.accentFg else Zk.colors.fg,
        style = MaterialTheme.typography.labelLarge,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (selected) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** An older site that has not the phone's door yet: the section opens on the site's page (⚠️ marked, 🔧 the update of the site). */
@Composable
private fun SiteOnly(onOpenPath: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        WarnFix(WorkWarn.oldSite, WorkWarn.oldSiteFix)
        TextButton(onClick = { onOpenPath("/?view=today") }) { Text(WorkWarn.openSite, color = Zk.colors.accent) }
    }
}

object WorkWarn {
    const val oldSite = "⚠️ الموقع لسا ما فيه الباب اللي بيقرأ منه التطبيق هالقسم."
    const val oldSiteFix = "🔧 بيشتغل لحاله أول ما ينرفع تحديث الموقع؛ لهلأ افتحه من صفحة الموقع."
    const val openSite = "افتح صفحة الموقع"
}

/**
 * «مهامي»: the site's six tabs (each with its count), and the tasks of the chosen one — the circle closes or reopens a task the person
 * may edit; a tap opens the task.
 */
@Composable
fun MyWorkScreen(onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit, spaceKey: String? = null, vm: MyWorkViewModel = hiltViewModel()) {
    val tab by vm.tab.collectAsStateWithLifecycle()
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, tab, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((key, label) in W.TABS) {
                    val n = data?.counts?.get(key) ?: 0
                    Chip(if (n > 0 && key != "completed") "$label $n" else label, key == tab) { vm.show(key) }
                }
            }
            HorizontalDivider(color = Zk.colors.border)
            when {
                data == null && state.failure == null -> Loading()
                state.closed -> Empty(W.sectionOff)
                data == null && state.failure!!.missingDoor() -> SiteOnlyMyWork(onOpenSite)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                data.rows.isEmpty() -> Empty(W.nothingHere)
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(data.rows, key = { it.task.id }) { row -> WorkLine(row, onOpen = { onOpenTask(row.task.id) }, onToggle = { vm.toggle(row.task.id, row.task.completedAt == null) }) }
                }
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun SiteOnlyMyWork(onOpenPath: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        WarnFix(WorkWarn.oldSite, WorkWarn.oldSiteFix)
        TextButton(onClick = { onOpenPath("/my-work") }) { Text(WorkWarn.openSite, color = Zk.colors.accent) }
    }
}

@Composable
private fun WorkLine(row: WorkRow, onOpen: () -> Unit, onToggle: () -> Unit) {
    val t = row.task
    val done = t.completedAt != null
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(done, { onToggle() }, enabled = row.editable, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (t.pinned) { Icon(Icons.Filled.PushPin, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
                if (t.visibility == "PARTICIPANTS") { Icon(Icons.Filled.Lock, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
                Text(t.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, color = if (done) Zk.colors.fgMuted else Zk.colors.fg)
            }
            val due = W.dueLabel(t.dueDate)
            Text(
                listOfNotNull(t.key, t.projectName.ifBlank { null }, W.columnLabel(t.columnName), due).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = if (!done && W.isLate(t.dueDate, LocalDate.now())) Zk.colors.danger else Zk.colors.fgMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(6.dp))
        PriorityDot(t.priority)
    }
}
