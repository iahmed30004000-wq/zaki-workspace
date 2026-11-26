package io.zakiai.workspace.feature.projects

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.Milestone
import io.zakiai.workspace.core.net.ProjectAnswer
import io.zakiai.workspace.core.net.TimelineAnswer
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.feature.work.missingDoor
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * ONE PROJECT, as the site's project page (src/app/(app)/projects/[id]/project-page.tsx): the bar with ← and the name, the status chip and the
 * progress line (and its bar), then ONE strip of tabs — «اللوحة» (a picker when the project has several boards), «الجدول الزمني», «المعالم»
 * (while their switch is on), «الإعدادات» (the boards, «لوحة جديدة»).
 */
@Composable
fun ProjectScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit, vm: ProjectViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    var tab by rememberSaveable { mutableStateOf("board") }
    var boardId by rememberSaveable { mutableStateOf<String?>(null) }
    val data = state.data

    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = data?.project?.name.orEmpty(), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() && !state.closed -> OlderSite(onOpenSite, "/projects/${vm.id}")
            data == null && state.closed -> Empty(W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> {
                Head(data)
                PillStrip {
                    PillTab(P.tabBoard, 0, tab == "board") { tab = "board" }
                    PillTab(P.tabTimeline, 0, tab == "timeline") { tab = "timeline" }
                    if (data.access.milestonesOn) PillTab(P.tabMilestones, 0, tab == "milestones") { tab = "milestones" }
                    PillTab(P.tabSettings, 0, tab == "settings") { tab = "settings" }
                }
                Box(Modifier.weight(1f)) {
                    when (tab) {
                        "timeline" -> TimelineTab(vm)
                        "milestones" -> MilestonesTab(vm, data.access.canEditMilestones)
                        "settings" -> SettingsTab(data, onPick = { boardId = it; tab = "board" }, onAdd = { vm.addBoard(it) }, canEdit = data.access.canEdit)
                        else -> {
                            val board = data.boards.firstOrNull { it.id == boardId } ?: data.boards.firstOrNull()
                            Column(Modifier.fillMaxSize()) {
                                // the site's `BoardPicker`: pill links, only with two boards or more
                                if (data.boards.size > 1) {
                                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        for (b in data.boards) {
                                            val on = b.id == board?.id
                                            Text(
                                                "${b.name}  ${b.tasks}",
                                                fontSize = 12.5.sp,
                                                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                                                color = if (on) Zk.colors.accent else Zk.colors.fgMuted,
                                                modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent.copy(alpha = 0.10f) else Color.Transparent)
                                                    .border(1.dp, if (on) Zk.colors.accent else Zk.colors.border, RoundedCornerShape(50))
                                                    .clickable { boardId = b.id }.padding(horizontal = 12.dp, vertical = 7.dp),
                                            )
                                        }
                                    }
                                }
                                if (board == null) QuietEmpty(P.noBoards, "") else BoardContent(board.id, onOpenTask, onOpenSite, Modifier.weight(1f))
                            }
                        }
                    }
                    SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
                }
            }
        }
    }
}

/** The project's head: its status chip, «الموعد», the progress line and a thin bar of the accent. */
@Composable
private fun Head(data: ProjectAnswer) {
    val p = data.project
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StateChip(P.status(p.status), projectTone(p.status))
            Spacer(Modifier.width(8.dp))
            Text(
                listOfNotNull(P.dmy(p.targetDate)?.let { P.dueLine(it) }, P.progressLine(data.progress.open, data.progress.done, data.progress.pct)).joinToString(" · "),
                fontSize = 13.sp,
                color = Zk.colors.fgMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(50)).background(Zk.colors.surface2)) {
            Box(Modifier.fillMaxWidth(data.progress.pct / 100f).height(5.dp).clip(RoundedCornerShape(50)).background(if (data.progress.pct >= 100) Zk.colors.ok else Zk.colors.accent))
        }
        p.description?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, fontSize = 13.5.sp, lineHeight = 20.sp, color = Zk.colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** «الإعدادات»: the boards of the project (each opens on the board tab) and «لوحة جديدة». */
@Composable
private fun SettingsTab(data: ProjectAnswer, onPick: (String) -> Unit, onAdd: (String) -> Unit, canEdit: Boolean) {
    var adding by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 6.dp)) {
        item {
            SoftCard(P.boards, Icons.Filled.ViewKanban, count = data.boards.size) {
                if (data.boards.isEmpty()) Text(P.noBoards, fontSize = 14.sp, color = Zk.colors.fgMuted)
                data.boards.forEachIndexed { i, b ->
                    if (i > 0) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
                    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp).clickable { onPick(b.id) }, verticalAlignment = Alignment.CenterVertically) {
                        Text(b.name, fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                        Text(P.tasksLine(b.tasks), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    }
                }
                if (canEdit) {
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accent.copy(alpha = 0.12f)).clickable { adding = true }.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Add, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(P.newBoard, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent)
                    }
                }
            }
        }
    }
    if (adding) NameDialog(P.newBoard, P.boardName, P.createBoard, onDismiss = { adding = false }) { adding = false; onAdd(it) }
}

