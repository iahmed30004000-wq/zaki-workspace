package io.zakiai.workspace.feature.office

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
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.StaffPerson
import io.zakiai.workspace.core.net.TicketItem
import io.zakiai.workspace.core.net.TicketPatch
import io.zakiai.workspace.core.net.TimeGroup
import io.zakiai.workspace.feature.desk.SiteLine
import io.zakiai.workspace.feature.projects.P
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.projects.StateChip
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Ago
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk
import java.time.LocalDate
import java.time.ZoneId

@Composable
private fun Notices(notice: String?, consume: () -> Unit, snack: SnackbarHostState) {
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); consume() } }
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fgMuted,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** One row of a list (the five principles: lists with thin dividers, not cards, on working screens). */
@Composable
private fun ListRow(onClick: (() -> Unit)?, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().let { if (onClick != null) it.clickable(onClick = onClick) else it }) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) { content() }
        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
    }
}

// ── «التقويم» ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «التقويم» (src/app/(app)/calendar/page.tsx + calendar-grid.tsx): the month of the space the person is in, Sunday first, each day with its open
 * tasks counted; a tap on a day lists them below; «مهامي فقط»; the previous and next month. A task opens its sheet; while the person may
 * change things here (`editable`) «غيّر اليوم» moves it (the grid's drop: `PATCH /api/tasks/[id]` with the day).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    spaceKey: String?,
    onOpenTask: (String) -> Unit,
    onOpenSite: (String) -> Unit = {},
    /** an external partner has no calendar feed on the site either */
    guest: Boolean = false,
    vm: CalendarViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var month by rememberSaveable { mutableStateOf<String?>(null) }
    var mine by rememberSaveable { mutableStateOf(false) }
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    // saveable: a turn of the phone keeps the dialog open
    var moving by rememberSaveable { mutableStateOf<String?>(null) }
    WhileOnScreen(60_000, spaceKey, month, mine) { vm.refresh(month, mine) }
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(month, mine) })
            data.space == null -> QuietEmpty(O.calendar, O.noSpace)
            else -> {
                val shown = data.month
                val byDay = data.tasks.groupBy { O.dayOf(it.dueDate, data.timeZone) }
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 96.dp)) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        // RTL: the start side is «السابق», as the site's › and ‹
                        RoundIcon(Icons.Filled.ChevronRight, O.prev) { month = O.shiftMonth(shown, -1); picked = null }
                        Text(O.monthTitle(shown), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                        RoundIcon(Icons.Filled.ChevronLeft, O.next) { month = O.shiftMonth(shown, 1); picked = null }
                        Spacer(Modifier.width(6.dp))
                        Chip(O.mineOnly, mine) { mine = !mine }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                        for (d in O.WEEKDAYS_SHORT) Text(d, fontSize = 11.sp, color = Zk.colors.fgMuted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    }
                    O.monthCells(shown).chunked(7).forEach { week ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                            for (i in 0 until 7) {
                                val day = week.getOrNull(i)
                                Box(Modifier.weight(1f).aspectRatio(1f).padding(2.dp)) {
                                    if (day != null) DayCell(day, byDay[day]?.size ?: 0, today = day == data.todayIso, selected = day == picked) { picked = if (picked == day) null else day }
                                }
                            }
                        }
                    }
                    if (data.tasks.isEmpty()) Text(O.calEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp))
                    val list = picked?.let { byDay[it] }.orEmpty()
                    if (picked != null) {
                        Text(P.dmy(picked + "T12:00:00Z") ?: picked!!, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                        if (list.isEmpty()) Text(O.dayEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        list.forEach { t ->
                            ListRow({ onOpenTask(t.id) }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(t.key, fontSize = 12.sp, color = Zk.colors.fgMuted)
                                    Spacer(Modifier.width(8.dp))
                                    Text(t.title, fontSize = 14.5.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    if (data.editable) TextButton(enabled = !busy, onClick = { moving = t.id }) { Text(O.moveDay, color = Zk.colors.accent, fontSize = 13.sp) }
                                }
                            }
                        }
                    }
                    // ⚠️/🔧 the page's «اشتراك التقويم» card stays the site's
                    if (!guest) SiteLine(O.feedWarn, O.feedFix) { onOpenSite("/calendar") }
                }
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    // the system's date picker speaks the phone's language (English on many phones): the calendar's own month is used instead
    moving?.let { taskId ->
        DayPicker(start = picked ?: data?.todayIso ?: "", today = data?.todayIso, onDismiss = { moving = null }) { day ->
            moving = null
            vm.moveTo(taskId, day, month, mine)
        }
    }
}

