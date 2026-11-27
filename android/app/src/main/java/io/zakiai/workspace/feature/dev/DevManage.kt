package io.zakiai.workspace.feature.dev

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** «مصفوفة المهارات»: people × skills (the owner everybody, a supervisor their people), and the checklist for whoever keeps it. */
@HiltViewModel
class SkillsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DevBase(retrofit, session) {
    private val _matrix = MutableStateFlow<SkillMatrix?>(null)
    val matrix: StateFlow<SkillMatrix?> = _matrix.asStateFlow()
    private val _catalogue = MutableStateFlow<List<Skill>?>(null)
    /** null: this person does not keep the checklist */
    val catalogue: StateFlow<List<Skill>?> = _catalogue.asStateFlow()
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    fun refresh() = viewModelScope.launch {
        val home = read { api.home() } ?: return@launch
        if (home.home.mode != "self") read { api.matrix() }?.let { _matrix.value = it.matrix }
        if (home.home.canManageLines) read { api.catalogueAll() }?.let { _catalogue.value = it.skills }
        _failure.value = null
        _ready.value = true
    }

    fun add(name: String, category: String, description: String, done: () -> Unit) =
        act({ api.addSkill(SkillBody(name.trim(), category.trim(), description.trim())) }, w("teamdev.catalogue.saved")) { done(); refresh() }

    fun edit(s: Skill, name: String, category: String, description: String, done: () -> Unit) =
        act({ api.patchSkill(s.id, SkillPatch(name.trim(), category.trim(), description.trim())) }, w("teamdev.catalogue.saved")) { done(); refresh() }

    fun archive(s: Skill) = act({ api.patchSkill(s.id, SkillPatch(archived = !s.archived)) }, null) { refresh() }
}

/** «إعدادات التقييم»: the OWNER's weights of the score and the criteria a reviewer rates (renamed, added up to 8, retired, never deleted). */
@HiltViewModel
class DevSettingsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DevBase(retrofit, session) {
    private val _weights = MutableStateFlow<Weights?>(null)
    val weights: StateFlow<Weights?> = _weights.asStateFlow()
    private val _criteria = MutableStateFlow<List<Criterion>>(emptyList())
    val criteria: StateFlow<List<Criterion>> = _criteria.asStateFlow()

    fun refresh() = viewModelScope.launch {
        read { api.criteria() }?.let { _criteria.value = it.criteria }
        read { api.weights() }?.let { _weights.value = it.weights }
    }

    fun save(w8: Weights) = act({ api.setWeights(w8) }, w("teamdev.settings.saved")) { refresh() }
    fun add(name: String, done: () -> Unit) = act({ api.addCriterion(NameBody(name.trim())) }, w("teamdev.settings.saved")) { done(); refresh() }
    fun rename(c: Criterion, name: String) = act({ api.patchCriterion(c.id, CriterionPatch(name = name.trim())) }, w("teamdev.settings.saved")) { refresh() }
    fun archive(c: Criterion) = act({ api.patchCriterion(c.id, CriterionPatch(archived = !c.archived)) }, null) { refresh() }
}

/** a typed weight: a whole number 0-100, or null (the server says the precise refusal too) */
internal fun weightOf(text: String): Int? = text.trim().toIntOrNull()?.takeIf { it in 0..100 }

/**
 * «مصفوفة المهارات» (src/app/(app)/development/skills/page.tsx): each person with the supervisor's level and, beside it, their own estimate,
 * so the two are never mixed up; then «قائمة المهارات» for whoever keeps it — add, edit, archive and bring back, never delete.
 */
