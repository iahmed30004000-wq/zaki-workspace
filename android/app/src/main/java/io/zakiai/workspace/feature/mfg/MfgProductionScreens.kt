package io.zakiai.workspace.feature.mfg

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.ApiFailure
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

/** the frame of a part of the ledger: its bar, its four tabs, the loading / refusal / list, the notices */
@Composable
private fun <V> MfgPart(
    tab: String, spaceId: String?, data: V?, failure: ApiFailure?, notice: String?, onSaid: () -> Unit, onRetry: () -> Unit,
    onBack: () -> Unit, onTab: (String) -> Unit, fab: (@Composable BoxScope.() -> Unit)? = null, body: LazyListScope.(V) -> Unit,
) {
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); onSaid() } }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = w("mfg.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                spaceId == null -> Empty(w("mfg.not_mfg_space") + "\n" + w("mfg.not_mfg_space_hint"))
                data == null && failure != null -> if (failure.status == 404) Empty(w("mfg.not_found")) else Failure(failure.message, onRetry = onRetry)
                data == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                    item(key = "tabs") {
                        MfgTabs(tab, onTab)
                        // a refusal of a later read (a wrong period ...) is said above what is still shown
                        failure?.let { Line(Q8.refusal(it.detail, it.message), Zk.colors.danger) }
                    }
                    body(data)
                }
            }
            if (data != null) fab?.invoke(this)
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun Divider() = HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))

@Composable
private fun Act(label: String, enabled: Boolean, color: Color = Zk.colors.accent, onClick: () -> Unit) =
    TextButton(enabled = enabled, onClick = onClick) { Text(label, color = if (enabled) color else Zk.colors.fgMuted, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }

/** a choice among a few, as the site's select */
@Composable
private fun Choice(label: String, current: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Pill("$label: $current", true) { open = true }
        DropdownMenu(open, { open = false }) { options.forEach { (id, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { onPick(id); open = false }) } }
    }
}

@Composable
private fun Field(value: String, label: String, max: Int, onChange: (String) -> Unit) =
    OutlinedTextField(value, { onChange(it.take(max)) }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())

@Composable
private fun FormDialog(title: String, save: String, ready: Boolean, busy: Boolean, onClose: () -> Unit, onSave: () -> Unit, content: @Composable () -> Unit) = AlertDialog(
    onDismissRequest = onClose,
    containerColor = Zk.colors.surface1,
    title = { Text(title) },
    text = { Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() } },
    confirmButton = { TextButton(enabled = !busy && ready, onClick = onSave) { Text(save) } },
    dismissButton = { TextButton(onClick = onClose) { Text(Q8.cancel) } },
)

/** a typed quantity the server will read: digits with at most one point, above zero (the server says the precise refusal) */
internal fun looksQty(s: String): Boolean = s.trim().let { t -> Regex("^[0-9]+(\\.[0-9]+)?$").matches(t) && t.any { it in '1'..'9' } }

// ── «أوامر التصنيع» ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * «أوامر التصنيع» (src/components/manufacturing/orders-view.tsx): a planned quantity of a recipe. DRAFT → ISSUED (⚠️ the materials leave the stock
 * at once, the oldest lot first) → COMPLETED, or RETURNED; a draft can be edited or cancelled. The cost (lot by lot, with its formula) only when
 * the server sent it; a lot without a price makes it «ناقص».
 */
