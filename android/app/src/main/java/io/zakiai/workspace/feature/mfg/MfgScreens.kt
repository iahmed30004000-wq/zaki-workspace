package io.zakiai.workspace.feature.mfg

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.feature.desk.OpenerViewModel
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

@Composable
internal fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
internal fun Title(text: String, hint: String? = null) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp)) {
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
        hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
    }
}

@Composable
internal fun Line(text: String, color: Color = Zk.colors.fgMuted, size: Float = 12.5f) = Text(text, fontSize = size.sp, color = color, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))

@Composable
internal fun Mark(warn: String, fix: String) = Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
    // the risk is ⚠️ and its fix 🔧, always (some of the ledger's sentences carry them, some leave them to the screen)
    WarnFix(if (warn.startsWith("⚠️")) warn else "⚠️ $warn", if (fix.startsWith("🔧")) fix else "🔧 $fix")
}

/** «⚠️ هاد السجل ... مش محاسبة» with its 🔧, on every page of the ledger (the site's `NotAccountingNote`) */
@Composable
internal fun NotAccounting() = Mark(w("mfg.not_accounting"), w("mfg.not_accounting_fix"))

/** the ledger's four parts, the site's own sub-tabs */
@Composable
fun MfgTabs(here: String, onOpen: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("materials", "orders", "recipes", "reports").forEach { k -> Pill(MfgWords.all["mfg.sub.$k"] ?: k, here == k) { if (here != k) onOpen(k) } }
    }
}

