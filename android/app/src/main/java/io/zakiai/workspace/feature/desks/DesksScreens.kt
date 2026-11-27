package io.zakiai.workspace.feature.desks

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.feature.office.MonthDayPicker
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

private const val GUEST = "هذا القسم غير متاح للزوار"
private const val OFF = "هذا القسم غير مفعّل لحسابك. اطلب من المالك تفعيله."

@Composable
private fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun StatusChip(text: String, color: Color) {
    Text(text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = color, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun statusColor(s: String) = when (s) {
    "RUNNING" -> Zk.colors.ok
    "SCHEDULED" -> Zk.colors.info
    "DONE" -> Zk.colors.fgMuted
    "CANCELLED" -> Zk.colors.danger
    else -> Zk.colors.warn
}

@Composable
private fun deptColor(c: String?) = when (c) {
    "sky" -> Zk.colors.info
    "emerald" -> Zk.colors.ok
    "amber" -> Zk.colors.warn
    "fuchsia" -> Zk.colors.cat5
    "rose" -> Zk.colors.danger
    else -> Zk.colors.accent
}

@Composable
private fun Notices(snack: SnackbarHostState, notice: String?, consume: () -> Unit) {
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); consume() } }
}

// ── «الحملات» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «الحملات» (src/components/work-desks.tsx `CampaignsDesk`): «حملاتي», then a department's desk — the department of the space first. Who
 * may add, move and delete is the site's rule (the owner and the admins, and the department's own people), decided again on the server.
 */
@Composable
fun CampaignsScreen(initialDept: String?, meId: String?, onOpenTask: (String) -> Unit, vm: CampaignsViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val mine by vm.mine.collectAsStateWithLifecycle()
    val depts by vm.depts.collectAsStateWithLifecycle()
    val picked by vm.picked.collectAsStateWithLifecycle()
    val list by vm.list.collectAsStateWithLifecycle()
    val items by vm.items.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Campaign?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    WhileOnScreen(60_000, initialDept) { vm.refresh(initialDept) }
    val snack = remember { SnackbarHostState() }
    Notices(snack, notice, vm::consumeNotice)
    val f = facts
    Box(Modifier.fillMaxSize().background(Zk.colors.surface)) {
        when {
            f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh(initialDept) })
            f == null -> Loading()
            f.external -> Empty(GUEST)
            !f.directory || !f.campaigns.view -> Empty(OFF)
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                item(key = "mine") {
                    Text(Q.myCampaigns, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
                    val m = mine
                    when {
                        m == null -> Loading(Modifier.fillMaxWidth().height(50.dp))
                        m.isEmpty() -> Text(Q.noMyCampaigns, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        else -> m.forEach { c ->
                            Row(Modifier.fillMaxWidth().clickable { c.department?.id?.let(vm::open) }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("${c.department?.emoji ?: "🏢"} ${c.department?.name.orEmpty()} · ${c.title}", fontSize = 14.sp, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                StatusChip(Q.status(c.status), statusColor(c.status))
                            }
                        }
                    }
                }
                item(key = "depts") {
                    val d = depts
                    Text(Q.department, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
                    when {
                        d == null -> Loading(Modifier.fillMaxWidth().height(50.dp))
                        d.isEmpty() -> Text(Q.noDepartments, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        else -> Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            d.forEach { dep -> Pill("${dep.emoji ?: "🏢"} ${dep.name}", picked == dep.id) { vm.open(dep.id) } }
                        }
                    }
                }
                val dept = depts?.firstOrNull { it.id == picked }
                val manages = Q.managesCampaigns(f.manager, dept, meId)
                if (dept != null) {
                    item(key = "head") {
                        val l = list
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (l != null) Q.activeCount(Q.active(l)) else "", fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f))
                        }
                        if (l == null) Loading(Modifier.fillMaxWidth().height(60.dp))
                    }
                    items(list.orEmpty(), key = { it.id }) { c ->
                        CampaignRow(
                            c, manages && f.campaigns.edit, manages && f.campaigns.delete, busy, open == c.id, items[c.id],
                            onStatus = { vm.status(c, it) },
                            onDelete = { deleting = c },
                            onToggle = { if (open == c.id) open = null else { open = c.id; vm.loadItems(c.id) } },
                            onMakeTask = { vm.makeTask(c.id, it) },
                            onOpenTask = onOpenTask,
                        )
                    }
                }
            }
        }
        if (f?.campaigns?.edit == true && picked != null) RoundFab(Icons.Filled.Add, Q.newCampaign, Modifier.align(Alignment.BottomEnd).padding(18.dp)) { creating = true }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    if (creating) NewCampaign(f?.today.orEmpty(), busy, onClose = { creating = false }) { title, desc, pr, s, e -> vm.create(title, desc, pr, s, e) { creating = false } }
    deleting?.let { c ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = Zk.colors.surface1,
            text = { Text(Q.deleteCampaignAsk(c.title), fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(onClick = { deleting = null; vm.delete(c) }) { Text(Q.delete, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(Q.cancel) } },
        )
    }
}