@Composable
fun MfgOrdersScreen(spaceId: String?, onBack: () -> Unit, onTab: (String) -> Unit, onOpenMaterial: (String) -> Unit, vm: MfgOrdersViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var creating by rememberSaveable { mutableStateOf(false) }
    var panel by remember { mutableStateOf<Pair<String, Order>?>(null) }
    if (spaceId != null) WhileOnScreen(60_000, spaceId) { vm.refresh(spaceId) }
    MfgPart(
        "orders", spaceId, data, failure, notice, vm::consumeNotice, { spaceId?.let(vm::refresh) }, onBack, onTab,
        fab = { if (data?.canEdit == true) RoundFab(Icons.Filled.Add, w("mfg.order_new"), Modifier.align(Alignment.BottomEnd).padding(18.dp)) { creating = true } },
    ) { d ->
        item(key = "head") {
            Line(w("mfg.orders_subtitle", "space" to d.spaceName))
            if (!d.canEdit) Line(w("mfg.read_only"))
            if (!d.canCost) Line(w("mfg.no_cost_note"))
            NotAccounting()
            Title(w("mfg.sub.orders"))
            if (d.orders.isEmpty()) QuietEmpty(w("mfg.order_none"), if (d.canEdit) w("mfg.order_none_hint") else w("mfg.empty_hint_view"))
        }
        items(d.orders, key = { it.id }) { o ->
            OrderCard(o, newest = o.id == d.orders.first().id, busy = busy, onIssue = { vm.issue(o) }, onPanel = { panel = it to o }, onOpenMaterial = onOpenMaterial)
            Divider()
        }
        item(key = "csv") { Mark(Q8.csvWarn, Q8.csvFix) }
    }
    val d = data ?: return
    if (creating) NewOrderDialog(d, busy, { creating = false }) { r, q, n -> vm.create(r, q, n) { creating = false } }
    panel?.let { (kind, o) ->
        val close = { panel = null }
        when (kind) {
            "edit" -> EditDraftDialog(o, d, busy, close) { vm.edit(o, it, close) }
            "complete" -> CompleteDialog(o, busy, close) { a, ws, wn -> vm.complete(o, a, ws, wn, close) }
            "cancel" -> ReasonDialog(w("mfg.order_cancel"), w("mfg.order_cancel_reason"), null, busy, close) { vm.cancel(o, it, close) }
            "return" -> ReasonDialog(w("mfg.order_return"), w("mfg.order_return_reason"), w("mfg.order_return_warn") to w("mfg.order_return_fix"), busy, close) { vm.giveBack(o, it, close) }
        }
    }
}

