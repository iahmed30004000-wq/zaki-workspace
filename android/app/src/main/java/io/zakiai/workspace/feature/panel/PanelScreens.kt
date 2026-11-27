package io.zakiai.workspace.feature.panel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.feature.desk.SiteLine
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
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
private fun Title(text: String, hint: String? = null) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp)) {
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
        hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
    }
}

/** A number card of a dashboard (D1: cards are for dashboards): the label, the value, one line under it. */
@Composable
private fun Stat(label: String, value: String, hint: String? = null, tone: Color? = null, modifier: Modifier = Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(12.dp)) {
        Text(label, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 2)
        Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = tone ?: Zk.colors.fg)
        hint?.let { Text(it, fontSize = 11.5.sp, color = tone ?: Zk.colors.fgMuted, maxLines = 2) }
    }
}

@Composable
private fun StatGrid(items: List<@Composable (Modifier) -> Unit>) {
    Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { it(Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** A horizontal bar: its label, its count, its length against the largest. */
@Composable
private fun Bar(label: String, n: Int, max: Int, color: Color) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(110.dp))
        Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Zk.colors.surface2)) {
            Box(Modifier.fillMaxWidth(n.toFloat() / maxOf(1, max)).fillMaxHeight().background(color))
        }
        Text("  $n", fontSize = 13.sp, color = Zk.colors.fgMuted)
    }
}