@Composable
private fun CountCard(c: CountItem, busy: Boolean, onDecide: (Boolean, String) -> Unit) {
    var note by rememberSaveable(c.id) { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(c.materialName + " · " + (MfgWords.all["mfg.count_status.${c.status}"] ?: c.status), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
        Text(w("mfg.count_line", "by" to c.countedBy), fontSize = 12.sp, color = Zk.colors.fgMuted)
        Text(
            "${w("mfg.counted")} ${Q8.qtyUnit(c.countedMicro, c.baseUnit)} · ${w("mfg.expected")} ${Q8.qtyUnit(c.expectedMicro, c.baseUnit)} · ${w("mfg.diff")} ${Q8.qtyUnit(c.diffMicro, c.baseUnit)}",
            fontSize = 12.5.sp, color = if (c.diffMicro < 0) Zk.colors.danger else if (c.diffMicro > 0) Zk.colors.ok else Zk.colors.fg,
        )
        c.note?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
        c.decidedBy?.let { Text(w("mfg.decided_by", "who" to it) + (c.decisionNote?.let { n -> " · $n" } ?: ""), fontSize = 12.sp, color = Zk.colors.fgMuted) }
        if (c.status == "PENDING") {
            if (c.canDecide) {
                OutlinedTextField(note, { note = it.take(300) }, label = { Text(w("mfg.decision_note")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row {
                    TextButton(enabled = !busy, onClick = { onDecide(true, note) }) { Text(w("mfg.approve"), color = Zk.colors.ok, fontWeight = FontWeight.Bold) }
                    TextButton(enabled = !busy, onClick = { onDecide(false, note) }) { Text(w("mfg.reject"), color = Zk.colors.danger) }
                }
            } else Text(w("mfg.needs_second"), fontSize = 12.sp, color = Zk.colors.warn)
        }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
}

// ── «المواد» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «مخزون التصنيع» → «المواد» (src/components/manufacturing/mfg-view.tsx): the materials of the manufacturing space with their balance
 * (and their value for who holds the cost key), the low-stock ⚠️/🔧, the stocktakes waiting for a SECOND person, the suppliers.
 */
@Composable
fun MfgHomeScreen(spaceId: String?, onBack: () -> Unit, onOpenMaterial: (String) -> Unit, onTab: (String) -> Unit, vm: MfgHomeViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var archived by rememberSaveable { mutableStateOf(false) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var addingSupplier by rememberSaveable { mutableStateOf(false) }
    if (spaceId != null) WhileOnScreen(60_000, spaceId) { vm.refresh(spaceId) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val d = data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = w("mfg.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                spaceId == null -> Empty(w("mfg.not_mfg_space") + "\n" + w("mfg.not_mfg_space_hint"))
                d == null && failure != null -> if (failure!!.status == 404) Empty(w("mfg.not_found")) else Failure(failure!!.message, onRetry = { vm.refresh(spaceId) })
                d == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                    item(key = "head") {
                        MfgTabs("materials", onTab)
                        Line(w("mfg.subtitle", "space" to d.spaceName))
                        if (!d.canEdit) Line(w("mfg.read_only"))
                        if (!d.canCost) Line(w("mfg.no_cost_note"))
                        NotAccounting()
                        val low = d.materials.count { it.low && !it.archived }
                        if (low > 0) Mark(w("mfg.low_banner", "n" to low), "🔧 " + w("mfg.low_fix"))
                        Title(w("mfg.materials"))
                        if (d.materials.any { it.archived }) Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(archived, { archived = it }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                            Text(w("mfg.show_archived"), fontSize = 13.sp, color = Zk.colors.fg)
                        }
                        if (d.materials.isEmpty()) QuietEmpty(w("mfg.empty"), if (d.canEdit) w("mfg.empty_hint") else w("mfg.empty_hint_view"))
                    }
                    items(d.materials.filter { archived || !it.archived }, key = { "m" + it.id }) { m ->
                        Column(Modifier.fillMaxWidth().clickable { onOpenMaterial(m.id) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(m.name + (m.code?.let { " · ⁦$it⁩" } ?: ""), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                Text(Q8.qtyUnit(m.balanceMicro, m.baseUnit), fontSize = 14.sp, color = if (m.low) Zk.colors.warn else Zk.colors.fg)
                            }
                            val badges = listOfNotNull(
                                if (m.archived) w("mfg.archived") else null,
                                if (m.pendingCount) w("mfg.count_waiting") else null,
                                if (m.unpricedMicro > 0) w("mfg.unpriced_badge") else null,
                                if (m.low) w("mfg.low") + " · " + w("mfg.low_fix_short") else null,
                            )
                            if (badges.isNotEmpty()) Text(badges.joinToString(" · "), fontSize = 12.sp, color = Zk.colors.warn)
                            // the value: only when the server sent it (a holder of «الكلفة والأسعار»)
                            m.cost?.currency?.let { cur -> Text(w("mfg.value") + " " + Q8.moneyText(m.cost.valueMinor, cur), fontSize = 12.5.sp, color = Zk.colors.fgMuted) }
                        }
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    item(key = "pending") {
                        Title(w("mfg.pending_title"), if (d.pending.isEmpty()) null else w("mfg.pending_hint"))
                        if (d.pending.isEmpty()) Line(w("mfg.pending_none"))
                    }
                    items(d.pending, key = { "c" + it.id }) { c -> CountCard(c, busy) { ok, note -> vm.decide(c, ok, note) } }
                    item(key = "suppliers") {
                        Title(w("mfg.suppliers"), w("mfg.suppliers_hint"))
                        if (d.suppliers.isEmpty()) Line(w("mfg.suppliers_none"))
                        d.suppliers.forEach { sp ->
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(sp.name + if (sp.archived) " · " + w("mfg.archived") else "", fontSize = 14.sp, color = Zk.colors.fg)
                                    sp.note?.let { Text("⁨$it⁩", fontSize = 12.sp, color = Zk.colors.fgMuted) }
                                }
                                if (d.canEdit) TextButton(enabled = !busy, onClick = { vm.archiveSupplier(sp) }) { Text(w(if (sp.archived) "mfg.restore" else "mfg.archive"), color = Zk.colors.accent) }
                            }
                        }
                        if (d.canEdit) TextButton(onClick = { addingSupplier = true }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("+ " + w("mfg.supplier_add"), color = Zk.colors.accent) }
                        Mark(Q8.csvWarn, Q8.csvFix)
                    }
                }
            }
            if (d?.canEdit == true) RoundFab(Icons.Filled.Add, w("mfg.material_new"), Modifier.align(Alignment.BottomEnd).padding(18.dp)) { creating = true }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (creating) NewMaterialDialog(busy, onClose = { creating = false }) { name, code, unit, low -> vm.newMaterial(name, code, unit, low) { creating = false } }
    if (addingSupplier) TwoFieldDialog(
        w("mfg.supplier_add"), w("mfg.f.supplier_name"), w("mfg.f.supplier_note"), w("mfg.f.supplier_note_ph"), busy,
        onClose = { addingSupplier = false },
    ) { a, b -> vm.newSupplier(a, b) { addingSupplier = false } }
}

@Composable
private fun NewMaterialDialog(busy: Boolean, onClose: () -> Unit, onSave: (String, String, String, String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var unit by rememberSaveable { mutableStateOf("") }
    var low by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w("mfg.material_new")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(120) }, label = { Text(w("mfg.f.name")) }, placeholder = { Text(w("mfg.f.name_ph")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(code, { code = it.take(40) }, label = { Text(w("mfg.f.code")) }, placeholder = { Text(w("mfg.f.code_ph")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(unit, { unit = it.take(40) }, label = { Text(w("mfg.f.base_unit")) }, placeholder = { Text(w("mfg.f.base_unit_ph")) }, supportingText = { Text(w("mfg.f.base_unit_hint")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(low, { low = it.take(24) }, label = { Text(w("mfg.f.low_stock")) }, placeholder = { Text(w("mfg.f.low_stock_ph")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = !busy && name.isNotBlank() && unit.isNotBlank(), onClick = { onSave(name, code, unit, low) }) { Text(w("mfg.material_create")) } },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

@Composable
internal fun TwoFieldDialog(title: String, first: String, second: String, secondPh: String, busy: Boolean, onClose: () -> Unit, onSave: (String, String) -> Unit) {
    var a by rememberSaveable { mutableStateOf("") }
    var b by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(a, { a = it.take(120) }, label = { Text(first) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(b, { b = it.take(300) }, label = { Text(second) }, placeholder = { Text(secondPh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = !busy && a.isNotBlank(), onClick = { onSave(a, b) }) { Text(title) } },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

// ── one material ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One material (src/components/manufacturing/material-page.tsx): the balance (the sum of its movements), the average for a cost holder,
 * receiving (priced, or «بدون سعر» for who has no cost key), issuing, counting (a second person decides), adjusting, the units, the lots
 * with their price filled once or corrected with a reason, the movements reversed by a new one — never edited, never deleted.
 */
@Composable
fun MaterialScreen(onBack: () -> Unit, vm: MaterialViewModel = hiltViewModel(), files: OpenerViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var form by rememberSaveable { mutableStateOf<String?>(null) }
    var lotFor by remember { mutableStateOf<Pair<String, Lot>?>(null) }
    var reversing by remember { mutableStateOf<Movement?>(null) }
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val m = data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = m?.name ?: w("mfg.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, w("mfg.back"), onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                m == null && failure != null -> if (failure!!.status == 404) Empty(w("mfg.not_found")) else Failure(failure!!.message, onRetry = { vm.refresh() })
                m == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 60.dp)) {
                    item(key = "head") {
                        Line(listOfNotNull(m.code?.let { "⁦$it⁩" }, w("mfg.base_unit_is", "unit" to m.baseUnit), if (m.archived) w("mfg.archived") else null).joinToString(" · "))
                        NotAccounting()
                        Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(14.dp)) {
                            Text(w("mfg.balance"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                            Text(Q8.qtyUnit(m.balanceMicro, m.baseUnit), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                            val others = m.units.filter { !it.archived }.joinToString(" · ") { "⁦${Q8.inUnit(m.balanceMicro, it.num, it.den)}⁩ ${it.label}" }
                            if (others.isNotEmpty()) Text(others, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                            Text(w("mfg.balance_formula"), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                        }
                        if (m.low) Mark(w("mfg.low_material", "qty" to Q8.qty(m.lowStockMicro ?: 0), "unit" to m.baseUnit), "🔧 " + w("mfg.low_fix"))
                        if (m.counts.any { it.status == "PENDING" }) Line(w("mfg.pending_material"), Zk.colors.warn)
                        if (m.unpricedMicro > 0) Mark(w("mfg.unpriced_stock", "qty" to Q8.qty(m.unpricedMicro), "unit" to m.baseUnit), "🔧 " + w(if (m.canCost) "mfg.unpriced_stock_fix_cost" else "mfg.unpriced_stock_fix"))
                        if (m.canCost) {
                            val c = m.cost
                            Title(w("mfg.average_title", "unit" to m.baseUnit))
                            if (c?.formula == null) Line(w("mfg.average_none"))
                            else {
                                Line((c.averageText ?: "—") + (c.currency?.let { " " + (MfgWords.all["mfg.cur.$it"] ?: it) } ?: ""), Zk.colors.fg, 15f)
                                Line(w("mfg.formula") + "  ⁦${c.formula.value} ÷ ${c.formula.qty} = ${c.formula.average}⁩")
                                Line(w("mfg.formula_explain"))
                                c.currency?.let { Line(w("mfg.value") + " " + Q8.moneyText(c.valueMinor, it), Zk.colors.fg) }
                            }
                            if (m.unpricedMicro > 0) Line(w("mfg.average_excludes", "qty" to Q8.qty(m.unpricedMicro), "unit" to m.baseUnit), Zk.colors.warn)
                        } else Line(w("mfg.no_cost_note"))
                        if (m.canEdit && !m.archived) {
                            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Pill(w(if (m.canCost) "mfg.receive" else "mfg.receive_unpriced"), false) { form = "receive" }
                                Pill(w("mfg.issue"), false) { form = "issue" }
                                Pill(w("mfg.count"), false) { form = "count" }
                                Pill(w("mfg.adjust"), false) { form = "adjust" }
                                Pill(Q8.edit, false) { form = "edit" }
                            }
                            if (!m.canCost) Line(w("mfg.receive_needs_cost"))
                        } else if (m.canEdit) Row(Modifier.padding(horizontal = 12.dp)) { Pill(Q8.edit, false) { form = "edit" } }
                        Title(w("mfg.units"))
                        val live = m.units.filter { !it.archived }
                        if (live.isEmpty()) Line(w("mfg.units_none", "unit" to m.baseUnit))
                        live.forEach { u ->
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("1 ${u.label} = ⁦${u.num}${if (u.den != 1L) "/" + u.den else ""}⁩ ${m.baseUnit}", fontSize = 13.5.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                if (m.canEdit) TextButton(enabled = !busy, onClick = { vm.archiveUnit(u.id) }) { Text(w("mfg.archive"), color = Zk.colors.accent) }
                            }
                        }
                        if (m.canEdit && !m.archived) TextButton(onClick = { form = "unit" }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("+ " + w("mfg.unit_add"), color = Zk.colors.accent) }
                        if (m.counts.isNotEmpty()) Title(w("mfg.counts"))
                    }
                    items(m.counts, key = { "c" + it.id }) { c -> CountCard(c, busy) { ok, note -> vm.decide(c, ok, note) } }
                    item(key = "lots") { Title(w("mfg.lots")); if (m.lots.isEmpty()) Line(w("mfg.lots_none")) }
                    items(m.lots, key = { "l" + it.id }) { lot ->
                        LotRow(lot, m.baseUnit, busy, onFill = { lotFor = "fill" to lot }, onCorrect = { lotFor = "correct" to lot }) { p ->
                            files.opener.open(Attachment(id = "lot-" + p.id, kind = if (p.mimeType.startsWith("image/")) "IMAGE" else "FILE", name = p.name, mime = p.mimeType, url = p.url)) { vm.say(it) }
                        }
                    }
                    item(key = "moves") { Title(w("mfg.movements"), w("mfg.movements_hint")); if (m.movements.isEmpty()) Line(w("mfg.movements_none")) }
                    items(m.movements, key = { "v" + it.id }) { mv ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(MfgWords.all["mfg.kind.${mv.kind}"] ?: mv.kind, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent, modifier = Modifier.padding(end = 8.dp))
                                Text((if (mv.qtyMicro < 0) "−" else "+") + Q8.qtyUnit(kotlin.math.abs(mv.qtyMicro), m.baseUnit), fontSize = 14.sp, color = if (mv.qtyMicro < 0) Zk.colors.danger else Zk.colors.ok, modifier = Modifier.weight(1f))
                                if (mv.canReverse) TextButton(enabled = !busy, onClick = { reversing = mv }) { Text(w("mfg.reverse"), color = Zk.colors.accent, fontSize = 12.5.sp) }
                            }
                            val extra = listOfNotNull(
                                mv.valueMinor?.let { v -> m.cost?.currency?.let { Q8.moneyText(kotlin.math.abs(v), it) } },
                                if (mv.reversedById != null) w("mfg.reversed") else null,
                                if (mv.reversesId != null) w("mfg.is_reversal") else null,
                                mv.createdBy, Q8.dmy(mv.createdAt),
                            )
                            Text(extra.joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted)
                            mv.reason?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fg) }
                        }
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    item(key = "csv") { Mark(Q8.csvWarn, Q8.csvFix) }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    val md = m ?: return
    when (form) {
        "receive" -> ReceiveDialog(md, vm, busy) { form = null }
        "issue" -> MoveDialog(md, w("mfg.issue"), w("mfg.f.issue_qty"), w("mfg.f.reason"), w("mfg.f.issue_reason_ph"), null, null, w("mfg.issue_save"), busy, { form = null }) { u, q, r -> vm.issue(u, q, r) { form = null } }
        "adjust" -> MoveDialog(md, w("mfg.adjust"), w("mfg.f.adjust_qty"), w("mfg.f.reason"), w("mfg.f.adjust_reason_ph"), w("mfg.adjust_hint"), w("mfg.adjust_warn"), w("mfg.adjust_save"), busy, { form = null }) { u, q, r -> vm.adjust(u, q, r) { form = null } }
        "count" -> MoveDialog(md, w("mfg.count"), w("mfg.f.counted_qty"), w("mfg.f.count_note"), w("mfg.f.count_note_ph"), w("mfg.count_hint"), null, w("mfg.count_save"), busy, { form = null }, optional = true) { u, q, r -> vm.count(u, q, r) { form = null } }
        "edit" -> EditDialog(md, vm, busy) { form = null }
        "unit" -> UnitDialog(md.baseUnit, busy, { form = null }) { l, n, d -> vm.addUnit(l, n, d) { form = null } }
    }
    lotFor?.let { (kind, lot) -> PriceDialog(kind, lot, md, busy, { lotFor = null }) { cost, cur, reason -> if (kind == "fill") vm.fillCost(lot, cost, cur) { lotFor = null } else vm.correct(lot, cost, cur, reason) { lotFor = null } } }
    reversing?.let { mv ->
        var reason by remember(mv.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { reversing = null },
            containerColor = Zk.colors.surface1,
            title = { Text(w("mfg.reverse")) },
            text = { OutlinedTextField(reason, { reason = it.take(300) }, label = { Text(w("mfg.reverse_reason")) }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(enabled = !busy && reason.trim().length >= 2, onClick = { vm.reverse(mv, reason) { reversing = null } }) { Text(w("mfg.reverse_confirm"), color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { reversing = null }) { Text(Q8.cancel) } },
        )
    }
}

@Composable
private fun LotRow(lot: Lot, baseUnit: String, busy: Boolean, onFill: () -> Unit, onCorrect: () -> Unit, onProof: (Proof) -> Unit) {
    var history by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(
            listOfNotNull(Q8.dmy(lot.receivedOn), Q8.qtyUnit(lot.enteredQtyMicro, lot.enteredUnitLabel) + if (lot.enteredUnitLabel != baseUnit) " (= ${Q8.qtyUnit(lot.qtyMicro, baseUnit)})" else "", lot.supplier?.name, lot.expiresOn?.let { w("mfg.expires", "date" to Q8.dmy(it)) }, if (lot.reversed) w("mfg.reversed") else null).joinToString(" · "),
            fontSize = 13.5.sp, color = Zk.colors.fg,
        )
        if (lot.costPending) {
            WarnFix(w("mfg.lot_unpriced"), "🔧 " + w(if (lot.canFillCost) "mfg.lot_unpriced_fix_cost" else "mfg.lot_unpriced_fix"))
            if (lot.canFillCost) TextButton(enabled = !busy, onClick = onFill) { Text(w("mfg.cost_fill"), color = Zk.colors.accent) }
        }
        lot.costedLater?.let { Text(w("mfg.costed_by", "who" to it.by, "when" to Q8.dmy(it.at)), fontSize = 12.sp, color = Zk.colors.fgMuted) }
        if (lot.correctionCount > 0) Text(w("mfg.price_corrections_count", "n" to lot.correctionCount), fontSize = 12.sp, color = Zk.colors.warn)
        lot.cost?.let { c -> Text(w("mfg.lot_price", "unit" to lot.enteredUnitLabel) + " " + Q8.moneyText(c.unitCostMinor, c.currency) + " · " + w("mfg.lot_total") + " " + Q8.moneyText(c.totalCostMinor, c.currency), fontSize = 12.5.sp, color = Zk.colors.fg) }
        if (lot.canCorrectPrice && lot.cost != null) TextButton(enabled = !busy, onClick = onCorrect) { Text(w("mfg.price_correct"), color = Zk.colors.accent) }
        if (lot.priceHistory.size > 1) {
            Text(w("mfg.price_history"), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { history = !history }.padding(vertical = 2.dp))
            if (history) lot.priceHistory.forEach { p ->
                Text(
                    listOfNotNull(if (p.seq == 0) w("mfg.price_first") else w("mfg.price_correction_n", "n" to p.seq), if (p.current) w("mfg.price_current") else null, Q8.moneyText(p.unitCostMinor, p.currency), p.reason?.let { w("mfg.price_reason") + " " + it }, w("mfg.by", "who" to p.by)).joinToString(" · "),
                    fontSize = 12.sp, color = Zk.colors.fgMuted,
                )
            }
        }
        lot.note?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fg) }
        lot.proof?.let { p -> Text(w("mfg.proof_open"), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onProof(p) }.padding(vertical = 2.dp)) }
            ?: lot.proofNote?.let { WarnFix(w("mfg.no_proof") + " " + it, "🔧 " + w("mfg.no_proof_fix")) }
        Text(w("mfg.by", "who" to lot.createdBy) + " · " + Q8.dmy(lot.createdAt), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = 16.dp))
}

/** the unit picker of a form: the base unit first, then the live conversions */
@Composable
private fun UnitPick(m: MaterialDetail, unitId: String?, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Pill(w("mfg.f.unit") + ": " + (m.units.firstOrNull { it.id == unitId }?.label ?: m.baseUnit), true) { open = true }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text(m.baseUnit) }, onClick = { onPick(null); open = false })
            m.units.filter { !it.archived }.forEach { u -> DropdownMenuItem(text = { Text(u.label) }, onClick = { onPick(u.id); open = false }) }
        }
    }
}

@Composable
private fun MoveDialog(
    m: MaterialDetail, title: String, qtyLabel: String, textLabel: String, textPh: String, hint: String?, warn: String?, save: String,
    busy: Boolean, onClose: () -> Unit, optional: Boolean = false, onSave: (String?, String, String) -> Unit,
) {
    var unit by rememberSaveable { mutableStateOf<String?>(null) }
    var qty by rememberSaveable { mutableStateOf("") }
    var text by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                hint?.let { Text(it, fontSize = 12.5.sp, color = Zk.colors.fgMuted) }
                warn?.let { Text(it, fontSize = 12.5.sp, color = Zk.colors.warn) }
                UnitPick(m, unit) { unit = it }
                OutlinedTextField(qty, { qty = it.take(24) }, label = { Text(qtyLabel) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(text, { text = it.take(300) }, label = { Text(textLabel) }, placeholder = { Text(textPh) }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(enabled = !busy && qty.isNotBlank() && (optional || text.trim().length >= 2), onClick = { onSave(unit, qty, text) }) { Text(save) } },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

@Composable
private fun ReceiveDialog(m: MaterialDetail, vm: MaterialViewModel, busy: Boolean, onClose: () -> Unit) {
    val proof by vm.proof.collectAsStateWithLifecycle()
    val uploading by vm.uploading.collectAsStateWithLifecycle()
    var unit by rememberSaveable { mutableStateOf<String?>(null) }
    var qty by rememberSaveable { mutableStateOf("") }
    // who has no cost key always receives «بدون سعر»
    var unpriced by rememberSaveable { mutableStateOf(!m.canCost) }
    var cost by rememberSaveable { mutableStateOf("") }
    var currency by rememberSaveable { mutableStateOf(m.cost?.currency ?: "JOD") }
    var supplier by rememberSaveable { mutableStateOf<String?>(null) }
    var received by rememberSaveable { mutableStateOf(Q8.today()) }
    var expires by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    var noPhoto by rememberSaveable { mutableStateOf(false) }
    var reason by rememberSaveable { mutableStateOf("") }
    var supOpen by remember { mutableStateOf(false) }
    var curOpen by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let(vm::uploadProof) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w(if (m.canCost) "mfg.receive" else "mfg.receive_unpriced")) },
        text = {
            Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                UnitPick(m, unit) { unit = it }
                OutlinedTextField(qty, { qty = it.take(24) }, label = { Text(w("mfg.f.qty")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (m.canCost) Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(unpriced, { unpriced = it }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                    Text(w("mfg.unpriced_choose"), fontSize = 13.sp, color = Zk.colors.fg)
                }
                if (unpriced) WarnFix(w("mfg.unpriced_warn"), w("mfg.unpriced_fix"))
                else {
                    OutlinedTextField(cost, { cost = it.take(24) }, label = { Text(w("mfg.f.price_per", "unit" to (m.units.firstOrNull { it.id == unit }?.label ?: m.baseUnit))) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    val fixed = m.cost?.currency
                    if (fixed != null) Text(w("mfg.currency_fixed", "currency" to (MfgWords.all["mfg.cur.$fixed"] ?: fixed)), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    else Box {
                        Pill(w("mfg.f.currency") + ": " + (MfgWords.all["mfg.cur.$currency"] ?: currency), true) { curOpen = true }
                        DropdownMenu(curOpen, { curOpen = false }) { Q8.CURRENCIES.forEach { c -> DropdownMenuItem(text = { Text(MfgWords.all["mfg.cur.$c"] ?: c) }, onClick = { currency = c; curOpen = false }) } }
                    }
                }
                Box {
                    Pill(w("mfg.f.supplier") + ": " + (m.suppliers.firstOrNull { it.id == supplier }?.name ?: w("mfg.f.no_supplier")), supplier != null) { supOpen = true }
                    DropdownMenu(supOpen, { supOpen = false }) {
                        DropdownMenuItem(text = { Text(w("mfg.f.no_supplier")) }, onClick = { supplier = null; supOpen = false })
                        m.suppliers.filter { !it.archived }.forEach { s -> DropdownMenuItem(text = { Text(s.name) }, onClick = { supplier = s.id; supOpen = false }) }
                    }
                }
                OutlinedTextField(received, { received = it.take(10) }, label = { Text(w("mfg.f.received_on")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(expires, { expires = it.take(10) }, label = { Text(w("mfg.f.expires_on")) }, placeholder = { Text("2027-01-31") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(note, { note = it.take(500) }, label = { Text(w("mfg.f.note")) }, modifier = Modifier.fillMaxWidth())
                Text(w("mfg.proof_title"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                Text(w("mfg.proof_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                if (!noPhoto) TextButton(enabled = !uploading, onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Text(w(if (uploading) "mfg.proof_uploading" else if (proof != null) "mfg.proof_change" else "mfg.proof_pick"), color = Zk.colors.accent)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(noPhoto, { noPhoto = it; if (it) vm.clearProof() }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                    Text(w("mfg.proof_none"), fontSize = 13.sp, color = Zk.colors.fg)
                }
                if (noPhoto) {
                    Text(w("mfg.proof_warn"), fontSize = 12.sp, color = Zk.colors.warn)
                    OutlinedTextField(reason, { reason = it.take(300) }, label = { Text(w("mfg.proof_reason")) }, placeholder = { Text(w("mfg.proof_reason_ph")) }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            val ready = qty.isNotBlank() && (unpriced || cost.isNotBlank()) && (proof != null || (noPhoto && reason.trim().length >= 2)) && !uploading
            TextButton(enabled = !busy && ready, onClick = {
                vm.receive(
                    ReceiveBody(
                        unitId = unit, qty = qty.trim(),
                        unitCost = if (unpriced) null else cost.trim(), currency = if (unpriced) null else (m.cost?.currency ?: currency), unpriced = if (unpriced) true else null,
                        supplierId = supplier, receivedOn = received.trim(), expiresOn = expires.trim().ifBlank { null }, note = note.trim().ifBlank { null },
                        proofFileId = proof, proofNote = if (proof != null) null else reason.trim(),
                    ),
                    unpriced, onClose,
                )
            }) { Text(w(if (unpriced) "mfg.receive_unpriced_save" else "mfg.receive_save")) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

@Composable
private fun PriceDialog(kind: String, lot: Lot, m: MaterialDetail, busy: Boolean, onClose: () -> Unit, onSave: (String, String, String) -> Unit) {
    var cost by remember(lot.id) { mutableStateOf("") }
    var reason by remember(lot.id) { mutableStateOf("") }
    // the lot's currency, which never changes: the material's (or the lot's own for a correction)
    val currency = lot.cost?.currency ?: m.cost?.currency ?: "JOD"
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w(if (kind == "fill") "mfg.cost_fill" else "mfg.price_correct_title")) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(cost, { cost = it.take(24) }, label = { Text(w("mfg.f.price_per", "unit" to lot.enteredUnitLabel)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(w("mfg.currency_fixed", "currency" to (MfgWords.all["mfg.cur.$currency"] ?: currency)), fontSize = 12.sp, color = Zk.colors.fgMuted)
                if (kind == "fill") { Text(w("mfg.cost_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted); WarnFix(w("mfg.cost_once_warn"), w("mfg.cost_once_fix")) }
                else {
                    OutlinedTextField(reason, { reason = it.take(300) }, label = { Text(w("mfg.f.correct_reason")) }, placeholder = { Text(w("mfg.f.correct_reason_ph")) }, modifier = Modifier.fillMaxWidth())
                    WarnFix(w("mfg.price_correct_warn"), w("mfg.price_correct_fix"))
                }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && cost.isNotBlank() && (kind == "fill" || reason.trim().length >= 2), onClick = { onSave(cost, currency, reason) }) {
                Text(w(if (kind == "fill") "mfg.cost_save" else "mfg.price_correct_save"))
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

@Composable
private fun EditDialog(m: MaterialDetail, vm: MaterialViewModel, busy: Boolean, onClose: () -> Unit) {
    var name by remember(m.id) { mutableStateOf(m.name) }
    var code by remember(m.id) { mutableStateOf(m.code.orEmpty()) }
    var low by remember(m.id) { mutableStateOf(m.lowStockMicro?.let { Q8.qty(it).replace(",", "") }.orEmpty()) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(Q8.edit) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(120) }, label = { Text(w("mfg.f.name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(code, { code = it.take(40) }, label = { Text(w("mfg.f.code")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(low, { low = it.take(24) }, label = { Text(w("mfg.f.low_stock")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(w("mfg.archive_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                TextButton(enabled = !busy, onClick = { vm.archive(!m.archived); onClose() }) { Text(w(if (m.archived) "mfg.restore" else "mfg.archive_material"), color = Zk.colors.danger) }
            }
        },
        confirmButton = { TextButton(enabled = !busy && name.isNotBlank(), onClick = { vm.edit(name, code, low, onClose) }) { Text(Q8.save) } },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}

@Composable
private fun UnitDialog(baseUnit: String, busy: Boolean, onClose: () -> Unit, onSave: (String, Long, Long) -> Unit) {
    var label by remember { mutableStateOf("") }
    var num by remember { mutableStateOf("") }
    var den by remember { mutableStateOf("1") }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w("mfg.unit_add")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(label, { label = it.take(40) }, label = { Text(w("mfg.f.unit_label")) }, placeholder = { Text(w("mfg.f.unit_label_ph")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(num, { num = it.filter(Char::isDigit).take(7) }, label = { Text(w("mfg.f.unit_num", "unit" to baseUnit)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(den, { den = it.filter(Char::isDigit).take(7) }, label = { Text(w("mfg.f.unit_den")) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && label.isNotBlank() && (num.toLongOrNull() ?: 0) > 0 && (den.toLongOrNull() ?: 0) > 0, onClick = { onSave(label, num.toLong(), den.toLong()) }) { Text(w("mfg.unit_add")) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
    )
}