/** «المعالم»: each with its status pill (متأخر in the danger, مكتمل in the ok), its date and open tasks; a tap of the circle toggles it. */
@Composable
private fun MilestonesTab(vm: ProjectViewModel, canEdit: Boolean) {
    LaunchedEffect(Unit) { vm.loadMilestones() }
    val list by vm.milestones.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(false) }
    val items = list
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 6.dp, horizontal = 0.dp)) {
        item {
            SoftCard(P.tabMilestones, Icons.Filled.Flag, count = items?.size) {
                when {
                    items == null -> Text("…", color = Zk.colors.fgMuted)
                    items.isEmpty() -> Text(P.milestonesEmpty, fontSize = 14.sp, color = Zk.colors.fgMuted)
                }
                items.orEmpty().forEachIndexed { i, m ->
                    if (i > 0) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
                    MilestoneRow(m, canEdit) { vm.toggleMilestone(m) }
                }
                if (canEdit) {
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accent.copy(alpha = 0.12f)).clickable { adding = true }.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Add, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(P.newMilestone, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent)
                    }
                }
            }
        }
    }
    if (adding) NameDialog(P.newMilestone, P.milestonePlaceholder, P.addMilestone, onDismiss = { adding = false }) { adding = false; vm.addMilestone(it, null) }
}

@Composable
private fun MilestoneRow(m: Milestone, canEdit: Boolean, onToggle: () -> Unit) {
    val done = m.status == "COMPLETED"
    val (label, tone) = when {
        done -> P.msDone to Zk.colors.ok
        m.overdue || m.status == "OVERDUE" -> P.msOverdue to Zk.colors.danger
        else -> P.msOpen to Zk.colors.fgMuted
    }
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 52.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(CircleShape).clickable(enabled = canEdit, onClick = onToggle), contentAlignment = Alignment.Center) {
            Icon(if (done) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, if (done) P.markOpen else P.markDone, tint = if (done) Zk.colors.ok else Zk.colors.fgMuted, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(m.name, fontSize = 15.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOf(P.dmy(m.targetDate) ?: P.msNoDate, P.msOpenTasks(m.openTasks)).joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted)
        }
        StateChip(label, tone)
    }
}

/**
 * «الجدول الزمني» (src/components/timeline-gantt.tsx): the scale (يومي 44 · أسبوعي 14 · شهري 5 px a day), the months on top, one 36-high row per
 * task with its bar (finished ok, late danger, urgent/high warn, the rest info), the line of today in the accent, the milestones as diamonds;
 * drawn left to right as the site draws it; the tasks without dates listed under it, then the legend.
 */
@Composable
private fun TimelineTab(vm: ProjectViewModel) {
    LaunchedEffect(Unit) { vm.loadTimeline() }
    val state by vm.timeline.collectAsStateWithLifecycle()
    val data = state.data
    var scale by rememberSaveable { mutableStateOf("week") }
    when {
        data == null && state.failure == null -> Loading()
        data == null -> Failure(state.failure!!.message, onRetry = { vm.loadTimeline() })
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((k, label) in listOf("day" to P.scaleDay, "week" to P.scaleWeek, "month" to P.scaleMonth)) {
                        val on = k == scale
                        Text(
                            label,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (on) Zk.colors.accentFg else Zk.colors.fgMuted,
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable { scale = k }.padding(horizontal = 14.dp, vertical = 7.dp),
                        )
                    }
                }
            }
            item { Gantt(data, when (scale) { "day" -> 44f; "month" -> 5f; else -> 14f }) }
            if (data.undated.isNotEmpty()) {
                item { Text(P.undated, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 4.dp)) }
                items(data.undated, key = { it.id }) { u -> Text("• ${u.title}", fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 20.dp, vertical = 3.dp)) }
            }
            item { Legend() }
        }
    }
}

private fun dayOf(iso: String?, zone: ZoneId = ZoneId.systemDefault()): LocalDate? = runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull()