/** The days of a range as thin columns (the board's sparkline): a zero day a faint stub. */
@Composable
private fun Spark(values: List<Int>, height: Int = 24) {
    val max = maxOf(1, values.maxOrNull() ?: 0)
    Row(Modifier.height(height.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        values.forEach { v ->
            Box(Modifier.width(4.dp).fillMaxHeight(if (v == 0) 0.12f else v.toFloat() / max).clip(RoundedCornerShape(1.dp)).background(if (v == 0) Zk.colors.fgMuted.copy(alpha = 0.3f) else Zk.colors.ok))
        }
    }
}

// ── «العملاء» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «العملاء» (src/components/crm-view.tsx): the customers and the opportunities of the space, each with its stage; who may edit adds and
 * edits, who may delete deletes (the phone asks first); the amount of an opportunity exists only for who holds `prices.view`.
 */
@Composable
fun CrmScreen(onBack: () -> Unit, vm: CrmViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val customers by vm.customers.collectAsStateWithLifecycle()
    val opps by vm.opps.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("customers") }
    var editingCustomer by remember { mutableStateOf<Customer?>(null) }
    var newCustomer by rememberSaveable { mutableStateOf(false) }
    var editingOpp by remember { mutableStateOf<Opportunity?>(null) }
    var newOpp by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Pair<String, String>?>(null) }
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val f = facts
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = B.crm, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh() })
                f == null -> Loading()
                f.external -> Empty(GUEST)
                !f.crm.view -> Empty(OFF)
                customers == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh() })
                customers == null || opps == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                    item(key = "tabs") {
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill("${B.customers} (${customers!!.size})", tab == "customers") { tab = "customers" }
                            Pill("${B.opportunities} (${opps!!.size})", tab == "opps") { tab = "opps" }
                        }
                    }
                    if (tab == "customers") {
                        if (customers!!.isEmpty()) item(key = "ce") { QuietEmpty(B.emptyCustomers, "") }
                        items(customers!!, key = { "c" + it.id }) { c ->
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(c.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                                    listOfNotNull(c.company, c.email, c.phone).forEach { Text("⁨$it⁩", fontSize = 12.5.sp, color = Zk.colors.fgMuted) }
                                }
                                if (f.crm.edit) RoundIcon(Icons.Filled.Edit, B.edit, size = 18.dp, enabled = !busy) { editingCustomer = c }
                                if (f.crm.delete) RoundIcon(Icons.Filled.Delete, B.delete, tint = Zk.colors.danger, size = 18.dp, enabled = !busy) { deleting = "c" to c.id }
                            }
                            HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
                        }
                    } else {
                        if (opps!!.isEmpty()) item(key = "oe") { QuietEmpty(B.emptyOpportunities, "") }
                        items(opps!!, key = { "o" + it.id }) { o -> OppRow(o, f.crm.edit, f.crm.delete, busy, onStage = { vm.stage(o, it) }, onEdit = { editingOpp = o }, onDelete = { deleting = "o" to o.id }) }
                    }
                }
            }
            if (f?.crm?.edit == true && (tab == "customers" || !customers.isNullOrEmpty())) RoundFab(Icons.Filled.Add, if (tab == "customers") B.newCustomer else B.newOpportunity, Modifier.align(Alignment.BottomEnd).padding(18.dp)) {
                if (tab == "customers") newCustomer = true else newOpp = true
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (newCustomer || editingCustomer != null) CustomerDialog(editingCustomer, busy, onClose = { newCustomer = false; editingCustomer = null }) { body ->
        vm.saveCustomer(editingCustomer?.id, body) { newCustomer = false; editingCustomer = null }
    }
    if ((newOpp || editingOpp != null) && f != null) OppDialog(editingOpp, customers.orEmpty(), f.prices, busy, onClose = { newOpp = false; editingOpp = null }) { body ->
        vm.saveOpportunity(editingOpp?.id, body) { newOpp = false; editingOpp = null }
    }
    deleting?.let { (kind, id) ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = Zk.colors.surface1,
            text = { Text(if (kind == "c") B.deleteCustomerAsk else B.deleteOpportunityAsk, fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(onClick = { deleting = null; if (kind == "c") vm.deleteCustomer(id) else vm.deleteOpportunity(id) }) { Text(B.delete, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(B.cancel) } },
        )
    }
}

@Composable
private fun stageColor(s: String) = when (s) {
    "QUALIFIED" -> Zk.colors.info
    "PROPOSAL" -> Zk.colors.warn
    "NEGOTIATION" -> Zk.colors.cat6
    "WON" -> Zk.colors.ok
    "LOST" -> Zk.colors.danger
    else -> Zk.colors.fgMuted
}

@Composable
private fun OppRow(o: Opportunity, canEdit: Boolean, canDelete: Boolean, busy: Boolean, onStage: (String) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("⁦OP-${o.number}⁩ ", fontSize = 12.sp, color = Zk.colors.fgMuted)
                Text(o.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(B.forWhom + " " + o.customer.name + (o.customer.company?.let { " — $it" } ?: ""), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
            Text(B.amount(o.value), fontSize = 13.sp, color = Zk.colors.fg)
        }
        Box {
            val c = stageColor(o.stage)
            Text(
                B.stage(o.stage), fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = c,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.14f)).clickable(enabled = canEdit && !busy) { menu = true }.padding(horizontal = 8.dp, vertical = 3.dp),
            )
            DropdownMenu(menu, { menu = false }) { B.STAGES.forEach { s -> DropdownMenuItem(text = { Text(B.stage(s)) }, onClick = { menu = false; if (s != o.stage) onStage(s) }) } }
        }
        if (canEdit) RoundIcon(Icons.Filled.Edit, B.edit, size = 18.dp, enabled = !busy, onClick = onEdit)
        if (canDelete) RoundIcon(Icons.Filled.Delete, B.delete, tint = Zk.colors.danger, size = 18.dp, enabled = !busy, onClick = onDelete)
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun CustomerDialog(c: Customer?, busy: Boolean, onClose: () -> Unit, onSave: (CustomerBody) -> Unit) {
    var name by remember(c?.id) { mutableStateOf(c?.name.orEmpty()) }
    var company by remember(c?.id) { mutableStateOf(c?.company.orEmpty()) }
    var email by remember(c?.id) { mutableStateOf(c?.email.orEmpty()) }
    var phone by remember(c?.id) { mutableStateOf(c?.phone.orEmpty()) }
    var notes by remember(c?.id) { mutableStateOf(c?.notes.orEmpty()) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(if (c == null) B.newCustomer else B.editCustomer) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(150) }, label = { Text(B.name + " *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(company, { company = it.take(150) }, label = { Text(B.company) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(email, { email = it.take(200) }, label = { Text(B.email) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(phone, { phone = it.take(50) }, label = { Text(B.phone) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(notes, { notes = it.take(2000) }, label = { Text(B.notes) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = !busy && name.trim().length >= 2, onClick = { onSave(CustomerBody(name, company, email, phone, notes)) }) { Text(B.save) } },
        dismissButton = { TextButton(onClick = onClose) { Text(B.cancel) } },
    )
}

@Composable
private fun OppDialog(o: Opportunity?, customers: List<Customer>, prices: Boolean, busy: Boolean, onClose: () -> Unit, onSave: (OpportunityBody) -> Unit) {
    var customer by remember(o?.id) { mutableStateOf(o?.customer?.id ?: customers.firstOrNull()?.id) }
    var title by remember(o?.id) { mutableStateOf(o?.title.orEmpty()) }
    var value by remember(o?.id) { mutableStateOf(o?.value?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }.orEmpty()) }
    var stage by remember(o?.id) { mutableStateOf(o?.stage ?: "LEAD") }
    var notes by remember(o?.id) { mutableStateOf(o?.notes.orEmpty()) }
    var pick by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(if (o == null) B.newOpportunity else "⁦OP-${o.number}⁩ — " + B.editOpportunity) },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(B.customer + " *", fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Box {
                    Pill(customers.firstOrNull { it.id == customer }?.let { c -> c.name + (c.company?.let { " — $it" } ?: "") } ?: o?.customer?.name ?: B.customer, customer != null) { if (o == null) pick = true }
                    DropdownMenu(pick, { pick = false }) { customers.forEach { c -> DropdownMenuItem(text = { Text(c.name + (c.company?.let { " — $it" } ?: "")) }, onClick = { customer = c.id; pick = false }) } }
                }
                OutlinedTextField(title, { title = it.take(200) }, label = { Text(B.title + " *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                // the amount: only for who may see prices (the server refuses it from anybody else)
                if (prices) OutlinedTextField(value, { v -> value = v.filter { it.isDigit() || it == '.' }.take(15) }, label = { Text(B.value) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                Text(B.stage, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { B.STAGES.forEach { s -> Pill(B.stage(s), stage == s) { stage = s } } }
                OutlinedTextField(notes, { notes = it.take(2000) }, label = { Text(B.notes) }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && customer != null && title.trim().length >= 3, onClick = {
                onSave(OpportunityBody(customer, title, if (prices) value.toDoubleOrNull() ?: 0.0 else null, stage, notes))
            }) { Text(B.save) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(B.cancel) } },
    )
}

// ── «التقارير» ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «التقارير»: for the owner the panel's reports (src/components/control-panel: the totals, eight weeks, the priorities, the workload, the
 * ideas, the spaces; the whole company or one space), for anybody else holding the reports box the person's report, as on the site.
 */
@Composable
fun ReportsScreen(onBack: () -> Unit, vm: ReportsViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val panel by vm.panel.collectAsStateWithLifecycle()
    val plain by vm.plain.collectAsStateWithLifecycle()
    var space by rememberSaveable { mutableStateOf<String?>(null) }
    WhileOnScreen(120_000, space) { vm.refresh(space) }
    val f = facts
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = B.reports, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh(space) })
                f == null -> Loading()
                f.external -> Empty(GUEST)
                !f.panel && !f.reports -> Empty(OFF)
                f.panel && panel == null || !f.panel && plain == null -> if (failure != null) Failure(failure!!, onRetry = { vm.refresh(space) }) else Loading()
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
                    val p = panel
                    if (f.panel && p != null) {
                        Text(B.ownerReportsSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill(B.allSpaces, space == null) { space = null }
                            p.spaces.forEach { s -> Pill(s.name, space == s.id) { space = s.id } }
                        }
                        Spacer(Modifier.height(10.dp))
                        Totals(p.totals.total, p.totals.open, p.totals.completed, p.totals.overdue, p.totals.created30, p.totals.completed30, p.totals.upcoming7, p.totals.avgDays, withAvg = true)
                        Title(B.series)
                        Weeks(p.series)
                        Priorities(p.byPriority, p.totals.open)
                        Workload(p.workload)
                        Ideas(p.ideas.total, p.ideas.byStatus)
                        Title(B.bySpace)
                        if (p.bySpace.isEmpty()) Text(B.emptyScope, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        p.bySpace.forEach { s ->
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                                Text(s.name, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                Text("${B.colOpen} ${s.open} · ", fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                                Text("${B.colOverdue} ${s.overdue}", fontSize = 12.5.sp, color = if (s.overdue > 0) Zk.colors.danger else Zk.colors.fgMuted)
                                Text(" · ${B.colDone30} ${s.done30}", fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                            }
                        }
                    } else plain?.let { a ->
                        Text(B.reportsSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                        Totals(a.total, a.open, a.completed, a.overdue, a.created30, a.completed30, a.upcoming7, null, withAvg = false)
                        Priorities(a.byPriority, a.open)
                        Workload(a.workload)
                        Ideas(a.ideas, a.ideasByStatus)
                        Text(B.statWorkspaces(a.workspaces) + " · " + B.statProjects(a.projects), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                    }
                    Text(B.formulaNote, fontSize = 11.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                }
            }
        }
    }
}

@Composable
private fun Totals(total: Int, open: Int, completed: Int, overdue: Int, c30: Int, d30: Int, u7: Int, avg: Double?, withAvg: Boolean) {
    StatGrid(
        listOf<@Composable (Modifier) -> Unit>(
            { m -> Stat(B.totalTasks, "$total", B.totalTasksHint, modifier = m) },
            { m -> Stat(B.openTasks, "$open", modifier = m) },
            { m -> Stat(B.completed, "$completed", B.completionRate(B.rate(completed, total)), modifier = m) },
            { m -> Stat(B.overdue, "$overdue", if (overdue > 0) B.overdueNote else B.allGood, if (overdue > 0) Zk.colors.danger else Zk.colors.ok, m) },
            { m -> Stat(B.created30, "$c30", modifier = m) },
            { m -> Stat(B.completed30, "$d30", modifier = m) },
            { m -> Stat(B.upcoming7, "$u7", modifier = m) },
        ) + (if (withAvg) listOf<@Composable (Modifier) -> Unit>({ m -> Stat(B.avgDays, B.avgDaysValue(avg), modifier = m) }) else emptyList()),
    )
}

@Composable
private fun Weeks(series: List<WeekPoint>) {
    val max = maxOf(1, series.maxOfOrNull { maxOf(it.created, it.completed) } ?: 0)
    Row(Modifier.fillMaxWidth().height(120.dp).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
        series.forEach { w ->
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Box(Modifier.width(9.dp).fillMaxHeight(maxOf(0.02f, w.created.toFloat() / max)).clip(RoundedCornerShape(2.dp)).background(Zk.colors.info))
                Box(Modifier.width(9.dp).fillMaxHeight(maxOf(0.02f, w.completed.toFloat() / max)).clip(RoundedCornerShape(2.dp)).background(Zk.colors.ok))
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Text("■ " + B.createdLabel + "   ", fontSize = 12.sp, color = Zk.colors.info)
        Text("■ " + B.doneLabel, fontSize = 12.sp, color = Zk.colors.ok)
        Spacer(Modifier.weight(1f))
        series.firstOrNull()?.let { Text(B.weekAgo(it.ago) + " ← " + B.weekNow, fontSize = 11.5.sp, color = Zk.colors.fgMuted) }
    }
}

@Composable
private fun Priorities(rows: List<PriorityN>, open: Int) {
    Title(B.openByPriority)
    if (open == 0) { Text(B.noOpen, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp)); return }
    val by = rows.associate { it.priority to it.n }
    val max = B.PRIORITIES.maxOf { by[it] ?: 0 }
    B.PRIORITIES.forEach { p -> Bar(B.priority(p), by[p] ?: 0, max, if (p == "URGENT") Zk.colors.danger else if (p == "HIGH") Zk.colors.warn else Zk.colors.accent) }
}

@Composable
private fun Workload(rows: List<PersonN>) {
    Title(B.workload)
    if (rows.isEmpty()) { Text(B.noWorkload, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp)); return }
    val max = rows.maxOf { it.n }
    rows.forEach { Bar(it.name, it.n, max, Zk.colors.info) }
}

@Composable
private fun Ideas(total: Int, rows: List<StatusN>) {
    Title(B.ideasFunnel, B.ideasTotal(total))
    if (total == 0) { Text(B.noIdeas, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp)); return }
    val by = rows.associate { it.status to it.n }
    val max = B.IDEA_STATUSES.maxOf { by[it] ?: 0 }
    B.IDEA_STATUSES.forEach { s -> Bar(B.ideaStatus(s), by[s] ?: 0, max, Zk.colors.cat3) }
}

// ── «لوحة المالك / لوحة التحكم» ──────────────────────────────────────────────────────────────────────────────

/**
 * The owner's panel and the board (src/components/control-panel, src/components/owner-board): «نظرة عامة» — the panel's numbers of today
 * and the sentences worth his eye, each with how it was counted (the owner), who did something today; «الناس» — each person of the
 * board over a range, sorted as asked. A person's own board («لوحتي») opens their page. The other sections of the panel are the site's.
 */
@Composable
fun BoardScreen(meId: String?, onBack: () -> Unit, onOpenPerson: (String) -> Unit, onOpenPath: (String) -> Unit, onOpenSite: (String) -> Unit, vm: BoardViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val home by vm.home.collectAsStateWithLifecycle()
    val overview by vm.overview.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("overview") }
    var range by rememberSaveable { mutableStateOf("14") }
    var sort by rememberSaveable { mutableStateOf("completed") }
    var sortOpen by remember { mutableStateOf(false) }
    var how by remember { mutableStateOf<Insight?>(null) }
    WhileOnScreen(60_000, range, sort) { vm.refresh(range, sort) }
    val f = facts
    // a person's own board is their own page
    LaunchedEffect(f?.board) { if (f?.board == "self" && !f.panel && meId != null) onOpenPerson(meId) }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = B.boardTitle(f?.board, f?.panel == true), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                f == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh(range, sort) })
                f == null -> Loading()
                f.board == null && !f.panel -> Empty(OFF)
                f.board == "self" && !f.panel -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                    item(key = "tabs") {
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pill(B.overview, tab == "overview") { tab = "overview" }
                            Pill(B.people, tab == "people") { tab = "people" }
                        }
                    }
                    if (tab == "overview") {
                        val h = home
                        if (f.panel && h != null) {
                            item(key = "kpis") {
                                Title(B.kpiTitle)
                                val k = h.kpis
                                StatGrid(
                                    listOf(
                                        { m -> Stat(B.doneToday, "${k.doneToday}", B.weekLine(k.completedWeek) + " · " + B.weekChange(k.completedChange), modifier = m) },
                                        { m -> Stat(B.overdueCompany, "${k.overdue}", tone = if (k.overdue > 0) Zk.colors.danger else Zk.colors.ok, modifier = m) },
                                        { m -> Stat(B.onTime, k.onTimeRate?.let { "${Math.round(it)}%" } ?: B.none, k.onTimePrev?.let(B::onTimePrev), modifier = m) },
                                        { m -> Stat(B.activeToday, B.activeValue(k.activeToday, k.staff), modifier = m) },
                                    ),
                                )
                                Title(B.insightsTitle, B.insightsHint)
                            }
                            items(h.insights, key = { "i" + it.id }) { i ->
                                val c = when (i.tone) { "warn" -> Zk.colors.warn; "good" -> Zk.colors.ok; else -> Zk.colors.info }
                                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                                    Box(Modifier.padding(top = 6.dp).size(8.dp).clip(RoundedCornerShape(4.dp)).background(c))
                                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                        Text(i.sentence, fontSize = 14.sp, color = Zk.colors.fg)
                                        Row {
                                            Text(B.how, fontSize = 12.sp, color = Zk.colors.accent, modifier = Modifier.clickable { how = i }.padding(end = 12.dp, top = 2.dp))
                                            i.href?.let { href -> Text(B.open, fontSize = 12.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenPath(href) }.padding(top = 2.dp)) }
                                        }
                                    }
                                }
                            }
                        }
                        val today = h?.todayStrip ?: overview?.today
                        today?.let { t -> item(key = "today") { Today(t, h?.timeZone ?: overview?.window?.timeZone.orEmpty(), onOpenPerson) } }
                        overview?.cards?.let { cards ->
                            item(key = "cards") {
                                Title(B.cardsTitle)
                                StatGrid(
                                    listOf(
                                        { m -> Stat(B.card("completed"), "${cards.completed}", modifier = m) },
                                        { m -> Stat(B.card("open"), "${cards.open}", modifier = m) },
                                        { m -> Stat(B.card("overdue"), "${cards.overdue}", tone = if (cards.overdue > 0) Zk.colors.danger else null, modifier = m) },
                                        { m -> Stat(B.card("late"), "${cards.late}", modifier = m) },
                                        { m -> Stat(B.card("avgDays"), B.avgDaysValue(cards.avgDays), modifier = m) },
                                        { m -> Stat(B.card("messages"), "${cards.messages}", modifier = m) },
                                        { m -> Stat(B.card("active"), "${cards.activePeople}", modifier = m) },
                                        { m -> Stat(B.card("idle"), "${cards.idlePeople}", modifier = m) },
                                    ),
                                )
                            }
                        }
                        item(key = "rest") {
                            Spacer(Modifier.height(12.dp))
                            Column(Modifier.padding(horizontal = 0.dp)) { SiteLine(B.restWarn, B.restFix) { onOpenSite("/owner") } }
                        }
                    } else {
                        val o = overview
                        item(key = "filters") {
                            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                B.RANGES.forEach { r -> Pill(B.rangeLabel(r), range == r) { range = r } }
                                Box {
                                    Pill(B.column(sort), true) { sortOpen = true }
                                    DropdownMenu(sortOpen, { sortOpen = false }) { B.SORTS.forEach { s -> DropdownMenuItem(text = { Text(B.column(s)) }, onClick = { sort = s; sortOpen = false }) } }
                                }
                            }
                            o?.window?.let { w -> Text(B.window(w.from, w.to, w.days.size), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
                            Text(B.definition, fontSize = 11.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                            if (o == null) Loading(Modifier.fillMaxWidth().height(80.dp)) else if (o.people.isEmpty()) QuietEmpty(B.peopleEmpty, "")
                        }
                        items(o?.people.orEmpty(), key = { "p" + it.userId }) { p -> PersonLine(p, o?.window?.timeZone.orEmpty()) { onOpenPerson(p.userId) } }
                        item(key = "csv") { SiteLine(B.csvWarn, B.csvFix) { onOpenSite("/owner?v=people") } }
                    }
                }
            }
        }
    }
    how?.let { i ->
        AlertDialog(
            onDismissRequest = { how = null },
            containerColor = Zk.colors.surface1,
            title = { Text(B.how) },
            text = { Text(i.formula, fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(onClick = { how = null }) { Text(B.cancel) } },
        )
    }
}