@Composable
private fun CampaignRow(
    c: Campaign, canEdit: Boolean, canDelete: Boolean, busy: Boolean, open: Boolean, items: List<CampaignItem>?,
    onStatus: (String) -> Unit, onDelete: () -> Unit, onToggle: () -> Unit, onMakeTask: (CampaignItem) -> Unit, onOpenTask: (String) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("⁦C${c.number}⁩ ", fontSize = 12.sp, color = Zk.colors.fgMuted)
            Text(c.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Box {
                Box(Modifier.clickable(enabled = canEdit && !busy) { menu = true }) { StatusChip(Q.status(c.status), statusColor(c.status)) }
                DropdownMenu(menu, { menu = false }) {
                    Q.STATUSES.forEach { s -> DropdownMenuItem(text = { Text(Q.status(s)) }, onClick = { menu = false; if (s != c.status) onStatus(s) }) }
                }
            }
            if (canDelete) RoundIcon(Icons.Filled.Delete, Q.delete, tint = Zk.colors.danger, size = 18.dp, enabled = !busy, onClick = onDelete)
        }
        Text(
            listOfNotNull("${Q.shortDay(c.startDate)} ← ${Q.shortDay(c.endDate)}", c.owner?.name, Q.itemsLine(c.count.items)).joinToString(" · "),
            fontSize = 12.5.sp, color = Zk.colors.fgMuted,
        )
        Text(if (open) Q.itemsHide else Q.itemsShow, fontSize = 13.sp, color = Zk.colors.accent, modifier = Modifier.clickable(onClick = onToggle).padding(vertical = 4.dp))
        if (open) {
            when {
                items == null -> Text("…", color = Zk.colors.fgMuted)
                items.isEmpty() -> Text(Q.itemsEmpty, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                else -> items.forEach { it ->
                    Column(Modifier.fillMaxWidth().padding(start = 8.dp, top = 4.dp, bottom = 4.dp)) {
                        Text(it.title + " · " + Q.shortDay(it.dueDate), fontSize = 13.5.sp, color = Zk.colors.fg)
                        val t = it.task
                        when {
                            t?.state == "visible" && t.id != null -> Text(Q.linkedTask + " · " + t.key.orEmpty(), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenTask(t.id) })
                            t?.state == "hidden" -> Text(Q.hiddenTask, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                            else -> {
                                if (it.kind == "task") WarnFix(Q.itemWarn, Q.itemFix)
                                if (canEdit) TextButton(enabled = !busy, onClick = { onMakeTask(it) }) { Text("🔧 " + Q.makeTask, color = Zk.colors.accent, fontSize = 13.sp) }
                            }
                        }
                    }
                }
            }
        }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun NewCampaign(today: String, busy: Boolean, onClose: () -> Unit, onSave: (String, String, String, String, String) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var desc by rememberSaveable { mutableStateOf("") }
    var pr by rememberSaveable { mutableStateOf("NORMAL") }
    var start by rememberSaveable { mutableStateOf<String?>(null) }
    var end by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(Q.newCampaignTitle) },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it.take(200) }, placeholder = { Text(Q.campTitlePh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(desc, { desc = it.take(4000) }, placeholder = { Text(Q.descPh) }, minLines = 2, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Pill(Q.start + ": " + (start?.let(Q::shortDay) ?: Q.pickDay), picking == "start") { picking = "start" }
                    Pill(Q.end + ": " + (end?.let(Q::shortDay) ?: Q.pickDay), picking == "end") { picking = "end" }
                }
                picking?.let { which ->
                    // the app's own month (the system picker speaks the phone's language)
                    MonthDayPicker(start = (if (which == "start") start else end ?: start) ?: today, earliest = if (which == "end") start else null) { d ->
                        if (which == "start") { start = d; if (end != null && end!! < d) end = null } else end = d
                        picking = null
                    }
                }
                Text(Q.priority, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Q.PRIORITIES.forEach { p -> Pill(Q.priority(p), pr == p) { pr = p } }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && title.trim().length >= 3 && start != null && end != null, onClick = { onSave(title, desc, pr, start!!, end!!) }) { Text(Q.submitCampaign) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(Q.cancel) } },
    )
}

