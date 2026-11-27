package io.zakiai.workspace.feature.routines

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desks.DesksApi
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Whether «روتين المهام» is a tab of «الشغل» for this person: the desk facts, read once (the site draws its link on the same three checks). */
@HiltViewModel
class RoutinesGateViewModel @Inject constructor(retrofit: retrofit2.Retrofit) : ViewModel() {
    private val desks = retrofit.create(DesksApi::class.java)
    private val _on = MutableStateFlow(false)
    val on: StateFlow<Boolean> = _on.asStateFlow()

    init {
        viewModelScope.launch { (apiCall { desks.facts() } as? ApiResult.Ok)?.let { _on.value = it.value.routines } }
    }
}

@HiltViewModel
class RoutinesViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    private val api = retrofit.create(RoutinesApi::class.java)
    private val _answer = MutableStateFlow<RoutinesAnswer?>(null)
    val answer: StateFlow<RoutinesAnswer?> = _answer.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    /** the routine being paused or resumed */
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()
    /** a refusal of pause / resume, shown above the list */
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving.asStateFlow()
    /** a refusal of the open form, shown inside it */
    private val _formError = MutableStateFlow<String?>(null)
    val formError: StateFlow<String?> = _formError.asStateFlow()

    fun refresh() = viewModelScope.launch {
        when (val r = apiCall { api.screen() }) {
            is ApiResult.Ok -> { _failure.value = null; _answer.value = r.value }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
    }

    private fun put(saved: Routine) {
        val a = _answer.value ?: return
        val list = if (a.routines.any { it.id == saved.id }) a.routines.map { if (it.id == saved.id) saved else it } else a.routines + saved
        _answer.value = a.copy(routines = list)
    }

    fun toggle(r: Routine) = viewModelScope.launch {
        if (_busy.value != null) return@launch
        _busy.value = r.id
        _error.value = null
        when (val res = apiCall { api.act(r.id, RoutineAction(if (r.active) "pause" else "resume")) }) {
            is ApiResult.Ok -> put(res.value.routine)
            is ApiResult.Err -> _error.value = RT.refusal(res.failure)
        }
        _busy.value = null
    }

    fun clearFormError() { _formError.value = null }
    fun showFormError(key: String) { _formError.value = rw(key) }

    /** a new routine (`id` null) or a new version of one; [onDone] closes the form once the server took it */
    fun save(id: String?, input: RoutineInput, onDone: () -> Unit) = viewModelScope.launch {
        if (_saving.value) return@launch
        _saving.value = true
        _formError.value = null
        val res = apiCall { if (id == null) api.create(input) else api.update(id, input) }
        _saving.value = false
        when (res) {
            is ApiResult.Ok -> { put(res.value.routine); onDone() }
            is ApiResult.Err -> _formError.value = RT.refusal(res.failure)
        }
    }
}

@Composable
private fun Divider() = HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) = Text(
    label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
    color = if (on) Zk.colors.accentFg else Zk.colors.fg,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
)

/** A picker drawn as one line: the chosen value, a menu of the options. */
@Composable
private fun Picker(label: String, value: String, options: List<Pair<String, String>>, modifier: Modifier = Modifier.fillMaxWidth(), onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(modifier.padding(vertical = 2.dp)) {
        if (label.isNotEmpty()) Text(label, fontSize = 12.sp, color = Zk.colors.fgMuted)
        Box {
            Text(
                options.firstOrNull { it.first == value }?.second ?: value, fontSize = 14.sp, color = Zk.colors.fg,
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, Zk.colors.border, RoundedCornerShape(10.dp))
                    .clickable { open = true }.padding(horizontal = 12.dp, vertical = 12.dp),
            )
            DropdownMenu(open, { open = false }) {
                options.forEach { (k, v) -> DropdownMenuItem(text = { Text(v) }, onClick = { open = false; onPick(k) }) }
            }
        }
    }
}