@Composable
private fun OrderCard(o: Order, newest: Boolean, busy: Boolean, onIssue: () -> Unit, onPanel: (String) -> Unit, onOpenMaterial: (String) -> Unit) {
    // the open ones and the newest are shown in full; the finished older ones fold up (a tap opens them), as on the site
    var open by rememberSaveable(o.id) { mutableStateOf(newest || o.status == "DRAFT" || o.status == "ISSUED") }
    val short = o.lines.any { !it.enough }
    Column(Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(w("mfg.order_n", "n" to o.seq) + " · " + o.recipeName, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
            Text(Q8.qtyUnit(o.plannedMicro, o.outputUnit), fontSize = 13.sp, color = Zk.colors.fgMuted)
        }
        val status = MfgWords.all["mfg.order_status.${o.status}"] ?: o.status
        Text(status + if (o.costIncomplete) " · ⚠️ " + w("mfg.order_cost_incomplete_badge") else "", fontSize = 12.5.sp, color = if (o.costIncomplete) Zk.colors.warn else Zk.colors.accent)
    }
    if (!open) return
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Line(w("mfg.recipe_version", "n" to o.version) + " · " + w("mfg.by", "who" to o.createdBy) + " · " + Q8.dmy(o.createdAt))
        o.note?.let { Line(it, Zk.colors.fg) }
        Line(w("mfg.order_lines"), Zk.colors.fg)
        o.lines.forEach { l ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 3.dp)) {
                Text(l.materialName, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = Zk.colors.fg)
                val have = if (o.status == "DRAFT") w("mfg.order_have") + ": " + Q8.qtyUnit(l.balanceMicro, l.baseUnit) + if (l.enough) "" else " ⚠️ " + w("mfg.order_short_line")
                else w("mfg.order_issued_qty") + ": " + Q8.qtyUnit(l.issuedMicro, l.baseUnit)
                Text(w("mfg.order_required") + ": " + Q8.qtyUnit(l.requiredMicro, l.baseUnit) + " · " + have, fontSize = 12.sp, color = if (o.status == "DRAFT" && !l.enough) Zk.colors.danger else Zk.colors.fgMuted)
                if (o.status == "DRAFT" && l.unpricedMicro > 0) Text("⚠️ " + w("mfg.order_unpriced_line", "qty" to Q8.qty(l.unpricedMicro), "unit" to l.baseUnit), fontSize = 12.sp, color = Zk.colors.warn)
            }
        }
        if (o.status == "COMPLETED") Line(
            w("mfg.order_actual") + ": " + Q8.qtyUnit(o.actualMicro ?: 0, o.outputUnit) +
                (o.wasteMicro?.takeIf { it > 0 }?.let { " · " + w("mfg.order_waste") + ": " + Q8.qtyUnit(it, o.outputUnit) + (o.wasteNote?.let { n -> " ($n)" } ?: "") } ?: ""),
        )
        o.closeNote?.let { Line(w("mfg.order_close_note") + ": " + it) }
        if (o.status == "DRAFT" && o.canIssue) {
            Mark(w("mfg.order_issue_warn"), w("mfg.order_issue_fix"))
            if (o.lines.any { it.unpricedMicro > 0 }) Line("⚠️ " + w("mfg.order_issue_unpriced"), Zk.colors.warn)
            if (short) Line(w("mfg.order_issue_blocked"), Zk.colors.danger)
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
                Act(w("mfg.order_issue"), !busy && !short, onClick = onIssue)
                if (o.canEditDraft) Act(w("mfg.order_edit"), !busy) { onPanel("edit") }
                if (o.canCancel) Act(w("mfg.order_cancel"), !busy, Zk.colors.danger) { onPanel("cancel") }
            }
        }
        if (o.recipeStocked && (o.status == "DRAFT" || o.status == "ISSUED")) Line(w("mfg.order_finished_will"))
        if (o.status == "ISSUED" && (o.canComplete || o.canReturn)) Row(Modifier.padding(horizontal = 8.dp)) {
            if (o.canComplete) Act(w("mfg.order_complete"), !busy) { onPanel("complete") }
            if (o.canReturn) Act(w("mfg.order_return"), !busy) { onPanel("return") }
        }
        o.finished?.let { f ->
            Line(w("mfg.order_finished_in", "qty" to Q8.qty(f.qtyMicro), "name" to f.materialName), Zk.colors.fg)
            Text(w("mfg.finished_open"), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenMaterial(f.materialId) }.padding(horizontal = 16.dp, vertical = 2.dp))
            if (f.costPending) Mark(w("mfg.order_finished_pending"), w("mfg.order_finished_pending_fix"))
            Mark(w("mfg.order_finished_warn"), w("mfg.order_finished_fix"))
        }
        if (o.costIncomplete) Mark(w("mfg.order_cost_incomplete"), w("mfg.order_cost_incomplete_fix"))
        o.cost?.let { CostBox(it, o) }
    }
}

/** the cost with its formula: every piece (so much from a lot at the lot's price), the total rounded once, the cost of one output unit */
@Composable
private fun CostBox(cost: OrderCost, o: Order) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(vertical = 8.dp)) {
        Line(w("mfg.order_cost_title"), Zk.colors.fg)
        Line(w("mfg.order_cost_formula"))
        if (cost.frozen) { Mark(w("mfg.order_cost_frozen_warn"), w("mfg.order_cost_frozen_fix")); Line(w("mfg.order_cost_frozen")) }
        cost.lines.forEach { line ->
            Line(line.materialName + " · " + Q8.qtyUnit(line.qtyMicro, line.baseUnit), Zk.colors.fg)
            line.pieces.forEach { p ->
                val where = p.lotReceivedOn?.let { w("mfg.order_cost_lot", "date" to Q8.dmy(it)) } ?: w("mfg.order_cost_nolot")
                val cur = line.currency
                val math = if (p.unitText != null && cur != null) "⁦${Q8.qty(p.qtyMicro)} × ${p.unitText} = ${p.amountMinor?.let { Q8.money(it, cur) } ?: ""}⁩" else "⁦${Q8.qty(p.qtyMicro)}⁩ ⚠️ " + w("mfg.order_cost_no_price")
                Line("$where  $math", if (p.unitText == null) Zk.colors.warn else Zk.colors.fgMuted)
            }
        }
        if (cost.totals.isEmpty()) Line(w("mfg.order_cost_nothing"), Zk.colors.warn)
        cost.totals.forEach { t ->
            Line(w("mfg.order_cost_total") + ": " + Q8.moneyText(t.totalMinor, t.currency), Zk.colors.fg, 14f)
            val actual = o.actualMicro
            if (t.perUnitText != null && actual != null && actual > 0) {
                Line(w("mfg.order_cost_per_unit", "unit" to o.outputUnit))
                Line("⁦${Q8.money(t.totalMinor, t.currency)} ÷ ${Q8.qty(actual)} = ${t.perUnitText}⁩ " + (MfgWords.all["mfg.cur.${t.currency}"] ?: t.currency), Zk.colors.fg)
            } else Line(w("mfg.order_cost_per_unit_later"))
        }
        Line(w("mfg.order_cost_round_note"))
    }
}