@Composable
private fun Today(t: TodayStrip, zone: String, onOpenPerson: (String) -> Unit) {
    Title(B.todayTitle, B.todayFormula)
    Text(B.todayDone, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp))
    if (t.done.isEmpty()) Text(B.noneDone, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
    t.done.forEach { r ->
        Text(
            r.name + " · " + B.todayLine(r.tasks, r.steps, r.messages) + (r.last?.let { " · " + B.clock(it, zone) } ?: ""),
            fontSize = 13.sp, color = Zk.colors.fg,
            modifier = Modifier.fillMaxWidth().clickable { onOpenPerson(r.userId) }.padding(horizontal = 16.dp, vertical = 4.dp),
        )
    }
    Text(B.todayIdle, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
    if (t.idle.isEmpty()) Text(B.noneIdle, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
    else Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        t.idle.forEach { p -> Pill(p.name, false) { onOpenPerson(p.userId) } }
    }
}

@Composable
private fun PersonLine(p: PersonRow, zone: String, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                if (p.online) Text("  ● " + B.online, fontSize = 11.sp, color = Zk.colors.ok)
                if (p.status != "ACTIVE") Text("  " + B.inactive, fontSize = 11.sp, color = Zk.colors.danger)
            }
            Text(
                "${B.role(p.role)} · ${B.column("completed")} ${p.completed} · ${B.colOpen} ${p.openTasks} · ${B.colOverdue} ${p.overdue}",
                fontSize = 12.sp, color = Zk.colors.fgMuted,
            )
            Text(
                "${B.column("onTime")} ${p.onTimeRate?.let { "${Math.round(it)}%" } ?: B.none} · ${B.column("steps")} ${p.steps} · ${B.column("messages")} ${p.messages}",
                fontSize = 12.sp, color = Zk.colors.fgMuted,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Spark(p.spark)
            Text(B.clock(p.lastActivity, zone), fontSize = 11.sp, color = Zk.colors.fgMuted)
        }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
}