// ── «الأقسام» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «أقسام الشركة» (src/components/departments-view.tsx): each department with its numbers and its people; its tickets and campaigns
 * open on their own screens (native). The owner and the admins make, edit and delete departments and pick their people.
 */
@Composable
fun DepartmentsScreen(onBack: () -> Unit, onOpenCampaigns: (String) -> Unit, onOpenTickets: () -> Unit, vm: DepartmentsViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val list by vm.list.collectAsStateWithLifecycle()
    val people by vm.people.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Department?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var membersOf by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Department?>(null) }
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    Notices(snack, notice, vm::consumeNotice)
    val f = facts
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = Q.departments, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh() })
                f == null -> Loading()
                f.external -> Empty(GUEST)
                !f.directory || f.spaceOnly -> Empty(OFF)
                list == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh() })
                list == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                    item(key = "head") {
                        Text(Q.deptSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                        if (!f.manager) Text(Q.deptAdminOnly, fontSize = 12.5.sp, color = Zk.colors.info, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                        if (list!!.isEmpty()) QuietEmpty(Q.noDepts, "")
                    }
                    items(list!!, key = { it.id }) { d ->
                        DepartmentRow(
                            d, f, busy,
                            onCampaigns = { onOpenCampaigns(d.id) },
                            onTickets = onOpenTickets,
                            onEdit = { editing = d; vm.loadPeople() },
                            onMembers = { membersOf = d.id; vm.loadPeople() },
                            onDelete = { deleting = d },
                        )
                    }
                }
            }
            if (f?.manager == true) RoundFab(Icons.Filled.Add, Q.newDept, Modifier.align(Alignment.BottomEnd).padding(18.dp)) { creating = true; vm.loadPeople() }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (creating || editing != null) DepartmentEditor(editing, people, busy, onClose = { creating = false; editing = null }) { name, emoji, color, lead ->
        vm.save(editing?.id, name, emoji, color, lead) { creating = false; editing = null }
    }
    membersOf?.let { id ->
        val d = list?.firstOrNull { it.id == id }
        if (d != null) MembersDialog(d, people, busy, onClose = { membersOf = null }, onAdd = { vm.add(d.id, it) }, onRemove = { vm.remove(d.id, it) })
    }
    deleting?.let { d ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = Zk.colors.surface1,
            text = { Text(Q.deleteDeptAsk, fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(onClick = { deleting = null; vm.delete(d.id) }) { Text(Q.delete, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(Q.cancel) } },
        )
    }
}