/** A time of day as two pickers (hour, minute): the phone's own, so it never shows a foreign clock. */
@Composable
private fun ClockPicker(label: String, value: String, onPick: (String) -> Unit) {
    val h = value.substringBefore(':').toIntOrNull()?.coerceIn(0, 23) ?: 8
    val m = value.substringAfter(':', "").toIntOrNull()?.coerceIn(0, 59) ?: 0
    val minutes = ((0..55 step 5).toList() + m).distinct().sorted()
    Column(Modifier.fillMaxWidth()) {
        Text(label, fontSize = 12.sp, color = Zk.colors.fgMuted)
        // the clock reads left to right (hour then minute), whatever the page's direction
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Ltr) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Picker("", String.format(java.util.Locale.ROOT, "%02d", h), (0..23).map { String.format(java.util.Locale.ROOT, "%02d", it).let { s -> s to s } }, Modifier.weight(1f)) {
                    onPick(RT.clock(it.toInt(), m))
                }
                Text(":", fontSize = 18.sp, color = Zk.colors.fg)
                Picker("", String.format(java.util.Locale.ROOT, "%02d", m), minutes.map { String.format(java.util.Locale.ROOT, "%02d", it).let { s -> s to s } }, Modifier.weight(1f)) {
                    onPick(RT.clock(h, it.toInt()))
                }
            }
        }
    }
}

/**
 * «روتين المهام» (the site's /my-work/routines): every routine the person may see, with «إيقاف مؤقت» / «تشغيل» and «تعديل» for whoever
 * manages it, and «روتين جديد». Each routine makes one fresh card a day on its days; pausing never removes a card already made.
 */