/** One person's page of the board (`/owner/people/[id]`): the summary, the trend, day by day, their open tasks, their spaces. */
@Composable
fun BoardPersonScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, vm: BoardPersonViewModel = hiltViewModel()) {
    val failure by vm.failure.collectAsStateWithLifecycle()
    val view by vm.view.collectAsStateWithLifecycle()
    var range by rememberSaveable { mutableStateOf("14") }
    WhileOnScreen(60_000, range) { vm.refresh(range) }
    val v = view
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = v?.let { B.personTitle(it.person.name) } ?: B.people, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                v == null && failure != null -> Failure(failure!!, onRetry = { vm.refresh(range) })
                v == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
                    item(key = "head") {
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            B.RANGES.forEach { r -> Pill(B.rangeLabel(r), range == r) { range = r } }
                        }
                        Text(B.window(v.window.from, v.window.to, v.window.days.size), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        val p = v.person
                        Title(B.summary)
                        StatGrid(
                            listOf(
                                { m -> Stat(B.card("completed"), "${p.completed}", modifier = m) },
                                { m -> Stat(B.card("open"), "${p.openTasks}", modifier = m) },
                                { m -> Stat(B.card("overdue"), "${p.overdue}", tone = if (p.overdue > 0) Zk.colors.danger else null, modifier = m) },
                                { m -> Stat(B.column("onTime"), p.onTimeRate?.let { "${Math.round(it)}%" } ?: B.none, modifier = m) },
                                { m -> Stat(B.card("avgDays"), B.avgDaysValue(p.avgDays), modifier = m) },
                                { m -> Stat(B.column("steps"), "${p.steps}", modifier = m) },
                                { m -> Stat(B.card("messages"), "${p.messages}", modifier = m) },
                            ),
                        )
                        Title(B.trend)
                        Box(Modifier.padding(horizontal = 16.dp)) { Spark(p.spark, height = 60) }
                        Title(B.daysTitle)
                    }
                    items(v.days.sortedByDescending { it.day }, key = { "d" + it.day }) { d ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                            Text(io.zakiai.workspace.feature.desks.Q.longDay(d.day.take(10)), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                            if (d.tasks.isEmpty()) Text(B.noTasks, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                            d.tasks.forEach { t -> Text(t.title, fontSize = 13.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenTask(t.id) }.padding(vertical = 2.dp)) }
                            Text("${B.column("steps")} ${d.steps} · ${B.column("messages")} ${d.messages} · ${B.clock(d.first, v.window.timeZone)} ← ${B.clock(d.last, v.window.timeZone)}", fontSize = 12.sp, color = Zk.colors.fgMuted)
                        }
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    item(key = "open") {
                        Title(B.openTitle)
                        if (v.open.isEmpty()) Text(B.openNone, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        v.open.forEach { t ->
                            Column(Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                Text(t.title, fontSize = 14.sp, color = Zk.colors.fg)
                                Text(
                                    listOfNotNull(t.space, if (t.overdue) B.overdueTag else null, t.dueDate?.let { B.due(io.zakiai.workspace.feature.desks.Q.shortDay(it)) } ?: B.noDue).joinToString(" · "),
                                    fontSize = 12.sp, color = if (t.overdue) Zk.colors.danger else Zk.colors.fgMuted,
                                )
                            }
                        }
                        if (v.openTotal > v.open.size) Text(B.openMore(v.open.size, v.openTotal), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        Title(B.spacesTitle)
                        if (v.spaces.isEmpty()) Text(B.spacesNone, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        else Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { v.spaces.forEach { s -> Pill(s.name, false) {} } }
                    }
                }
            }
        }
    }
}

