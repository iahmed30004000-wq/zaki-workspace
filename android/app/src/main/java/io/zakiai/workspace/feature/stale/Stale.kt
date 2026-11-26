package io.zakiai.workspace.feature.stale

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desk.DeskViewModel
import io.zakiai.workspace.feature.office.O
import io.zakiai.workspace.feature.projects.P
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.work.Screen
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import javax.inject.Inject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query

// ── the site's answer (src/lib/work/stale.ts) ────────────────────────────────────────────────────────────────

@Serializable
data class StaleTask(
    val id: String = "",
    val key: String = "",
    val title: String = "",
    val assigneeName: String? = null,
    val projectName: String = "",
    val spaceName: String = "",
    val idleDays: Int = 0,
    val automated: Boolean = false,
)

@Serializable
data class StaleProject(val projectId: String = "", val name: String = "", val spaceName: String = "", val tasks: List<StaleTask> = emptyList())

@Serializable
data class StalePerson(
    val key: String = "",
    val name: String? = null,
    val stale: Int = 0,
    val open: Int = 0,
    val projects: List<StaleProject> = emptyList(),
)

@Serializable
data class StaleOption(val id: String = "", val name: String = "")

@Serializable
data class StaleView(
    val days: Int = 14,
    val today: String = "",
    val total: Int = 0,
    val shown: Int = 0,
    val truncated: Boolean = false,
    val people: List<StalePerson> = emptyList(),
    val assignable: List<StaleOption> = emptyList(),
)

@Serializable
data class SweepBody(val action: String, val taskIds: List<String>, val assigneeId: String? = null, val day: String? = null)

@Serializable
data class SweepResult(val done: Int = 0, val requested: Int = 0, val refused: Int = 0)

/** The two routes of «مهام قديمة» (GET / POST /api/work/stale): the owner and the people who run a space only (the server decides). */
interface StaleApi {
    @GET("api/work/stale")
    suspend fun list(@Query("days") days: Int?, @Header("Cache-Control") cache: String = "no-store"): StaleView

    @POST("api/work/stale")
    suspend fun sweep(@Body body: SweepBody): SweepResult
}

// ── the words (stale.*) and the rules ─────────────────────────────────────────────────────────────────────────

object S {
    const val title = "مهام قديمة"
    const val subtitle = "مهام مفتوحة ما حدا لمسها من فترة: راجعها وسكّرها أو عيّن لها مسؤول أو أجّلها أو أرشفها، وما بينحذف شي"
    val DAYS = listOf(7, 14, 30, 60, 90)
    fun daysOption(n: Int) = "$n يوم"
    fun count(n: Int) = "$n مهمة قديمة"
    fun truncated(shown: Int, total: Int) = "بنعرض $shown من $total، الأقدم أول"
    const val nobody = "بدون مسؤول"
    fun personCounts(stale: Int, open: Int) = "$stale قديمة من $open مفتوحة"
    fun idle(n: Int) = "$n يوم بدون لمس"
    const val auto = "آلي"
    const val selectAll = "اختر الكل"
    const val selectNone = "ألغِ الاختيار"
    fun selected(n: Int) = "$n مختارة"
    const val close = "سكّريها"
    const val assign = "عيّني مسؤول"
    const val postpone = "أجّليها لتاريخ"
    const val archive = "أرشفيها"
    const val apply = "نفّذ"
    const val cancel = "إلغاء"
    const val pickPerson = "اختر شخص"
    fun confirm(action: String, n: Int) = when (action) {
        "close" -> "رح تنسكّر $n مهمة وبتنتقل لعمود الإنجاز."
        "assign" -> "رح تنعطى $n مهمة للشخص المختار، وإذا رتبته أعلى منك بيوصله طلب بدل ما تنعطى له."
        "postpone" -> "رح يتأجّل موعد $n مهمة للتاريخ المختار."
        else -> "رح تنحط $n مهمة بالأرشيف، وما بينحذف شي: بتقدر ترجّعها."
    }
    /** The result line (stale.result.*): what was done, what became a request, what was refused. Pure (tested). */
    fun result(r: SweepResult): String = listOfNotNull(
        if (r.done > 0) "تمّت ${r.done} مهمة" else null,
        if (r.requested > 0) "${r.requested} مهمة انبعت طلب إسناد بشأنها لأن الشخص رتبته أعلى منك، وضلّت عند صاحبها" else null,
        if (r.refused > 0) "${r.refused} مهمة انرفضت، والباقي تنفّذ" else null,
    ).joinToString("\n")
    const val emptyTitle = "ما في مهام قديمة"
    fun emptyHint(n: Int) = "كل المهام المفتوحة انلمست خلال آخر $n يوم"
}

// ── the screen ────────────────────────────────────────────────────────────────────────────────────────────────

@HiltViewModel
class StaleViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskViewModel<StaleView>(session) {
    private val api = retrofit.create(StaleApi::class.java)
    private var job: Job? = null

    fun refresh(days: Int) {
        job?.cancel()
        job = viewModelScope.launch { load { api.list(days) } }
    }

    private var sweeping = false

    /** one bulk action at a time: a double tap never runs it twice */
    fun sweep(body: SweepBody, days: Int, done: () -> Unit) = viewModelScope.launch {
        if (sweeping) return@launch
        sweeping = true
        try {
            when (val r = apiCall { api.sweep(body) }) {
                is ApiResult.Ok -> { done(); say(S.result(r.value)); refresh(days) }
                is ApiResult.Err -> say(r.failure.message)
            }
        } finally {
            sweeping = false
        }
    }
}