/** «غيّر اليوم»: the site's month (Sunday first, its month names), the previous and next month; a tap on a day picks it. */
@Composable
private fun DayPicker(start: String, today: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    var ym by rememberSaveable { mutableStateOf(start.take(7)) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Zk.colors.surface1,
        title = { Text(O.moveDay) },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundIcon(Icons.Filled.ChevronRight, O.prev) { ym = O.shiftMonth(ym, -1) }
                    Text(O.monthTitle(ym), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    RoundIcon(Icons.Filled.ChevronLeft, O.next) { ym = O.shiftMonth(ym, 1) }
                }
                Row(Modifier.fillMaxWidth()) {
                    for (d in O.WEEKDAYS_SHORT) Text(d, fontSize = 10.sp, color = Zk.colors.fgMuted, textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.weight(1f))
                }
                O.monthCells(ym).chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        for (i in 0 until 7) {
                            val day = week.getOrNull(i)
                            Box(Modifier.weight(1f).aspectRatio(1f).padding(2.dp)) {
                                if (day != null) DayCell(day, 0, today = day == today, selected = day == start) { onPick(day) }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(P.cancel) } },
    )
}

@Composable
private fun DayCell(day: String, count: Int, today: Boolean, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Column(
        Modifier.fillMaxSize().clip(shape)
            .background(if (selected) Zk.colors.accent.copy(alpha = 0.15f) else Zk.colors.surface1)
            .border(1.dp, if (today) Zk.colors.accent else Zk.colors.border.copy(alpha = 0.5f), shape)
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(day.takeLast(2).trimStart('0'), fontSize = 13.sp, fontWeight = if (today) FontWeight.Bold else FontWeight.Normal, color = if (today) Zk.colors.accent else Zk.colors.fg)
        if (count > 0) Box(Modifier.padding(top = 2.dp).clip(RoundedCornerShape(50)).background(Zk.colors.accent).padding(horizontal = 6.dp)) {
            Text("$count", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accentFg)
        }
    }
}

// ── «الناس» ───────────────────────────────────────────────────────────────────────────────────────────────

/** «الناس» (the page /members for a holder of `directory.view`): every ACTIVE colleague, the owner first, search by name or title; a tap opens the person. */
@Composable
fun PeopleScreen(
    onBack: () -> Unit,
    onOpenPerson: (String) -> Unit,
    /** an owner or an admin (who manage accounts by default): the site's account screen is marked here (⚠️/🔧) */
    manager: Boolean = false,
    onOpenSite: (String) -> Unit = {},
    vm: PeopleViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    WhileOnScreen(120_000) { vm.refresh() }
    var q by rememberSaveable { mutableStateOf("") }
    val data = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = O.people, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        if (manager) SiteLine(O.accountsWarn, O.accountsFix) { onOpenSite("/members") }
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            data.people.isEmpty() -> QuietEmpty(O.peopleEmpty, "")
            else -> {
                OutlinedTextField(q, { q = it.take(80) }, placeholder = { Text(O.searchPh) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp))
                val shown = data.people.filter { O.matches(it.name, it.jobTitle, q) }
                if (shown.isEmpty()) QuietEmpty(O.noMatch, "")
                else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(shown, key = { it.id }) { p -> PersonRow(p) { onOpenPerson(p.id) } }
                }
            }
        }
    }
}