@Composable
private fun Gantt(data: TimelineAnswer, pxPerDay: Float) {
    val today = LocalDate.now()
    val dated = data.tasks.mapNotNull { t ->
        val s = dayOf(t.start) ?: dayOf(t.end) ?: return@mapNotNull null
        val e = dayOf(t.end) ?: s
        Triple(t, minOf(s, e), maxOf(s, e))
    }
    val marks = data.milestones.mapNotNull { m -> dayOf(m.date)?.let { m to it } }
    if (dated.isEmpty() && marks.isEmpty()) {
        QuietEmpty(P.timelineEmpty, "")
        return
    }
    val all = dated.flatMap { listOf(it.second, it.third) } + marks.map { it.second } + listOfNotNull(dayOf(data.project.startDate), dayOf(data.project.targetDate), today)
    val from = all.min().minusDays(3).withDayOfMonth(1)
    val to = all.max().plusDays(7)
    val days = ChronoUnit.DAYS.between(from, to).toInt() + 1
    val density = LocalDensity.current
    val dayW = with(density) { pxPerDay.dp.toPx() }
    val rowH = with(density) { 36.dp.toPx() }
    val axisH = with(density) { 32.dp.toPx() }
    val widthDp = (pxPerDay * days).dp
    val heightDp = (32 + 36 * (dated.size + if (marks.isNotEmpty()) 1 else 0) + 8).dp
    val c = Zk.colors
    val shape = RoundedCornerShape(12.dp)
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(shape).background(c.surface1).border(1.dp, c.border, shape)) {
        // the chart reads left to right, as on the site (`dir="ltr"`), with the task titles on the bars
        androidx.compose.runtime.CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Box(Modifier.horizontalScroll(rememberScrollState(initial = ((ChronoUnit.DAYS.between(from, today) - 3) * dayW).toInt().coerceAtLeast(0)))) {
                Box(Modifier.width(widthDp).height(heightDp)) {
                    Canvas(Modifier.width(widthDp).height(heightDp)) {
                        // the project's window, then the month lines
                        val ps = dayOf(data.project.startDate)
                        val pe = dayOf(data.project.targetDate)
                        if (ps != null && pe != null) {
                            val x0 = ChronoUnit.DAYS.between(from, ps) * dayW
                            drawRect(c.info.copy(alpha = 0.05f), Offset(x0, axisH), Size((ChronoUnit.DAYS.between(ps, pe) + 1) * dayW, size.height - axisH))
                        }
                        var m = from
                        while (!m.isAfter(to)) {
                            val x = ChronoUnit.DAYS.between(from, m) * dayW
                            drawLine(c.border, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
                            m = m.plusMonths(1)
                        }
                        drawLine(c.border, Offset(0f, axisH), Offset(size.width, axisH), strokeWidth = 1f)
                        dated.forEachIndexed { i, (t, s, e) ->
                            val x = ChronoUnit.DAYS.between(from, s) * dayW
                            val w = ((ChronoUnit.DAYS.between(s, e) + 1) * dayW).coerceAtLeast(6f)
                            val y = axisH + i * rowH + (rowH - rowH * 0.66f) / 2
                            val late = !t.done && e.isBefore(today)
                            val color = when {
                                t.done -> c.ok.copy(alpha = 0.9f)
                                late -> c.danger.copy(alpha = 0.8f)
                                t.priority == "URGENT" || t.priority == "HIGH" -> c.warn.copy(alpha = 0.9f)
                                else -> c.info.copy(alpha = 0.85f)
                            }
                            drawRoundRect(color, Offset(x, y), Size(w, rowH * 0.66f), CornerRadius(12f, 12f))
                        }
                        if (marks.isNotEmpty()) {
                            val y = axisH + dated.size * rowH + rowH / 2
                            for ((_, d) in marks) {
                                val x = ChronoUnit.DAYS.between(from, d) * dayW + dayW / 2
                                rotate(45f, Offset(x, y)) { drawRect(c.cat2, Offset(x - 7f, y - 7f), Size(14f, 14f)) }
                            }
                        }
                        val tx = ChronoUnit.DAYS.between(from, today) * dayW + dayW / 2
                        drawLine(c.accent.copy(alpha = 0.6f), Offset(tx, 0f), Offset(tx, size.height), strokeWidth = 3f)
                    }
                    // the month names on the axis and the titles on the bars
                    var m = from
                    while (!m.isAfter(to)) {
                        val x = (ChronoUnit.DAYS.between(from, m) * pxPerDay).dp
                        Text("${P.MONTHS[m.monthValue - 1]} ${m.year}", fontSize = 11.sp, color = c.fgMuted, maxLines = 1, modifier = Modifier.padding(start = x + 4.dp, top = 8.dp))
                        m = m.plusMonths(1)
                    }
                    dated.forEachIndexed { i, (t, s, _) ->
                        val x = (ChronoUnit.DAYS.between(from, s) * pxPerDay).dp
                        Text(
                            t.title,
                            fontSize = 11.5.sp,
                            color = c.fg,
                            maxLines = 1,
                            modifier = Modifier.padding(start = x + 6.dp, top = (32 + 36 * i + 9).dp).width(260.dp),
                            style = androidx.compose.ui.text.TextStyle(shadow = androidx.compose.ui.graphics.Shadow(c.surface1, Offset(0f, 0f), 6f)),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Legend() {
    val c = Zk.colors
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        for ((label, color) in listOf(P.legendActive to c.info, P.legendPriority to c.warn, P.legendDone to c.ok, P.legendLate to c.danger, P.legendMilestone to c.cat2)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(color))
                Spacer(Modifier.width(5.dp))
                Text(label, fontSize = 12.sp, color = c.fgMuted)
            }
        }
    }
}