@Composable
private fun DepartmentRow(d: Department, f: DeskFacts, busy: Boolean, onCampaigns: () -> Unit, onTickets: () -> Unit, onEdit: () -> Unit, onMembers: () -> Unit, onDelete: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(deptColor(d.color).copy(alpha = 0.18f)), contentAlignment = Alignment.Center) { Text(d.emoji ?: "🏢", fontSize = 20.sp) }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(d.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                Text(Q.statMembers(d.members.size), fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
            if (f.manager) {
                RoundIcon(Icons.Filled.Group, Q.addMembers, size = 20.dp, enabled = !busy, onClick = onMembers)
                RoundIcon(Icons.Filled.Edit, Q.editDept, size = 20.dp, enabled = !busy, onClick = onEdit)
                RoundIcon(Icons.Filled.Delete, Q.delete, tint = Zk.colors.danger, size = 20.dp, enabled = !busy, onClick = onDelete)
            }
        }
        Text(
            listOfNotNull(Q.statProjects(d.projectsCount), Q.statOpen(d.openTasks)).joinToString(" · "),
            fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp),
        )
        Row {
            if (d.overdueTasks > 0) Text(Q.statOverdue(d.overdueTasks) + "  ", fontSize = 12.5.sp, color = Zk.colors.danger)
            if (d.openTickets > 0) Text(Q.statTickets(d.openTickets), fontSize = 12.5.sp, color = Zk.colors.warn)
        }
        if (d.members.isNotEmpty()) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
            d.members.take(6).forEach { m -> Avatar(m.name, url = m.avatarUrl, size = 28.dp) }
            if (d.members.size > 6) Text("  +${d.members.size - 6}", fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 10.dp))
        }
        Row(Modifier.padding(top = 4.dp)) {
            if (f.tickets.view) TextButton(onClick = onTickets) { Text(Q.tickets, color = Zk.colors.accent) }
            if (f.campaigns.view) TextButton(onClick = onCampaigns) { Text(Q.campaigns, color = Zk.colors.accent) }
        }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun DepartmentEditor(d: Department?, people: List<DirectoryUser>?, busy: Boolean, onClose: () -> Unit, onSave: (String, String?, String?, String?) -> Unit) {
    var name by remember(d?.id) { mutableStateOf(d?.name.orEmpty()) }
    var emoji by remember(d?.id) { mutableStateOf(d?.emoji ?: Q.EMOJIS.first()) }
    var color by remember(d?.id) { mutableStateOf(d?.color ?: "indigo") }
    var lead by remember(d?.id) { mutableStateOf(d?.leadId) }
    var leadOpen by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(if (d == null) Q.createDept else Q.editDept) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, placeholder = { Text(Q.deptName) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(Q.deptEmoji, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Q.EMOJIS.forEach { e -> Text(e, fontSize = 22.sp, modifier = Modifier.clip(CircleShape).background(if (emoji == e) Zk.colors.accent.copy(alpha = 0.2f) else Color.Transparent).clickable { emoji = e }.padding(6.dp)) }
                }
                Text(Q.deptColor + ": " + Q.color(color), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Q.COLORS.forEach { c ->
                        Box(Modifier.size(30.dp).clip(CircleShape).background(deptColor(c)).border(if (color == c) 3.dp else 0.dp, Zk.colors.fg, CircleShape).clickable { color = c })
                    }
                }
                Text(Q.lead, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Box {
                    Pill(people?.firstOrNull { it.id == lead }?.name ?: d?.members?.firstOrNull { it.id == lead }?.name ?: Q.noLead, lead != null) { leadOpen = true }
                    DropdownMenu(leadOpen, { leadOpen = false }) {
                        DropdownMenuItem(text = { Text(Q.noLead) }, onClick = { lead = null; leadOpen = false })
                        people.orEmpty().forEach { p -> DropdownMenuItem(text = { Text(p.name) }, onClick = { lead = p.id; leadOpen = false }) }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && name.trim().length >= 2, onClick = { onSave(name, emoji, color, lead) }) { Text(Q.save) } },
        dismissButton = { TextButton(onClick = onClose) { Text(Q.cancel) } },
    )
}

@Composable
private fun MembersDialog(d: Department, people: List<DirectoryUser>?, busy: Boolean, onClose: () -> Unit, onAdd: (String) -> Unit, onRemove: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text("${d.emoji ?: "🏢"} ${d.name} — ${Q.membersTitle}") },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                if (d.members.isEmpty()) Text(Q.noMembers, fontSize = 13.sp, color = Zk.colors.fgMuted)
                d.members.forEach { m ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.name, url = m.avatarUrl, size = 30.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                            Text(m.name, fontSize = 14.sp, color = Zk.colors.fg)
                            m.jobTitle?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
                        }
                        TextButton(enabled = !busy, onClick = { onRemove(m.id) }) { Text(Q.removeMember, color = Zk.colors.danger) }
                    }
                }
                HorizontalDivider(color = Zk.colors.border, modifier = Modifier.padding(vertical = 8.dp))
                val addable = people?.filter { p -> d.members.none { it.id == p.id } }
                when {
                    addable == null -> Loading(Modifier.fillMaxWidth().height(40.dp))
                    addable.isEmpty() -> Text(Q.everyoneIn, fontSize = 13.sp, color = Zk.colors.fgMuted)
                    else -> addable.forEach { p ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(p.name, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                            TextButton(enabled = !busy, onClick = { onAdd(p.id) }) { Text(Q.addMembers, color = Zk.colors.accent) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(Q.cancel) } },
    )
}