@Composable
private fun PersonRow(p: StaffPerson, onClick: () -> Unit) {
    ListRow(onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(p.name, p.avatarUrl, size = 42.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(p.name + if (p.verified) " ✓" else "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(p.jobTitle?.ifBlank { null } ?: O.noTitle, fontSize = 13.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                p.email?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            StateChip(O.role(p.role), Zk.colors.fgMuted)
        }
    }
}

/** A person (src/components/profile-card.tsx): avatar, name, title, company · rank, last seen, «راسله», about, since, shared spaces, the four counts. */
@Composable
fun ProfileScreen(onBack: () -> Unit, onOpenChat: (String) -> Unit, meId: String?, onOpenSite: (String) -> Unit = {}, vm: ProfileViewModel = hiltViewModel()) {
    LaunchedEffect(vm.id) { vm.refresh() }
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    val p = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = p?.name ?: O.people, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                p == null && state.failure == null -> Loading()
                p == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                p == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Avatar(p.name, p.avatarUrl, size = 88.dp, hue = p.hue)
                    Spacer(Modifier.height(10.dp))
                    Text(p.name, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                    Text(p.jobTitle?.ifBlank { null } ?: O.noTitle, fontSize = 14.sp, color = Zk.colors.fgMuted)
                    listOfNotNull(p.organizationName, p.organizationRole?.let { O.role(it) }).joinToString(" · ").takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Zk.colors.fgMuted) }
                    when {
                        p.online == true -> Text(O.online, fontSize = 12.5.sp, color = Zk.colors.ok)
                        p.lastSeenAt != null -> Text("${O.lastSeen} ${Ago.of(p.lastSeenAt)}", fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                        // the fields are there (another person, the switch on) but no time is known: the site's «غير معروف»
                        p.online == false -> Text("${O.lastSeen} ${O.unknown}", fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                    }
                    if (p.id != meId && p.stats != null) TextButton(onClick = { vm.message(onOpenChat) }) { Text(O.message, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
                    // one's own card: the site's «تعديل ملفي» stays the site's
                    if (p.id == meId) SiteLine(O.profileWarn, O.profileFix) { onOpenSite("/profile") }
                    p.bio?.takeIf { it.isNotBlank() }?.let { SoftCard(O.about) { Text(it, fontSize = 14.5.sp, lineHeight = 22.sp, color = Zk.colors.fg) } }
                    p.createdAt?.let { P.dmy(it) }?.let { Text(O.since(it), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 6.dp)) }
                    p.stats?.let { s ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat(O.statIdeas, s.ideasCreated, Modifier.weight(1f))
                            Stat(O.statVotes, s.ideasVotesReceived, Modifier.weight(1f))
                            Stat(O.statOpen, s.openTasksAssigned, Modifier.weight(1f))
                            Stat(O.statDone, s.tasksCompleted, Modifier.weight(1f))
                        }
                    }
                    if (p.sharedSpaces.isNotEmpty()) SoftCard(O.sharedSpaces, count = p.sharedSpaces.size) {
                        p.sharedSpaces.forEach { s -> Text(listOfNotNull(s.emoji, s.name).joinToString(" "), fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.padding(vertical = 4.dp)) }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun Stat(label: String, n: Int, modifier: Modifier) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier.clip(shape).background(Zk.colors.surface1).border(1.dp, Zk.colors.border.copy(alpha = 0.5f), shape).padding(vertical = 10.dp, horizontal = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
        Text(label, fontSize = 11.sp, color = Zk.colors.fgMuted, textAlign = TextAlign.Center, maxLines = 2)
    }
}

// ── «تقرير الوقت» ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * «تقرير الوقت» (src/components/time/time-report.tsx): «هذا الأسبوع» / «هذا الشهر», the person (when the site lets them pick) and the project,
 * the total, by person · by project · by day, then the entries; the site's ⚠️/🔧 that a running timer is counted only once stopped. Always the
 * space the person is in, as the page.
 */
@Composable
fun TimeScreen(spaceKey: String?, onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit = {}, vm: TimeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val q by vm.query.collectAsStateWithLifecycle()
    WhileOnScreen(120_000, spaceKey) { vm.refresh(spaceKey) }
    val data = state.data
    when {
        data == null && state.failure == null -> Loading()
        data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
        data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(spaceKey) })
        else -> {
            val today = runCatching { LocalDate.now(ZoneId.of(data.timeZone)) }.getOrDefault(LocalDate.now())
            val week = O.preset(true, today)
            val month = O.preset(false, today)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                item(key = "filters") {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip(O.week, data.from == week.first && data.to == week.second) { vm.set(q.copy(from = week.first, to = week.second), spaceKey) }
                        Chip(O.month, data.from == month.first && data.to == month.second) { vm.set(q.copy(from = month.first, to = month.second), spaceKey) }
                        if (data.canPickPerson) Picker(O.allPeople, data.people.map { it.id to it.name }, q.userId) { vm.set(q.copy(userId = it), spaceKey) }
                        if (data.projects.isNotEmpty()) Picker(O.allProjects, data.projects.map { it.id to it.name }, q.projectId) { vm.set(q.copy(projectId = it), spaceKey) }
                    }
                    Text("${P.dmy(data.from + "T12:00:00Z") ?: data.from} — ${P.dmy(data.to + "T12:00:00Z") ?: data.to}", fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.Bottom) {
                        Text(O.total, fontSize = 14.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f))
                        Text(O.both(data.totalSeconds), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                    }
                    WarnFix(O.timeWarn, O.timeFix)
                    SiteLine(O.reportSiteWarn, O.reportSiteFix) { onOpenSite("/time") }
                }
                if (data.rows.isEmpty()) item(key = "empty") { QuietEmpty(O.timeEmpty, "") }
                else {
                    item(key = "groups") {
                        Groups(O.byPerson, data.byPerson) { it.label }
                        Groups(O.byProject, data.byProject) { if (it.key == "none") O.noProject else it.label }
                        Groups(O.byDay, data.byDay) { P.dmy(it.key + "T12:00:00Z") ?: it.label }
                        Text(O.entries, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                    }
                    items(data.rows, key = { it.id }) { r ->
                        ListRow(r.taskId?.let { id -> { onOpenTask(id) } }) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(listOfNotNull(r.taskKey, r.taskTitle).joinToString(" "), fontSize = 14.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    Text(O.hm(r.seconds), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                                }
                                Text(
                                    listOfNotNull(P.dmy(r.day + "T12:00:00Z") ?: r.day, r.userName, r.projectName, O.source(r.source), if (r.autoStopped) O.autoStopped else null).joinToString(" · "),
                                    fontSize = 12.sp,
                                    color = Zk.colors.fgMuted,
                                )
                                r.note.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.5.sp, color = Zk.colors.fgMuted) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Groups(title: String, groups: List<TimeGroup>, label: (TimeGroup) -> String) {
    if (groups.isEmpty()) return
    SoftCard(title) {
        groups.forEach { g ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(label(g), fontSize = 14.sp, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(O.both(g.seconds), fontSize = 13.sp, color = Zk.colors.fgMuted)
            }
        }
    }
}

/** A chip that opens a short list (a person, a project); the first entry clears it. */
@Composable
private fun Picker(all: String, options: List<Pair<String, String>>, value: String?, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Chip(options.firstOrNull { it.first == value }?.second ?: all, value != null) { open = true }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text(all) }, onClick = { open = false; onPick(null) })
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { open = false; onPick(id) }) }
        }
    }
}