@Composable
fun RoutinesScreen(vm: RoutinesViewModel = hiltViewModel()) {
    val answer by vm.answer.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Routine?>(null) }
    var making by remember { mutableStateOf(false) }
    WhileOnScreen(60_000) { vm.refresh() }
    val a = answer
    val f = failure
    when {
        a == null && f != null -> Failure(RT.refusal(f), onRetry = { vm.refresh() })
        a == null -> Loading()
        else -> {
            val canMake = a.spaces.isNotEmpty()
            LazyColumn(Modifier.fillMaxSize().background(Zk.colors.surface)) {
                item {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(rw("routine.title"), fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                        if (canMake) TextButton(onClick = { vm.clearFormError(); making = true }) {
                            Icon(Icons.Filled.Add, null, tint = Zk.colors.accent)
                            Text(rw("routine.new"), color = Zk.colors.accent, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Text(rw("routine.intro"), fontSize = 13.sp, color = Zk.colors.fgMuted, lineHeight = 19.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                    error?.let { Text(it, fontSize = 13.sp, color = Zk.colors.danger, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                    Divider()
                }
                if (a.routines.isEmpty()) item { Empty(rw(if (canMake) "routine.empty" else "routine.cannot_make"), Modifier.fillMaxWidth().padding(top = 24.dp)) }
                items(a.routines, key = { it.id }) { r ->
                    RoutineRow(r, a.timeZone, busy == r.id, canEdit = canMake, onEdit = { vm.clearFormError(); editing = r }, onToggle = { vm.toggle(r) })
                    Divider()
                }
            }
            if (making || editing != null) {
                RoutineForm(
                    routine = editing,
                    spaces = a.spaces,
                    timeZone = a.timeZone,
                    defaultDueTime = a.defaultDueTime,
                    vm = vm,
                    onClose = { making = false; editing = null },
                )
            }
        }
    }
}

@Composable
private fun RoutineRow(r: Routine, zone: String, busy: Boolean, canEdit: Boolean, onEdit: () -> Unit, onToggle: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(r.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
            if (!r.active) Text(
                rw("routine.paused"), fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.surface2).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
        // a line that starts with «لـ» and goes on with Latin names must still read right to left
        Text(RT.forLine(r), fontSize = 12.5.sp, color = Zk.colors.fgMuted, style = androidx.compose.material3.LocalTextStyle.current.copy(textDirection = androidx.compose.ui.text.style.TextDirection.Rtl))
        Text(RT.whenLine(r), fontSize = 12.5.sp, color = Zk.colors.fg)
        if (r.active) r.nextRunAt?.let { RT.whenLabel(it, zone) }?.let { Text(rw("routine.next", "when" to it), fontSize = 12.5.sp, color = Zk.colors.info) }
        r.stoppedReason?.let { RT.stopped(it) }?.let {
            Text(
                "⚠️ $it", fontSize = 12.5.sp, color = Zk.colors.fg, lineHeight = 18.sp,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Zk.colors.warn.copy(alpha = 0.10f))
                    .border(1.dp, Zk.colors.warn.copy(alpha = 0.4f), RoundedCornerShape(8.dp)).padding(8.dp),
            )
        }
        if (r.canManage) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            if (canEdit) TextButton(onClick = onEdit) { Text(rw("routine.edit"), color = Zk.colors.accent) }
            TextButton(enabled = !busy, onClick = onToggle) {
                Text(rw(if (r.active) "routine.pause" else "routine.resume"), color = if (r.active) Zk.colors.fg else Zk.colors.accent, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** The form of one routine (the site's routine-form.tsx): what, where, for whom, which days and the two times. The server decides again. */
@Composable
private fun RoutineForm(routine: Routine?, spaces: List<SpaceOption>, timeZone: String, defaultDueTime: String, vm: RoutinesViewModel, onClose: () -> Unit) {
    val saving by vm.saving.collectAsStateWithLifecycle()
    val formError by vm.formError.collectAsStateWithLifecycle()
    var title by remember { mutableStateOf(routine?.title.orEmpty()) }
    var description by remember { mutableStateOf(routine?.description.orEmpty()) }
    var spaceId by remember { mutableStateOf(spaces.firstOrNull { it.id == routine?.workspaceId }?.id ?: spaces.firstOrNull()?.id.orEmpty()) }
    var projectId by remember { mutableStateOf(routine?.projectId.orEmpty()) }
    var assigneeId by remember { mutableStateOf(routine?.assignee?.id.orEmpty()) }
    var preset by remember { mutableStateOf(routine?.let { RT.presetOf(it.days) } ?: "EVERY") }
    var custom by remember { mutableStateOf(routine?.days ?: emptyList()) }
    var time by remember { mutableStateOf(routine?.time ?: "08:00") }
    var dueTime by remember { mutableStateOf(routine?.dueTime ?: defaultDueTime) }
    val space = spaces.firstOrNull { it.id == spaceId }
    // a project or a person the chosen space does not hold is dropped, never sent
    val project = space?.projects?.firstOrNull { it.id == projectId }?.id ?: space?.projects?.firstOrNull()?.id.orEmpty()
    val person = space?.people?.firstOrNull { it.id == assigneeId }?.id.orEmpty()
    val days = RT.daysOf(preset, custom)
    fun submit() {
        RT.problem(title, person, days, time, dueTime)?.let { vm.showFormError(it); return }
        vm.save(
            routine?.id,
            RoutineInput(workspaceId = spaceId, projectId = project, title = title.trim(), description = description.trim().ifEmpty { null }, assigneeId = person, days = days, time = time, dueTime = dueTime),
            onDone = onClose,
        )
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxSize().background(Zk.colors.surface).imePadding()) {
            ZkBar(
                title = rw(if (routine == null) "routine.new" else "routine.edit_title"),
                start = { RoundIcon(Icons.Filled.Close, rw("routine.cancel"), onClick = onClose) },
                actions = { TextButton(enabled = !saving, onClick = { submit() }) { Text(rw("routine.save"), color = Zk.colors.accent, fontWeight = FontWeight.Bold) } },
            )
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it.take(200) }, label = { Text(rw("routine.field.title")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it.take(5000) }, label = { Text(rw("routine.field.description")) }, minLines = 2, modifier = Modifier.fillMaxWidth())
                if (spaces.size > 1) Picker(rw("routine.field.space"), spaceId, spaces.map { it.id to it.name }) { spaceId = it }
                Picker(rw("routine.field.project"), project, space?.projects.orEmpty().map { it.id to it.name }) { projectId = it }
                Picker(rw("routine.field.assignee"), person, listOf("" to rw("routine.field.assignee_pick")) + space?.people.orEmpty().map { it.id to it.name }) { assigneeId = it }
                Text(rw("routine.field.days"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    RT.PRESETS.forEach { p ->
                        Chip(RT.preset(p), preset == p) {
                            if (p == "CUSTOM" && custom.isEmpty()) custom = days
                            preset = p
                        }
                    }
                }
                if (preset == "CUSTOM") Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    RT.WEEK_ORDER.forEach { d -> Chip(RT.day(d), d in custom) { custom = if (d in custom) custom - d else custom + d } }
                }
                ClockPicker(rw("routine.field.time"), time) { time = it }
                ClockPicker(rw("routine.field.due"), dueTime) { dueTime = it }
                Text(rw("routine.zone", "zone" to timeZone), fontSize = 12.sp, color = Zk.colors.fgMuted)
                if (routine != null) Text(rw("routine.edit_hint"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                formError?.let { Text(it, fontSize = 13.sp, color = Zk.colors.danger) }
            }
        }
    }
}