@Composable
private fun NewOrderDialog(v: OrdersView, busy: Boolean, onClose: () -> Unit, onSave: (String, String, String) -> Unit) {
    var recipeId by rememberSaveable { mutableStateOf(v.recipes.firstOrNull()?.id.orEmpty()) }
    var qty by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }
    val recipe = v.recipes.firstOrNull { it.id == recipeId }
    FormDialog(w("mfg.order_new"), w("mfg.order_create"), recipe != null && looksQty(qty), busy, onClose, { onSave(recipeId, qty, note) }) {
        if (v.recipes.isEmpty()) Text(w("mfg.order_no_recipes"), fontSize = 13.sp, color = Zk.colors.fgMuted)
        else {
            Choice(w("mfg.f.order_recipe"), recipe?.let { it.name + " · " + w("mfg.recipe_version", "n" to it.version) }.orEmpty(), v.recipes.map { it.id to it.name + " · " + w("mfg.recipe_version", "n" to it.version) }) { recipeId = it }
            Field(qty, w("mfg.f.order_qty", "unit" to (recipe?.outputUnit ?: "")), 24) { qty = it }
            Field(note, w("mfg.f.order_note"), 500) { note = it }
            Text(w("mfg.order_draft_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
            if (recipe?.stocked == true) Text(w("mfg.order_finished_will"), fontSize = 12.sp, color = Zk.colors.fgMuted)
        }
    }
}

/** «عدّل المسودة»: only what changed is sent (the recipe then takes its newest version; an emptied note is cleared) */
@Composable
private fun EditDraftDialog(o: Order, v: OrdersView, busy: Boolean, onClose: () -> Unit, onSave: (EditOrderBody) -> Unit) {
    val was = Q8.qty(o.plannedMicro).replace(",", "")
    var recipeId by remember(o.id) { mutableStateOf("") }
    var qty by remember(o.id) { mutableStateOf(was) }
    var note by remember(o.id) { mutableStateOf(o.note.orEmpty()) }
    val body = editBody(recipeId, qty, was, note, o.note)
    FormDialog(w("mfg.order_edit"), w("mfg.order_edit_save"), body != null && looksQty(qty), busy, onClose, { body?.let(onSave) }) {
        val keep = w("mfg.order_edit_recipe_keep")
        Choice(w("mfg.f.order_recipe"), v.recipes.firstOrNull { it.id == recipeId }?.let { w("mfg.order_edit_recipe_newest", "name" to it.name) } ?: keep, listOf("" to keep) + v.recipes.map { it.id to w("mfg.order_edit_recipe_newest", "name" to it.name) }) { recipeId = it }
        Field(qty, w("mfg.f.order_qty", "unit" to o.outputUnit), 24) { qty = it }
        Field(note, w("mfg.f.order_note"), 500) { note = it }
        Text(w("mfg.order_edit_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
    }
}

/** what a draft's edit sends: only the changed parts, null when nothing changed (pure, MfgTest pins it) */
internal fun editBody(recipeId: String, qty: String, wasQty: String, note: String, wasNote: String?): EditOrderBody? {
    val q = qty.trim().takeIf { it != wasQty }
    val n = note.trim().takeIf { it != (wasNote ?: "") }
    val r = recipeId.ifBlank { null }
    return if (q == null && n == null && r == null) null else EditOrderBody(r, q, n)
}

@Composable
private fun CompleteDialog(o: Order, busy: Boolean, onClose: () -> Unit, onSave: (String, String, String) -> Unit) {
    var actual by remember(o.id) { mutableStateOf("") }
    var waste by remember(o.id) { mutableStateOf("") }
    var wasteNote by remember(o.id) { mutableStateOf("") }
    FormDialog(w("mfg.order_complete"), w("mfg.order_complete_save"), looksQty(actual) && (waste.isBlank() || looksQty(waste) || waste.trim().all { it == '0' || it == '.' }), busy, onClose, { onSave(actual, waste, wasteNote) }) {
        Field(actual, w("mfg.f.actual_qty", "unit" to o.outputUnit), 24) { actual = it }
        Field(waste, w("mfg.f.waste_qty", "unit" to o.outputUnit), 24) { waste = it }
        Field(wasteNote, w("mfg.f.waste_note"), 300) { wasteNote = it }
        Text(w("mfg.order_waste_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
    }
}

@Composable
private fun ReasonDialog(title: String, label: String, warn: Pair<String, String>?, busy: Boolean, onClose: () -> Unit, onSave: (String) -> Unit) {
    var reason by remember { mutableStateOf("") }
    FormDialog(title, title, reason.trim().length >= 2, busy, onClose, { onSave(reason) }) {
        warn?.let { (a, b) -> WarnFix("⚠️ $a", "🔧 $b") }
        OutlinedTextField(reason, { reason = it.take(300) }, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
    }
}

// ── «وصفات» ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «وصفات» (src/components/manufacturing/recipes-view.tsx): how much of each material ONE output unit takes, typed in any unit of the material.
 * No price. A change is a NEW version (the old ones stay readable, never edited); a recipe is archived, never deleted.
 */
@Composable
fun MfgRecipesScreen(spaceId: String?, onBack: () -> Unit, onTab: (String) -> Unit, onOpenMaterial: (String) -> Unit, vm: MfgRecipesViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var archived by rememberSaveable { mutableStateOf(false) }
    // null: closed; "" a new recipe; an id: a new version of that recipe
    var form by rememberSaveable { mutableStateOf<String?>(null) }
    if (spaceId != null) WhileOnScreen(60_000, spaceId) { vm.refresh(spaceId) }
    MfgPart(
        "recipes", spaceId, data, failure, notice, vm::consumeNotice, { spaceId?.let(vm::refresh) }, onBack, onTab,
        fab = { if (data?.canEdit == true) RoundFab(Icons.Filled.Add, w("mfg.recipe_new"), Modifier.align(Alignment.BottomEnd).padding(18.dp)) { form = "" } },
    ) { d ->
        val shown = d.recipes.filter { archived || !it.archived }
        item(key = "head") {
            Line(w("mfg.recipes_subtitle", "space" to d.spaceName))
            if (!d.canEdit) Line(w("mfg.read_only"))
            NotAccounting()
            Title(w("mfg.sub.recipes"))
            if (d.recipes.any { it.archived }) Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(archived, { archived = it }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                Text(w("mfg.show_archived"), fontSize = 13.sp, color = Zk.colors.fg)
            }
            if (shown.isEmpty()) QuietEmpty(w("mfg.recipe_none"), if (d.canEdit) w("mfg.recipe_none_hint") else w("mfg.empty_hint_view"))
        }
        items(shown, key = { it.id }) { r ->
            RecipeCard(r, d.canEdit, busy, onVersion = { form = r.id }, onArchive = { vm.archive(r) }, onStock = { vm.stock(r) }, onOpenMaterial = onOpenMaterial)
            Divider()
        }
    }
    val d = data ?: return
    form?.let { id ->
        val recipe = d.recipes.firstOrNull { it.id == id }
        RecipeDialog(d, recipe, busy, { form = null }) { name, unit, note, lines -> vm.save(recipe, name, unit, note, lines) { form = null } }
    }
}

@Composable
private fun VersionLines(v: RecipeVersion) {
    Line(w("mfg.recipe_per_unit", "unit" to v.outputUnit))
    v.lines.forEach { l ->
        Text(
            l.materialName + "  " + Q8.qtyUnit(l.enteredQtyMicro, l.enteredUnitLabel) + (if (l.enteredUnitLabel != l.baseUnit) " (= ${Q8.qtyUnit(l.qtyMicro, l.baseUnit)})" else "") + if (l.materialArchived) " · " + w("mfg.archived") else "",
            fontSize = 13.5.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun RecipeCard(r: Recipe, canEdit: Boolean, busy: Boolean, onVersion: () -> Unit, onArchive: () -> Unit, onStock: () -> Unit, onOpenMaterial: (String) -> Unit) {
    var old by rememberSaveable(r.id) { mutableStateOf(false) }
    val cur = r.current
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Text(
            cur.name + " · " + w("mfg.recipe_version", "n" to cur.version) + if (r.archived) " · " + w("mfg.archived") else "",
            fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp),
        )
        VersionLines(cur)
        r.finished?.let { f ->
            Line(w("mfg.finished_linked", "name" to f.name))
            Text(w("mfg.finished_open"), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenMaterial(f.materialId) }.padding(horizontal = 16.dp, vertical = 2.dp))
        }
        cur.note?.let { Line(it) }
        Line(w("mfg.by", "who" to cur.createdBy) + " · " + Q8.dmy(cur.createdAt))
        if (canEdit) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
            if (!r.archived) Act(w("mfg.recipe_new_version"), !busy, onClick = onVersion)
            if (r.finished == null && r.canStock) Act(w("mfg.finished_on"), !busy, onClick = onStock)
            Act(w(if (r.archived) "mfg.restore" else "mfg.archive"), !busy, Zk.colors.fgMuted, onArchive)
        }
        if (canEdit && r.finished == null && r.canStock) Line(w("mfg.finished_on_hint"))
        if (r.versions.size > 1) {
            Text(w("mfg.recipe_versions_old", "n" to r.versions.size - 1), fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable { old = !old }.padding(horizontal = 16.dp, vertical = 4.dp))
            if (old) r.versions.drop(1).forEach { v ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface1).padding(vertical = 6.dp)) {
                    Line(w("mfg.recipe_version", "n" to v.version) + " · " + v.name, Zk.colors.fg)
                    VersionLines(v)
                    Line(w("mfg.by", "who" to v.createdBy) + " · " + Q8.dmy(v.createdAt))
                }
            }
        }
    }
}

private class LineDraft(val key: Int, materialId: String, unitId: String?, qty: String) {
    var materialId by mutableStateOf(materialId)
    var unitId by mutableStateOf(unitId)
    var qty by mutableStateOf(qty)
}

/** one form for «وصفة جديدة» and «نسخة جديدة»: the second starts from the lines of the current version; saving never changes an older one */
@Composable
private fun RecipeDialog(v: RecipesView, recipe: Recipe?, busy: Boolean, onClose: () -> Unit, onSave: (String, String, String, List<RecipeLineBody>) -> Unit) {
    val base = recipe?.current
    val mats = remember(v.materials) { v.materials.associateBy { it.id } }
    var name by remember(recipe?.id) { mutableStateOf(base?.name.orEmpty()) }
    var unit by remember(recipe?.id) { mutableStateOf(base?.outputUnit.orEmpty()) }
    var note by remember(recipe?.id) { mutableStateOf("") }
    var counter by remember { mutableStateOf(0) }
    val lines = remember(recipe?.id) {
        mutableStateListOf<LineDraft>().apply {
            base?.lines?.forEach { l -> add(LineDraft(size + 1, l.materialId, mats[l.materialId]?.units?.firstOrNull { !it.archived && it.label == l.enteredUnitLabel }?.id, Q8.qty(l.enteredQtyMicro).replace(",", ""))) }
            if (isEmpty()) add(LineDraft(1, "", null, ""))
        }
    }
    val ids = lines.map { it.materialId }.filter { it.isNotEmpty() }
    val duplicate = ids.toSet().size != ids.size
    val ready = name.isNotBlank() && unit.isNotBlank() && lines.isNotEmpty() && lines.all { it.materialId in mats && looksQty(it.qty) } && !duplicate
    FormDialog(
        w(if (recipe == null) "mfg.recipe_new" else "mfg.recipe_new_version"), w("mfg.recipe_save"), ready, busy, onClose,
        { onSave(name, unit, note, lines.map { RecipeLineBody(it.materialId, it.unitId, it.qty.trim()) }) },
    ) {
        Field(name, w("mfg.f.recipe_name"), 120) { name = it }
        Field(unit, w("mfg.f.output_unit"), 40) { unit = it }
        Text(w("mfg.recipe_per_unit", "unit" to unit.trim().ifBlank { w("mfg.f.output_unit") }), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
        if (v.materials.isEmpty()) Text("⚠️ " + w("mfg.recipe_no_materials"), fontSize = 12.sp, color = Zk.colors.warn)
        lines.forEach { l ->
            val m = mats[l.materialId]
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface2).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Choice(w("mfg.f.recipe_material"), m?.name ?: "—", v.materials.map { it.id to it.name }) { l.materialId = it; l.unitId = null }
                if (m != null) Choice(w("mfg.f.unit"), m.units.firstOrNull { it.id == l.unitId }?.label ?: m.baseUnit, listOf("" to m.baseUnit) + m.units.filter { !it.archived }.map { it.id to it.label }) { l.unitId = it.ifEmpty { null } }
                Field(l.qty, w("mfg.f.recipe_qty"), 24) { l.qty = it }
                if (lines.size > 1) Act(w("mfg.recipe_remove_line"), true, Zk.colors.danger) { lines.remove(l) }
            }
        }
        if (duplicate) Text(w("mfg.e.recipe_dup"), fontSize = 12.sp, color = Zk.colors.danger)
        Act("+ " + w("mfg.recipe_add_line"), true) { counter += 1; lines.add(LineDraft(1000 + counter, "", null, "")) }
        Field(note, w("mfg.f.recipe_note"), 500) { note = it }
        WarnFix("⚠️ " + w("mfg.recipe_versions_warn"), "🔧 " + w("mfg.recipe_versions_fix"))
    }
}

// ── «تقارير» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «تقارير» (src/components/manufacturing/reports-view.tsx), read only: the stock's value, what was consumed in a period, what each order cost, what is
 * low. Quantities for whoever may view; money only when the server sent it (a holder of `manufacturing.cost`).
 */
@Composable
fun MfgReportsScreen(spaceId: String?, onBack: () -> Unit, onTab: (String) -> Unit, onOpenMaterial: (String) -> Unit, vm: MfgReportsViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    if (spaceId != null) WhileOnScreen(120_000, spaceId) { vm.refresh(spaceId) }
    MfgPart("reports", spaceId, data, failure, notice, vm::consumeNotice, { spaceId?.let(vm::refresh) }, onBack, onTab) { r ->
        item(key = "head") {
            Line(w("mfg.reports_subtitle", "space" to r.spaceName))
            NotAccounting()
            if (!r.canCost) Line(w("mfg.report_no_money"))
            PeriodForm(r.period) { a, b -> vm.period(a, b) }
            Title(w("mfg.report.valuation"), w(if (r.canCost) "mfg.report_valuation_hint" else "mfg.report_valuation_hint_qty"))
            if (r.valuation.isEmpty()) Line(w("mfg.report_none"))
        }
        items(r.valuation, key = { "v" + it.materialId }) { v ->
            Column(Modifier.fillMaxWidth().clickable { onOpenMaterial(v.materialId) }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(v.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Text(Q8.qtyUnit(v.qtyMicro, v.baseUnit), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                }
                v.cost?.currency?.let { Text(w("mfg.value") + ": " + Q8.moneyText(v.cost.valueMinor, it), fontSize = 12.sp, color = Zk.colors.fgMuted) }
                v.cost?.formula?.let { f -> Text(w("mfg.formula") + ": ⁦${f.value} ÷ ${f.qty} = ${f.average}⁩", fontSize = 12.sp, color = Zk.colors.fgMuted) }
                if (v.unpricedMicro > 0) Text("⚠️ " + w("mfg.report_unpriced", "qty" to Q8.qty(v.unpricedMicro), "unit" to v.baseUnit) + " · 🔧 " + w("mfg.report_unpriced_fix"), fontSize = 12.sp, color = Zk.colors.warn)
            }
            Divider()
        }
        item(key = "consumption") {
            r.valuationTotals?.forEach { t -> Line(w("mfg.report_total") + ": " + Q8.moneyText(t.valueMinor, t.currency), Zk.colors.fg, 14f) }
            Title(w("mfg.report.consumption"), w("mfg.report_consumption_hint", "from" to Q8.dmy(r.period.from), "to" to Q8.dmy(r.period.to)))
            if (r.consumption.isEmpty()) Line(w("mfg.report_none"))
        }
        items(r.consumption, key = { "c" + it.materialId }) { c ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(c.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Text(Q8.qtyUnit(c.qtyMicro, c.baseUnit), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                }
                val parts = listOfNotNull(
                    w("mfg.report_via_orders") + ": " + Q8.qtyUnit(c.viaOrdersMicro, c.baseUnit),
                    c.cost?.currency?.let { w("mfg.report_cost") + ": " + Q8.moneyText(c.cost.totalMinor, it) },
                    if (c.cost?.incomplete == true) "⚠️ " + w("mfg.order_cost_incomplete_badge") else null,
                )
                Text(parts.joinToString(" · "), fontSize = 12.sp, color = if (c.cost?.incomplete == true) Zk.colors.warn else Zk.colors.fgMuted)
            }
            Divider()
        }
        item(key = "orders") {
            Title(w("mfg.report.orders"), w("mfg.report_orders_hint"))
            if (r.orders.isEmpty()) Line(w("mfg.report_none"))
        }
        items(r.orders, key = { "o" + it.orderId }) { o ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(w("mfg.order_n", "n" to o.seq) + " · " + o.recipeName, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Text(Q8.qtyUnit(o.actualMicro ?: o.plannedMicro, o.outputUnit), fontSize = 13.5.sp, color = Zk.colors.fg)
                }
                Text((MfgWords.all["mfg.order_status.${o.status}"] ?: o.status) + " · " + Q8.dmy(o.day) + if (o.costIncomplete) " · ⚠️ " + w("mfg.order_cost_incomplete_badge") else "", fontSize = 12.sp, color = if (o.costIncomplete) Zk.colors.warn else Zk.colors.fgMuted)
                o.cost?.totals?.forEach { t ->
                    Text(
                        w("mfg.order_cost_total") + ": " + Q8.moneyText(t.totalMinor, t.currency) + (t.perUnitText?.let { " · " + w("mfg.order_cost_per_unit", "unit" to o.outputUnit) + ": ⁦$it⁩" } ?: ""),
                        fontSize = 12.sp, color = Zk.colors.fgMuted,
                    )
                }
            }
            Divider()
        }
        item(key = "low") {
            Title(w("mfg.report.low"), w("mfg.report_low_hint"))
            if (r.low.isEmpty()) Line(w("mfg.report_low_none"))
        }
        items(r.low, key = { "l" + it.materialId }) { l ->
            Column(Modifier.fillMaxWidth().clickable { onOpenMaterial(l.materialId) }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("⚠️ " + l.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Zk.colors.danger, modifier = Modifier.weight(1f))
                    Text(Q8.qtyUnit(l.qtyMicro, l.baseUnit), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                }
                Text(w("mfg.report_threshold") + ": " + Q8.qtyUnit(l.lowStockMicro, l.baseUnit), fontSize = 12.sp, color = Zk.colors.fgMuted)
                Text("🔧 " + w("mfg.low_fix_short"), fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
            Divider()
        }
        item(key = "csv") { Mark(Q8.csvWarn, Q8.csvFix) }
    }
}

@Composable
private fun PeriodForm(p: Period, onShow: (String, String) -> Unit) {
    var from by remember(p.from) { mutableStateOf(p.from) }
    var to by remember(p.to) { mutableStateOf(p.to) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(from, { from = it.take(10) }, label = { Text(w("mfg.report_from")) }, singleLine = true, modifier = Modifier.weight(1f))
            OutlinedTextField(to, { to = it.take(10) }, label = { Text(w("mfg.report_to")) }, singleLine = true, modifier = Modifier.weight(1f))
        }
        Text(w("mfg.report_period_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
        Act(w("mfg.report_show"), from.isNotBlank() && to.isNotBlank()) { onShow(from, to) }
    }
}