/**
 * «مهام قديمة» (src/components/work/stale/stale-view.tsx): untouched for 7 · 14 · 30 · 60 · 90 days, grouped by person then project, the oldest
 * first; pick tasks (or all of a person's), then «سكّريها» · «عيّني مسؤول» · «أجّليها لتاريخ» · «أرشفيها» with the site's own confirmation —
 * nothing is deleted. The server answers who may: a person who runs no space gets its sentence.
 */
@Composable
fun StaleScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, vm: StaleViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    var days by rememberSaveable { mutableStateOf(14) }
    val picked = remember { mutableListOf<String>().toMutableStateList() }
    var action by rememberSaveable { mutableStateOf<String?>(null) }
    var who by rememberSaveable { mutableStateOf<String?>(null) }
    var day by rememberSaveable { mutableStateOf<String?>(null) }
    WhileOnScreen(120_000, days) { vm.refresh(days) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val data = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = S.title, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                data == null && state.failure == null -> Loading()
                data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(days) })
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 140.dp)) {
                    item(key = "head") {
                        Text(S.subtitle, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            S.DAYS.forEach { n -> Pill(S.daysOption(n), days == n) { days = n; picked.clear() } }
                        }
                        Text(
                            listOfNotNull(S.count(data.total), if (data.truncated) S.truncated(data.shown, data.total) else null).joinToString(" · "),
                            fontSize = 13.sp,
                            color = Zk.colors.fg,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                    if (data.people.isEmpty()) item(key = "empty") { QuietEmpty(S.emptyTitle, S.emptyHint(data.days)) }
                    data.people.forEach { person ->
                        val ids = person.projects.flatMap { p -> p.tasks.map { it.id } }
                        item(key = "p-" + person.key) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(person.name ?: S.nobody, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                                    Text(S.personCounts(person.stale, person.open), fontSize = 12.sp, color = Zk.colors.fgMuted)
                                }
                                val all = ids.all { it in picked }
                                TextButton(onClick = { if (all) picked.removeAll(ids) else picked.addAll(ids.filter { it !in picked }) }) {
                                    Text(if (all) S.selectNone else S.selectAll, color = Zk.colors.accent, fontSize = 13.sp)
                                }
                            }
                        }
                        person.projects.forEach { project ->
                            item(key = "h-${person.key}-${project.projectId}") {
                                Text("${project.name} · ${project.spaceName}", fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp))
                            }
                            items(project.tasks, key = { "t-${person.key}-${it.id}" }) { t ->
                                Row(Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = t.id in picked,
                                        onCheckedChange = { on -> if (on) picked.add(t.id) else picked.remove(t.id) },
                                        colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent),
                                    )
                                    Column(Modifier.weight(1f)) {
                                        Text("${t.key} ${t.title}", fontSize = 14.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        Text(listOfNotNull(S.idle(t.idleDays), if (t.automated) S.auto else null).joinToString(" · "), fontSize = 12.sp, color = Zk.colors.warn)
                                    }
                                }
                                HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(start = 56.dp))
                            }
                        }
                    }
                }
            }
            // the bar of the picked tasks: the four actions
            if (picked.isNotEmpty() && data != null) Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Zk.colors.surface1).padding(10.dp)) {
                Text(S.selected(picked.size), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("close" to S.close, "assign" to S.assign, "postpone" to S.postpone, "archive" to S.archive).forEach { (k, label) -> Pill(label, false) { action = k } }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    val a = action
    if (a != null && data != null) AlertDialog(
        onDismissRequest = { action = null },
        containerColor = Zk.colors.surface1,
        title = { Text(when (a) { "close" -> S.close; "assign" -> S.assign; "postpone" -> S.postpone; else -> S.archive }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(S.confirm(a, picked.size), fontSize = 14.sp, color = Zk.colors.fg)
                if (a == "assign") {
                    var open by remember { mutableStateOf(false) }
                    Box {
                        Pill(data.assignable.firstOrNull { it.id == who }?.name ?: S.pickPerson, who != null) { open = true }
                        DropdownMenu(open, { open = false }) {
                            data.assignable.forEach { p -> DropdownMenuItem(text = { Text(p.name) }, onClick = { who = p.id; open = false }) }
                        }
                    }
                }
                if (a == "postpone") {
                    // the calendar's own month (the system picker speaks the phone's language); never before today
                    io.zakiai.workspace.feature.office.MonthDayPicker(start = day ?: data.today, earliest = data.today) { day = it }
                    day?.let { Text(P.dmy(it + "T12:00:00Z") ?: it, fontSize = 13.sp, color = Zk.colors.accent) }
                }
            }
        },
        confirmButton = {
            val ready = when (a) { "assign" -> who != null; "postpone" -> day != null; else -> true }
            TextButton(enabled = ready, onClick = {
                vm.sweep(SweepBody(a, picked.toList(), assigneeId = if (a == "assign") who else null, day = if (a == "postpone") day else null), days) {
                    picked.clear(); action = null; who = null; day = null
                }
            }) { Text(S.apply) }
        },
        dismissButton = { TextButton(onClick = { action = null }) { Text(S.cancel) } },
    )
}

@Composable
private fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}