// ── «الروتين اليومي» ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * «الروتين اليومي» (src/components/production-view.tsx): one day's checklist, the company's today first, moved a day at a time; anybody who
 * reads it ticks it; who may edit manages the routines and turns one into a recurring task (the site's ⚠️/🔧, kept).
 */
@Composable
fun ProductionScreen(onOpenTask: (String) -> Unit, vm: ProductionViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val day by vm.day.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var managing by rememberSaveable { mutableStateOf(false) }
    WhileOnScreen(60_000) { vm.refresh(null) }
    val snack = remember { SnackbarHostState() }
    Notices(snack, notice, vm::consumeNotice)
    val f = facts
    Box(Modifier.fillMaxSize().background(Zk.colors.surface)) {
        when {
            f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh(null) })
            f == null -> Loading()
            f.external -> Empty(GUEST)
            !f.production.view -> Empty(OFF)
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
                item(key = "head") {
                    Text(Q.routineSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    Column(Modifier.padding(horizontal = 12.dp)) { WarnFix(Q.dupWarn, Q.dupFix) }
                    if (f.production.edit) TextButton(onClick = { managing = true; vm.loadRoutines() }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(Q.manage, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
                    val d = day
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, Q.prevDay) { vm.current()?.let { vm.refresh(Q.shiftDay(it, -1)) } }
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(Q.longDay(d?.day ?: vm.current().orEmpty()), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                            if (d != null) Text(if (d.items.isEmpty()) Q.noSchedule else Q.doneRatio(Q.doneCount(d.items), d.items.size), fontSize = 12.sp, color = Zk.colors.fgMuted)
                        }
                        RoundIcon(Icons.AutoMirrored.Filled.ArrowForward, Q.nextDay) { vm.current()?.let { vm.refresh(Q.shiftDay(it, 1)) } }
                    }
                    if (d != null && d.items.isNotEmpty()) LinearProgressIndicator(
                        progress = { Q.doneCount(d.items).toFloat() / d.items.size },
                        color = Zk.colors.ok, trackColor = Zk.colors.surface2,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(6.dp).clip(RoundedCornerShape(3.dp)),
                    )
                    if (d == null) Loading(Modifier.fillMaxWidth().height(80.dp))
                }
                items(day?.items.orEmpty(), key = { it.id }) { r ->
                    val done = r.doneAt != null
                    Row(Modifier.fillMaxWidth().clickable(enabled = !busy && !r.archived) { vm.tick(r) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(26.dp).clip(CircleShape).background(if (done) Zk.colors.ok else Color.Transparent).border(2.dp, if (done) Zk.colors.ok else Zk.colors.border, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { if (done) Icon(Icons.Filled.Check, Q.done, tint = Zk.colors.okFg, modifier = Modifier.size(16.dp)) }
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(r.title, fontSize = 15.sp, color = if (done) Zk.colors.fgMuted else Zk.colors.fg, textDecoration = if (done) TextDecoration.LineThrough else null)
                            Text(
                                listOfNotNull(r.assigneeName?.let { Q.assignedTo + " " + it } ?: Q.unassigned, r.departmentName).joinToString(" · "),
                                fontSize = 12.sp, color = Zk.colors.fgMuted,
                            )
                            if (r.archived) Text(Q.archivedHint, fontSize = 12.sp, color = Zk.colors.info)
                        }
                        if (r.archived) Text(Q.archived, fontSize = 11.sp, color = Zk.colors.fgMuted)
                    }
                    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(start = 54.dp))
                }
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    if (managing && f != null) RoutinesDialog(vm, f, busy, onOpenTask, onClose = { managing = false })
}

@Composable
private fun RoutinesDialog(vm: ProductionViewModel, f: DeskFacts, busy: Boolean, onOpenTask: (String) -> Unit, onClose: () -> Unit) {
    val routines by vm.routines.collectAsStateWithLifecycle()
    val people by vm.people.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Routine?>(null) }
    var creating by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(Q.manageTitle) },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                if (editing != null || creating) {
                    RoutineEditor(editing, people, busy, onCancel = { editing = null; creating = false }) { title, desc, who, days, active ->
                        vm.save(editing?.id, title, desc, who, days, active) { editing = null; creating = false }
                    }
                } else {
                    TextButton(onClick = { creating = true }) { Text("+ " + Q.newRoutine, color = Zk.colors.accent) }
                    val l = routines
                    when {
                        l == null -> Text("…", color = Zk.colors.fgMuted)
                        l.isEmpty() -> Text(Q.noRoutines, fontSize = 13.sp, color = Zk.colors.fgMuted)
                        else -> l.forEach { r ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(r.title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                    RoundIcon(Icons.Filled.Edit, Q.editRoutine, size = 18.dp, enabled = !busy) { editing = r }
                                    if (f.production.delete) RoundIcon(Icons.Filled.Delete, Q.delete, tint = Zk.colors.danger, size = 18.dp, enabled = !busy) { vm.delete(r.id) }
                                }
                                Text(
                                    listOfNotNull(Q.weekdaysLabel(r.weekdays), r.assigneeName, if (!r.active) Q.paused else null).joinToString(" · "),
                                    fontSize = 12.sp, color = Zk.colors.fgMuted,
                                )
                                val t = r.convertedTask
                                when {
                                    t?.state == "visible" && t.id != null -> Text(Q.taskOpen + " · " + t.key.orEmpty(), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onClose(); onOpenTask(t.id) })
                                    t?.state == "hidden" -> Text(Q.taskHidden, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                                    else -> TextButton(enabled = !busy, onClick = { vm.convert(r.id) }) { Text("🔧 " + Q.convert, color = Zk.colors.accent, fontSize = 13.sp) }
                                }
                            }
                            HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f))
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(Q.cancel) } },
    )
}