/** The admin rows of «الإدارة»: the board (or the panel), the reports, the customers — each only for who may open it. */
@Composable
fun AdminRows(onOpen: (String) -> Unit, vm: ReportsViewModel = hiltViewModel()) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.refresh(null) }
    val f = facts ?: return
    @Composable
    fun Row1(label: String, key: String) {
        Row(Modifier.fillMaxWidth().clickable { onOpen(key) }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontSize = 15.5.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
            Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
        }
    }
    val any = f.board != null || f.panel || f.reports || (!f.external && f.crm.view) || f.development || f.spaces || f.accounts
    if (any) io.zakiai.workspace.ui.components.SectionLabel(B.adminTitle)
    if (f.board != null || f.panel) Row1(B.boardTitle(f.board, f.panel), "board")
    if (f.panel || f.reports) Row1(B.reports, "reports")
    if (!f.external && f.crm.view) Row1(B.crm, "crm")
    if (f.development) Row1(io.zakiai.workspace.feature.dev.w("teamdev.title"), "development")
    if (f.development) Row1(io.zakiai.workspace.feature.dev.w("teamdev.structure.title"), "structure")
    if (f.spaces) Row1(io.zakiai.workspace.feature.spaces.w("spaces.overview.title"), "spaces")
    if (f.accounts) Row1(io.zakiai.workspace.feature.accounts.w("orgm.title"), "accounts")
}