// ── «التذاكر» ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun statusTone(s: String): Color = when (s) {
    "IN_PROGRESS" -> Zk.colors.info
    "RESOLVED" -> Zk.colors.ok
    "CLOSED" -> Zk.colors.fgMuted
    else -> Zk.colors.warn
}

@Composable
private fun priorityTone(p: String): Color = when (p) {
    "URGENT" -> Zk.colors.danger
    "HIGH" -> Zk.colors.warn
    else -> Zk.colors.fgMuted
}

/**
 * «التذاكر» (src/components/work-desks.tsx `TicketsDesk`): «تذاكري» and one pill per department (with its open count); a department's desk lists
 * its tickets and «تذكرة جديدة» (title, details, priority, who it goes to). A ticket opens its sheet.
 */
@Composable
fun TicketsScreen(
    onOpenTicket: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    /** an owner or an admin: the site gives them «التذاكر الفورية», marked here (⚠️/🔧) */
    manager: Boolean = false,
    vm: TicketsViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val depts by vm.departments.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var dept by rememberSaveable { mutableStateOf<String?>(null) }
    // saveable: a turn of the phone keeps the form open with what was typed
    var adding by rememberSaveable { mutableStateOf(false) }
    WhileOnScreen(60_000, dept) { vm.refresh(dept) }
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PillStrip {
                PillTab(O.myTickets.substringBefore(':'), 0, dept == null) { dept = null }
                depts?.departments?.forEach { d -> PillTab(listOfNotNull(d.emoji, d.name).joinToString(" "), d.openTickets, dept == d.id) { dept = d.id } }
            }
            if (manager && dept == null) SiteLine(O.instantWarn, O.instantFix) { onOpenSite("/tickets") }
            when {
                data == null && state.failure == null -> Loading()
                data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(dept) })
                data.tickets.isEmpty() -> Column {
                    QuietEmpty(if (dept == null) O.noMyTickets else O.noDeptTickets, if (depts?.departments?.isEmpty() == true) O.noDepartments else "")
                }
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                    if (dept == null) item(key = "head") { Text(O.myTickets, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
                    items(data.tickets, key = { it.id }) { t -> TicketRow(t, showDept = dept == null) { onOpenTicket(t.id) } }
                }
            }
        }
        if (dept != null) RoundFab(Icons.Filled.Add, O.newTicket, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { adding = true }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    val d = depts?.departments?.firstOrNull { it.id == dept }
    if (adding && d != null) {
        var title by rememberSaveable { mutableStateOf("") }
        var desc by rememberSaveable { mutableStateOf("") }
        var priority by rememberSaveable { mutableStateOf("NORMAL") }
        var assignee by rememberSaveable { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { adding = false },
            containerColor = Zk.colors.surface1,
            title = { Text(O.newTicket) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(title, { title = it.take(200) }, placeholder = { Text(O.ticketTitlePh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(desc, { desc = it.take(4000) }, placeholder = { Text(O.ticketDescPh) }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth())
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        O.PRIORITIES.forEach { p -> Chip(O.priority(p), priority == p) { priority = p } }
                    }
                    Picker(O.unassigned, d.members.map { it.id to it.name }, assignee) { assignee = it }
                }
            },
            // the site's rule: three letters at least
            confirmButton = { TextButton(enabled = title.trim().length >= 3 && !busy, onClick = { vm.create(d.id, title, desc, priority, assignee) { adding = false } }) { Text(O.submitTicket) } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text(P.cancel) } },
        )
    }
}