@Composable
private fun RoutineEditor(r: Routine?, people: List<DirectoryUser>?, busy: Boolean, onCancel: () -> Unit, onSave: (String, String, String?, Set<Int>, Boolean) -> Unit) {
    var title by remember(r?.id) { mutableStateOf(r?.title.orEmpty()) }
    var desc by remember(r?.id) { mutableStateOf(r?.description.orEmpty()) }
    var who by remember(r?.id) { mutableStateOf(r?.assigneeId) }
    var days by remember(r?.id) { mutableStateOf(r?.let { Q.weekdaysOf(it.weekdays) } ?: (0..6).toSet()) }
    var active by remember(r?.id) { mutableStateOf(r?.active ?: true) }
    var whoOpen by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (r == null) Q.newRoutine else Q.editRoutine, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
        OutlinedTextField(title, { title = it.take(120) }, placeholder = { Text(Q.routineTitlePh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(desc, { desc = it.take(500) }, placeholder = { Text(Q.routineDescPh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Q.WD_SHORT.forEachIndexed { i, name -> Pill(name, i in days) { days = if (i in days) days - i else days + i } }
        }
        Box {
            Pill(people?.firstOrNull { it.id == who }?.name ?: r?.assigneeName?.takeIf { who == r.assigneeId } ?: Q.unassigned, who != null) { whoOpen = true }
            DropdownMenu(whoOpen, { whoOpen = false }) {
                DropdownMenuItem(text = { Text(Q.unassigned) }, onClick = { who = null; whoOpen = false })
                people.orEmpty().forEach { p -> DropdownMenuItem(text = { Text(p.name) }, onClick = { who = p.id; whoOpen = false }) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Q.activeLabel, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
            Switch(active, { active = it }, colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent))
        }
        Row {
            TextButton(enabled = !busy && title.trim().length >= 2, onClick = { onSave(title, desc, who, days.ifEmpty { (0..6).toSet() }, active) }) { Text(Q.save, color = Zk.colors.accent, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = onCancel) { Text(Q.cancel) }
        }
    }
}