@Composable
fun SkillsScreen(onBack: () -> Unit, onOpenPerson: (String) -> Unit, vm: SkillsViewModel = hiltViewModel()) {
    val matrix by vm.matrix.collectAsStateWithLifecycle()
    val catalogue by vm.catalogue.collectAsStateWithLifecycle()
    val ready by vm.ready.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Skill?>(null) }
    var adding by remember { mutableStateOf(false) }
    WhileOnScreen(120_000) { vm.refresh() }
    Page(w("teamdev.skills.page"), ready, failure, notice, vm::consumeNotice, { vm.refresh() }, onBack) {
        val m = matrix
        item(key = "head") {
            Line(w("teamdev.skills.page_hint"))
            if (m != null) {
                Line(w("teamdev.matrix.legend"))
                if (m.skills.isEmpty()) Line(w("teamdev.skill.empty")) else if (m.people.isEmpty()) Line(w("teamdev.people.empty"))
            }
        }
        if (m != null && m.skills.isNotEmpty()) items(m.people, key = { "p" + it.userId }) { p ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(p.name + (p.jobTitle?.let { " آ· $it" } ?: ""), fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent, modifier = Modifier.clickable { onOpenPerson(p.userId) }.padding(bottom = 4.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    m.skills.forEach { s ->
                        val cell = m.cells[p.userId]?.get(s.id)
                        Column(Modifier.clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface1).padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(s.name, fontSize = 11.5.sp, color = Zk.colors.fgMuted, maxLines = 1)
                            Text(cell?.manual?.let { D.n(it) } ?: "—", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                            Text(cell?.self?.let { D.n(it) } ?: "—", fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                        }
                    }
                }
            }
            Divider()
        }
        val cat = catalogue
        if (cat != null) {
            item(key = "cat") {
                Title(w("teamdev.catalogue.title"), w("teamdev.catalogue.hint", "max" to 100))
                Act("+ " + w("teamdev.catalogue.add"), !busy) { adding = true }
            }
            items(cat, key = { "s" + it.id }) { s ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Text(s.name + (s.category.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "") + if (s.archived) " · " + w("teamdev.skill.archived") else "", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (s.archived) Zk.colors.fgMuted else Zk.colors.fg)
                    if (s.description.isNotBlank()) Text(s.description, fontSize = 12.sp, color = Zk.colors.fgMuted)
                    Row {
                        Act(D.edit, !busy) { editing = s }
                        Act(w(if (s.archived) "teamdev.catalogue.restore" else "teamdev.catalogue.archive"), !busy, Zk.colors.fgMuted) { vm.archive(s) }
                    }
                }
                Divider()
            }
        }
        item(key = "csv") { Mark(D.csvWarn, D.csvFix) }
    }
    if (adding || editing != null) {
        val s = editing
        var name by remember(s?.id) { mutableStateOf(s?.name.orEmpty()) }
        var category by remember(s?.id) { mutableStateOf(s?.category.orEmpty()) }
        var description by remember(s?.id) { mutableStateOf(s?.description.orEmpty()) }
        val close = { adding = false; editing = null }
        AlertDialog(
            onDismissRequest = close,
            containerColor = Zk.colors.surface1,
            title = { Text(if (s == null) w("teamdev.catalogue.add") else s.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(name, { name = it.take(60) }, label = { Text(w("teamdev.catalogue.name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(category, { category = it.take(40) }, label = { Text(w("teamdev.catalogue.category")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(description, { description = it.take(300) }, label = { Text(w("teamdev.catalogue.description")) }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton(enabled = !busy && name.isNotBlank(), onClick = { if (s == null) vm.add(name, category, description, close) else vm.edit(s, name, category, description, close) }) {
                    Text(if (s == null) w("teamdev.catalogue.add") else D.save)
                }
            },
            dismissButton = { TextButton(onClick = close) { Text(D.cancel) } },
        )
    }
}

/** «إعدادات التقييم» (src/components/team-development/settings-panel.tsx): the OWNER's. Anybody else gets «not found» from the server. */
@Composable
fun DevSettingsScreen(onBack: () -> Unit, vm: DevSettingsViewModel = hiltViewModel()) {
    val weights by vm.weights.collectAsStateWithLifecycle()
    val criteria by vm.criteria.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    WhileOnScreen(120_000) { vm.refresh() }
    Page(w("teamdev.settings.title"), weights != null, failure, notice, vm::consumeNotice, { vm.refresh() }, onBack) {
        val now = weights ?: return@Page
        item(key = "weights") {
            Line(w("teamdev.settings.subtitle"))
            Title(w("teamdev.settings.weights"), w("teamdev.settings.weights_hint"))
            var manual by remember(now) { mutableStateOf(D.n(now.manual)) }
            var completed by remember(now) { mutableStateOf(D.n(now.completed)) }
            var onTime by remember(now) { mutableStateOf(D.n(now.onTime)) }
            var steps by remember(now) { mutableStateOf(D.n(now.steps)) }
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(
                    Triple(w("teamdev.score.ind.manual"), manual) { v: String -> manual = v },
                    Triple(w("teamdev.score.ind.completed"), completed) { v: String -> completed = v },
                    Triple(w("teamdev.score.ind.onTime"), onTime) { v: String -> onTime = v },
                    Triple(w("teamdev.score.ind.steps"), steps) { v: String -> steps = v },
                ).forEach { (label, value, set) ->
                    OutlinedTextField(value, { set(it.filter(Char::isDigit).take(3)) }, label = { Text(label) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                }
            }
            val all = listOf(manual, completed, onTime, steps).map(::weightOf)
            Act(D.save, !busy && all.all { it != null }) { vm.save(Weights(all[0]!!, all[1]!!, all[2]!!, all[3]!!)) }
            Title(w("teamdev.settings.criteria"), w("teamdev.settings.criteria_hint", "max" to 8))
        }
        items(criteria, key = { it.id }) { c ->
            var name by remember(c.id, c.name) { mutableStateOf(c.name) }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(name, { name = it.take(40) }, singleLine = true, modifier = Modifier.weight(1f))
                Act(D.save, !busy && name.isNotBlank() && name != c.name) { vm.rename(c, name) }
                Act(w(if (c.archived) "teamdev.catalogue.restore" else "teamdev.catalogue.archive"), !busy, Zk.colors.fgMuted) { vm.archive(c) }
            }
        }
        item(key = "new") {
            var name by remember { mutableStateOf("") }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(name, { name = it.take(40) }, placeholder = { Text(w("teamdev.settings.new_criterion")) }, singleLine = true, modifier = Modifier.weight(1f))
                Act(w("teamdev.settings.add_criterion"), !busy && name.isNotBlank()) { vm.add(name) { name = "" } }
            }
            Formula(now)
        }
    }
}