@Composable
private fun TicketRow(t: TicketItem, showDept: Boolean, onClick: () -> Unit) {
    ListRow(onClick) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("#${t.number}", fontSize = 12.sp, color = Zk.colors.fgMuted)
                Spacer(Modifier.width(8.dp))
                Text(t.title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                StateChip(O.status(t.status), statusTone(t.status))
            }
            Text(
                listOfNotNull(
                    O.priority(t.priority),
                    if (showDept) t.department?.let { listOfNotNull(it.emoji, it.name).joinToString(" ") } else null,
                    t.creator?.name,
                    t.assignee?.let { "${O.to} ${it.name}" } ?: O.unassigned,
                    Ago.of(t.createdAt),
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = priorityTone(t.priority).takeIf { t.priority == "URGENT" } ?: Zk.colors.fgMuted,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
    }
}

/**
 * ONE TICKET (the site's ticket sheet): number, title, status and priority (changed in place, as far as the server allows), who it is with,
 * the details, the customer's number when the server gives it to this reader, the linked task, the comments and a new comment. ⚠️/🔧 for what
 * stays the site's (editing the text, deleting, «حوّل لمهمة»).
 */
@Composable
fun TicketScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenSite: (String) -> Unit, vm: TicketViewModel = hiltViewModel()) {
    LaunchedEffect(vm.id) { vm.refresh() }
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    var comment by rememberSaveable { mutableStateOf("") }
    val t = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = t?.let { "#${it.number}" } ?: O.tickets, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                t == null && state.failure == null -> Loading()
                t == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                t == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                    Text(t.title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp))
                    Text(listOfNotNull(t.creator.name, P.dmy(t.createdAt)).joinToString(" · "), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(O.statusLabel, fontSize = 12.sp, color = Zk.colors.fgMuted)
                        // only the moves the server allows from here (canTransition)
                        O.STATUSES.filter { O.canMove(t.status, it) }.forEach { s -> Chip(O.status(s), t.status == s) { if (!busy && t.status != s) vm.patch(TicketPatch(status = s)) } }
                    }
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(O.priorityLabel, fontSize = 12.sp, color = Zk.colors.fgMuted)
                        O.PRIORITIES.forEach { p -> Chip(O.priority(p), t.priority == p) { if (!busy && t.priority != p) vm.patch(TicketPatch(priority = p)) } }
                    }
                    Text(t.assignee?.let { "${O.to} ${it.name}" } ?: O.unassigned, fontSize = 13.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    t.description?.takeIf { it.isNotBlank() }?.let { SoftCard { Text(it, fontSize = 15.sp, lineHeight = 23.sp, color = Zk.colors.fg) } }
                    t.customerNumber?.takeIf { it.isNotBlank() }?.let { Text("${O.customerNumber}: $it", fontSize = 13.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                    if (t.task?.state == "hidden") Text(O.linkedHidden, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                    if (t.task?.state == "visible" && t.task.id != null) {
                        Text("${O.linkedTask}: ${listOfNotNull(t.task.key, t.task.title).joinToString(" ")}", fontSize = 13.5.sp, color = Zk.colors.accent, modifier = Modifier.fillMaxWidth().clickable { onOpenTask(t.task.id) }.padding(horizontal = 16.dp, vertical = 8.dp))
                    }
                    SoftCard(O.comments, count = t.comments.size) {
                        t.comments.forEach { c ->
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Text("${c.author.name} · ${Ago.of(c.createdAt)}", fontSize = 12.sp, color = Zk.colors.fgMuted)
                                Text(c.body, fontSize = 14.5.sp, lineHeight = 22.sp, color = Zk.colors.fg)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(comment, { comment = it.take(4000) }, placeholder = { Text(O.commentPh) }, maxLines = 4, modifier = Modifier.weight(1f))
                            RoundIcon(Icons.AutoMirrored.Filled.Send, O.comments, tint = Zk.colors.accent, enabled = comment.isNotBlank() && !busy) { vm.comment(comment) { comment = "" } }
                        }
                    }
                    SiteLine(O.ticketsSiteWarn, O.ticketsSiteFix) { onOpenSite("/tickets?ticket=" + t.id) }
                    Spacer(Modifier.height(24.dp))
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}
