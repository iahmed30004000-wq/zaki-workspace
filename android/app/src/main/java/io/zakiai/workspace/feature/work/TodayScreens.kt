package io.zakiai.workspace.feature.work

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Workspaces
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
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.InboxCard
import io.zakiai.workspace.core.net.TodayTask
import io.zakiai.workspace.core.net.WorkRow
import io.zakiai.workspace.ui.components.CountPill
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.TaskTick
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.SectionLabel
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.Zk
import java.time.LocalDate

/** A card of «اليوم» (cards are for dashboards — this is one): the shared [SoftCard]. */
@Composable
private fun Card(title: String, icon: ImageVector? = null, count: Int? = null, content: @Composable () -> Unit) {
    SoftCard(title, icon, count) { content() }
}

/** A line inside a card: a hairline above every line but the first (lists, not boxes, inside the card). */
@Composable
private fun CardLine(first: Boolean, onClick: (() -> Unit)?, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    if (!first) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f), thickness = 1.dp)
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = onClick != null) { onClick?.invoke() }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** A task line of «اليوم»: the round tick that closes it (when the person may), the title, the project and the site's own due words. */
@Composable
private fun TaskLine(t: TodayTask, late: Boolean, first: Boolean, onOpen: () -> Unit, onDone: () -> Unit) {
    CardLine(first, onOpen) {
        TaskTick(done = false, late = late, enabled = t.editable, description = W.markDone, onClick = onDone)
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, fontSize = 15.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(t.projectName.ifBlank { null }, t.dueLabel).joinToString(" · "), fontSize = 12.sp, color = if (late) Zk.colors.danger else Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 4.dp, bottom = 112.dp)) {
                val d = data.today
                item {
                    Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 8.dp)) {
                        Text("${if (d.greeting.period == "morning") W.morning else W.evening} ${d.greeting.firstName}".trim(), fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                        Text(d.dateLabel, fontSize = 14.sp, color = Zk.colors.fgMuted)
                    }
                }
                data.mission?.let { m ->
                    item {
                        // the mission card: the accent, its two buttons inside it (the Today strip's rule)
                        val shape = RoundedCornerShape(20.dp)
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.accent)
                                .clickable { onOpenTask(m.id) }.padding(18.dp),
                        ) {
                            Text(W.mission, color = Zk.colors.accentFg.copy(alpha = 0.8f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(4.dp))
                            Text(m.title, color = Zk.colors.accentFg, fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(m.projectName.ifBlank { null }, m.dueLabel).joinToString(" · "), color = Zk.colors.accentFg.copy(alpha = 0.85f), fontSize = 13.sp)
                            if (m.editable) {
                                Spacer(Modifier.height(12.dp))
                                Row(
                                    Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accentFg.copy(alpha = 0.16f)).clickable { vm.complete(m.id) }.padding(horizontal = 14.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Filled.CheckCircle, null, tint = Zk.colors.accentFg, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(W.markDone, color = Zk.colors.accentFg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
                data.dashboard?.mine?.let { w ->
                    item {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
                        Card(W.spaces, Icons.Filled.Workspaces) {
                            bySpace.forEachIndexed { i, s ->
                                CardLine(i == 0, null) {
                                    Text("${s.emoji ?: ""} ${s.name}".trim(), fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (s.overdue > 0) Text("${s.overdue} ${W.overdue}", color = Zk.colors.danger, fontSize = 12.sp)
                                    Spacer(Modifier.width(8.dp))
                                    Text("${s.open} ${W.open}", color = Zk.colors.fgMuted, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                } else {
                    item {
                        Card(W.myWork, Icons.Filled.TaskAlt, count = d.tasks.counts.open) {
                            if (d.tasks.overdue.isEmpty() && d.tasks.today.isEmpty() && d.tasks.later.isEmpty()) Text(W.nothingToday, color = Zk.colors.fgMuted, fontSize = 14.sp)
                            if (d.tasks.overdue.isNotEmpty()) SectionLabel(W.overdue)
                            d.tasks.overdue.forEachIndexed { i, t -> TaskLine(t, late = true, first = i == 0, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) }) }
                            if (d.tasks.today.isNotEmpty()) SectionLabel(W.dueToday)
                            d.tasks.today.forEachIndexed { i, t -> TaskLine(t, late = false, first = i == 0, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) }) }
                            if (d.tasks.later.isNotEmpty()) SectionLabel(W.later)
                            d.tasks.later.forEachIndexed { i, t -> TaskLine(t, late = false, first = i == 0, onOpen = { onOpenTask(t.id) }, onDone = { vm.complete(t.id) }) }
                        }
                    }
                }
                inbox(data.waiting, W.waiting, Icons.Filled.HourglassTop, onOpenPath)
                inbox(data.mentions, W.mentions, Icons.Filled.AlternateEmail, onOpenPath)
                if (reminders.isNotEmpty() || data.followUps.isNotEmpty()) {
                    item {
                        Card(W.reminders, Icons.Filled.NotificationsActive) {
                            reminders.forEachIndexed { i, r ->
                                CardLine(i == 0, r.href?.let { h -> { onOpenPath(h) } }) {
                                    Column(Modifier.weight(1f)) {
                                        Text(r.title, fontSize = 15.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        Text(W.dueLabel(r.dueAt) ?: "", fontSize = 12.sp, color = if (r.fired) Zk.colors.danger else Zk.colors.fgMuted)
                                    }
                                    RoundIcon(Icons.Filled.Close, W.cancel, tint = Zk.colors.fgMuted, size = 18.dp) { vm.dismissReminder(r.id) }
                                }
                            }
                            if (data.followUps.isNotEmpty()) SectionLabel(W.followUps)
                            data.followUps.forEachIndexed { i, f ->
                                CardLine(i == 0, null) {
                                    Text(f.title, fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(f.dueLabel, fontSize = 12.sp, color = if (f.late) Zk.colors.danger else Zk.colors.fgMuted)
                                }
                            }
                        }
                    }
                }
                if (data.pinned.isNotEmpty()) {
                    item {
                        Card(W.pinned, Icons.Filled.PushPin) {
                            data.pinned.forEachIndexed { i, p ->
                                CardLine(i == 0, { onOpenTask(p.id) }) {
                                    Icon(if (p.completed) Icons.Filled.CheckCircle else Icons.Filled.PushPin, null, tint = if (p.completed) Zk.colors.ok else Zk.colors.fgMuted, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(10.dp))
                                    Text(p.title, fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.width(8.dp))
                                    Text(p.projectName, color = Zk.colors.fgMuted, fontSize = 12.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                }
                if (d.projects.isNotEmpty()) {
                    item {
                        Card(W.projects, Icons.Filled.Folder) {
                            d.projects.forEachIndexed { i, p ->
                                CardLine(i == 0, { onOpenPath("/projects/${p.id}") }) {
                                    Text(p.name, fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${p.openTasks} ${W.open} · ${p.statusLabel}", color = Zk.colors.fgMuted, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
        val targets = data?.today?.quickAdd?.targets.orEmpty()
        if (targets.isNotEmpty()) {
            RoundFab(Icons.Filled.Add, W.newTask, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { adding = true }
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
            card.rows.forEachIndexed { i, r ->
                CardLine(i == 0, r.href?.let { h -> { onOpenPath(h) } }) {
                    Column(Modifier.weight(1f)) {
                        Text(r.title, fontSize = 15.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        r.place?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    if (r.count > 1) CountPill(r.count)
                }
            }
        }
    }
}

/** A number of the week: a small card (radius 14, the card shadow), the value 22sp bold over its 12sp label. */
@Composable
private fun Stat(label: String, value: String, danger: Boolean = false) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.defaultMinSize(minWidth = 92.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, color = if (danger) Zk.colors.danger else Zk.colors.fg)
        Text(label, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1)
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
            // the site's six tabs, in the chat's folder strip (one pill, the chosen tab the accent at 15%, its count beside it)
            PillStrip {
                for ((key, label) in W.TABS) {
                    val n = data?.counts?.get(key) ?: 0
                    PillTab(label, if (key != "completed") n else 0, key == tab) { vm.show(key) }
                }
            }
            when {
                data == null && state.failure == null -> Loading()
                state.closed -> Empty(W.sectionOff)
                data == null && state.failure!!.missingDoor() -> SiteOnlyMyWork(onOpenSite)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                data.rows.isEmpty() -> Empty(W.nothingHere)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 112.dp)) {
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
    val late = !done && W.isLate(t.dueDate, LocalDate.now())
    // a list row (D1: lists, not cards, for working screens): 64 high, the round tick, the title 15sp over its details, a hairline under it
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp).clickable(onClick = onOpen).padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TaskTick(done = done, late = late, enabled = row.editable, description = W.markDone, onClick = onToggle)
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (t.pinned) { Icon(Icons.Filled.PushPin, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
                    if (t.visibility == "PARTICIPANTS") { Icon(Icons.Filled.Lock, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
                    Text(
                        t.title,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        color = if (done) Zk.colors.fgMuted else Zk.colors.fg,
                        textDecoration = if (done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null,
                    )
                }
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    t.key?.let {
                        Text(it, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Zk.colors.surface2).padding(horizontal = 5.dp, vertical = 1.dp))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        listOfNotNull(t.projectName.ifBlank { null }, W.columnLabel(t.columnName), W.dueLabel(t.dueDate)).joinToString(" · "),
                        fontSize = 12.sp,
                        color = if (late) Zk.colors.danger else Zk.colors.fgMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            PriorityDot(t.priority)
        }
        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f), thickness = 1.dp, modifier = Modifier.padding(start = 52.dp))
    }
}
