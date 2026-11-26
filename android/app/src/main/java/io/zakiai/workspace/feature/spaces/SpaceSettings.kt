package io.zakiai.workspace.feature.spaces

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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import javax.inject.Inject

/*
 * «إعدادات المساحة» (M2 N6 batch 11) — one space's settings as the site's page draws them (GET /api/spaces/[id]/settings, `spaceSettingsFor`): «عام»
 * (name, description, emoji; the layout shown), «الناس» (add, remove, promote), «المقاطع» (teams, their people, their lead), «الدردشة» and «الشغل»
 * (shown). The tab «خطر» (archive, delete) is NOT on the phone: archiving is on «كل المساحات», deleting stays the site's page (marked). Every control
 * is the site's own route, and the server decides again.
 */

@Serializable
data class Facts(val external: Boolean = false, val manager: Boolean = false, val canArchive: Boolean = false, val canDelete: Boolean = false)

@Serializable
data class Starter(val title: String = "", val emoji: String = "", val postingPolicy: String = "ALL")

@Serializable
data class BoardColumn(val name: String = "", val stage: String = "")

@Serializable
data class Parts(val checkins: Boolean = false, val customFields: Boolean = false, val approvals: Boolean = false)

@Serializable
data class WorkPart(val timeZone: String = "", val columns: List<BoardColumn> = emptyList(), val stagesOn: Boolean = false, val parts: Parts = Parts())

@Serializable
data class SpaceSettingsAnswer(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val emoji: String? = null,
    val layout: String = "STANDARD",
    val department: Boolean = false,
    val facts: Facts = Facts(),
    val tabs: List<String> = emptyList(),
    val starters: List<Starter> = emptyList(),
    val work: WorkPart = WorkPart(),
)

@Serializable
data class SpaceMember(val id: String = "", val name: String = "", val role: String? = null)

@Serializable
data class MembersAnswer(val members: List<SpaceMember> = emptyList(), val canManage: Boolean = false)

@Serializable
data class DirUser(val id: String = "", val name: String = "")

@Serializable
data class DirPerson(val userId: String = "", val user: DirUser = DirUser())

@Serializable
data class DirectoryAnswer(val people: List<DirPerson> = emptyList())

@Serializable
data class TeamMember(val id: String = "", val name: String = "")

@Serializable
data class Team(val id: String = "", val name: String = "", val description: String? = null, val leadId: String? = null, val members: List<TeamMember> = emptyList(), val projects: Int = 0, val mine: Boolean = false)

@Serializable
data class TeamsAnswer(val teams: List<Team> = emptyList(), val canManage: Boolean = false)

@Serializable
data class MembersBody(val addUserIds: List<String>? = null, val removeUserIds: List<String>? = null, val promoteUserIds: List<String>? = null, val demoteUserIds: List<String>? = null)

@Serializable
data class TeamName(val name: String)

@Serializable
data class TeamPeople(val add: List<String>? = null, val remove: List<String>? = null)

interface SpaceSettingsApi {
    @GET("api/spaces/{id}/settings")
    suspend fun settings(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): SpaceSettingsAnswer

    /** name and description, or the emoji (a null emoji clears it, so the body is written by hand) */
    @PATCH("api/workspaces/{id}")
    suspend fun patch(@Path("id") id: String, @Body body: JsonObject): JsonObject

    @GET("api/workspaces/{id}/members")
    suspend fun members(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): MembersAnswer

    @GET("api/chat/directory")
    suspend fun directory(): DirectoryAnswer

    @POST("api/workspaces/{id}/members")
    suspend fun setMembers(@Path("id") id: String, @Body body: MembersBody): JsonObject

    @GET("api/workspaces/{id}/teams")
    suspend fun teams(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): TeamsAnswer

    @POST("api/workspaces/{id}/teams")
    suspend fun newTeam(@Path("id") id: String, @Body body: TeamName): JsonObject

    @POST("api/workspaces/{id}/teams/{team}/members")
    suspend fun teamPeople(@Path("id") id: String, @Path("team") team: String, @Body body: TeamPeople): JsonObject

    @PATCH("api/workspaces/{id}/teams/{team}")
    suspend fun teamLead(@Path("id") id: String, @Path("team") team: String, @Body body: JsonObject): JsonObject

    @DELETE("api/workspaces/{id}/teams/{team}")
    suspend fun deleteTeam(@Path("id") id: String, @Path("team") team: String): JsonObject
}

/** Pure pieces (SpacesTest pins them). */
object SS {
    const val deleteWarn = "⚠️ أرشفة المساحة من «كل المساحات»، وحذفها لسا من صفحة الموقع."
    const val deleteFix = "🔧 الحذف بيمسح المساحة مع شغلها، فبيضل على الموقع مع تأكيد بكتابة اسمها."
    const val removedWarn = "⚠️ إذا كان للشخص اللي شلته مهام مفتوحة هون، تسليمها لغيره لسا من صفحة الموقع."
    const val removedFix = "🔧 افتح «إعدادات المساحة» على الموقع، تبويب «الناس»، وسلّم مهامه."
    const val goSite = "افتح على الموقع"

    /** the phone's tabs: the site's, without «خطر» */
    fun tabsOf(a: SpaceSettingsAnswer): List<String> = a.tabs.filter { it != "danger" }

    fun roleWord(role: String?): String? = when (role) {
        "ADMIN" -> w("ws.role_admin")
        "GUEST" -> w("ws.role_guest")
        "MEMBER" -> w("ws.role_member")
        else -> null
    }

    /** the company's people who are not in the space yet: the ones «أضف» offers */
    fun addable(members: List<SpaceMember>, directory: List<DirPerson>): List<DirPerson> {
        val inSpace = members.map { it.id }.toSet()
        return directory.filter { it.userId !in inSpace }
    }

    /** an emoji, written by hand: `null` clears it */
    fun emojiBody(emoji: String?): JsonObject = JsonObject(mapOf("emoji" to (emoji?.let(::JsonPrimitive) ?: JsonNull)))

    fun leadBody(leadId: String?): JsonObject = JsonObject(mapOf("leadId" to (leadId?.let(::JsonPrimitive) ?: JsonNull)))
}

@HiltViewModel
class SpaceSettingsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session, saved: SavedStateHandle) : ViewModel() {
    private val api = retrofit.create(SpaceSettingsApi::class.java)
    val id: String = saved.get<String>("id").orEmpty()
    private val _data = MutableStateFlow<SpaceSettingsAnswer?>(null)
    val data: StateFlow<SpaceSettingsAnswer?> = _data.asStateFlow()
    private val _members = MutableStateFlow<MembersAnswer?>(null)
    val members: StateFlow<MembersAnswer?> = _members.asStateFlow()
    private val _directory = MutableStateFlow<List<DirPerson>>(emptyList())
    val directory: StateFlow<List<DirPerson>> = _directory.asStateFlow()
    private val _teams = MutableStateFlow<TeamsAnswer?>(null)
    val teams: StateFlow<TeamsAnswer?> = _teams.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _removed = MutableStateFlow(false)
    /** somebody was taken out of the space in this visit: the handover of their open work is still the site's */
    val removed: StateFlow<Boolean> = _removed.asStateFlow()

    fun consumeNotice() { _notice.value = null }

    private suspend fun <T> read(call: suspend () -> T): T? = when (val r = apiCall { call() }) {
        is ApiResult.Ok -> { _failure.value = null; r.value }
        is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure; null }
    }

    fun refresh() = viewModelScope.launch {
        val s = read { api.settings(id) } ?: return@launch
        _data.value = s
        loadPeople()
    }

    private suspend fun loadPeople() {
        val m = read { api.members(id) } ?: return
        _members.value = m
        if (m.canManage) read { api.directory() }?.let { _directory.value = it.people }
        read { api.teams(id) }?.let { _teams.value = it }
    }

    private fun act(call: suspend () -> Any, sentence: String?, then: () -> Unit = {}) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let { _notice.value = it }; then(); refresh() }
                is ApiResult.Err -> {
                    if (r.failure.signedOut) session.expired(r.failure)
                    _notice.value = (r.failure.detail ?: r.failure.key)?.let { SpaceWords.all[it] } ?: r.failure.message
                }
            }
        } finally {
            _busy.value = false
        }
    }

    fun rename(name: String, description: String, done: () -> Unit) =
        act({ api.patch(id, JsonObject(mapOf("name" to JsonPrimitive(name.trim()), "description" to (description.trim().ifBlank { null }?.let(::JsonPrimitive) ?: JsonNull)))) }, w("ws.renamed"), done)
    fun emoji(value: String?) = act({ api.patch(id, SS.emojiBody(value?.trim())) }, w("spset.general.emoji_saved"))
    fun add(userId: String) = act({ api.setMembers(id, MembersBody(addUserIds = listOf(userId))) }, null)
    fun remove(userId: String) = act({ api.setMembers(id, MembersBody(removeUserIds = listOf(userId))) }, null) { _removed.value = true }
    fun promote(userId: String) = act({ api.setMembers(id, MembersBody(promoteUserIds = listOf(userId))) }, null)
    fun demote(userId: String) = act({ api.setMembers(id, MembersBody(demoteUserIds = listOf(userId))) }, null)
    fun newTeam(name: String, done: () -> Unit) = act({ api.newTeam(id, TeamName(name.trim())) }, null, done)
    fun teamAdd(t: Team, userId: String) = act({ api.teamPeople(id, t.id, TeamPeople(add = listOf(userId))) }, null)
    fun teamRemove(t: Team, userId: String) = act({ api.teamPeople(id, t.id, TeamPeople(remove = listOf(userId))) }, null)
    fun lead(t: Team, leadId: String?) = act({ api.teamLead(id, t.id, SS.leadBody(leadId)) }, w("teamlead.saved"))
    fun deleteTeam(t: Team, done: () -> Unit) = act({ api.deleteTeam(id, t.id) }, null, done)
}

@Composable
private fun Section(title: String, hint: String? = null) = Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp)) {
    Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
    hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
}

@Composable
private fun Small(text: String, color: Color = Zk.colors.fgMuted) = Text(text, fontSize = 12.5.sp, color = color, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))

@Composable
private fun Divider() = HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))

@Composable
private fun Act(label: String, enabled: Boolean, color: Color = Zk.colors.accent, onClick: () -> Unit) =
    TextButton(enabled = enabled, onClick = onClick) { Text(label, color = if (enabled) color else Zk.colors.fgMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) = Text(
    label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
    color = if (on) Zk.colors.accentFg else Zk.colors.fg,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
)

/**
 * «إعدادات المساحة» (src/app/(app)/spaces/[id]/settings): the tabs the server offers this person, without «خطر». A plain member reads the people and the
 * teams; the space's manager changes them, and the name, description and emoji.
 */
@Composable
fun SpaceSettingsScreen(onBack: () -> Unit, onOpenSite: (String) -> Unit, onEnter: (String, String) -> Unit, onOpenDepartments: () -> Unit, vm: SpaceSettingsViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val members by vm.members.collectAsStateWithLifecycle()
    val directory by vm.directory.collectAsStateWithLifecycle()
    val teams by vm.teams.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val removed by vm.removed.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    var naming by remember { mutableStateOf(false) }
    var dropping by remember { mutableStateOf<Team?>(null) }
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val d = data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = w("spset.title") + (d?.let { " · " + S.title(it.name, it.emoji) } ?: ""), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            val f = failure
            when {
                d == null && f != null -> if (f.status == 404) Empty(w("workspace.not_found")) else Failure(f.message, onRetry = { vm.refresh() })
                d == null -> Loading()
                else -> {
                    val tabs = SS.tabsOf(d)
                    val here = tab?.takeIf { it in tabs } ?: tabs.firstOrNull()
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                        item(key = "tabs") {
                            Small(w("spset.hint"))
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                tabs.forEach { k -> Chip(SpaceWords.all["spset.tab.$k"] ?: k, here == k) { tab = k } }
                            }
                        }
                        when (here) {
                            "general" -> general(d, busy, onOpenDepartments, { editing = true }) { vm.emoji(it) }
                            "people" -> people(members, directory, busy, removed, onOpenSite, vm)
                            "teams" -> teams(teams, members, busy, vm, { naming = true }) { dropping = it }
                            "chat" -> chat(d)
                            "work" -> work(d, onOpenSite, onEnter)
                        }
                        if (d.facts.canArchive || d.facts.canDelete) item(key = "danger") { Column(Modifier.fillMaxWidth().padding(12.dp)) { WarnFix(SS.deleteWarn, SS.deleteFix) } }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    val s = d ?: return
    if (editing) {
        var name by remember { mutableStateOf(s.name) }
        var desc by remember { mutableStateOf(s.description.orEmpty()) }
        AlertDialog(
            onDismissRequest = { editing = false },
            containerColor = Zk.colors.surface1,
            title = { Text(w("ws.editTitle")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(name, { name = it.take(80) }, label = { Text(w("ws.name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(desc, { desc = it.take(300) }, label = { Text(w("ws.desc")) }, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = { TextButton(enabled = !busy && name.trim().length >= 2, onClick = { vm.rename(name, desc) { editing = false } }) { Text(S.save) } },
            dismissButton = { TextButton(onClick = { editing = false }) { Text(S.cancel) } },
        )
    }
    if (naming) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { naming = false },
            containerColor = Zk.colors.surface1,
            title = { Text(w("spaceteams.create")) },
            text = { OutlinedTextField(name, { name = it.take(80) }, placeholder = { Text(w("spaceteams.new_name")) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(enabled = !busy && name.isNotBlank(), onClick = { vm.newTeam(name) { naming = false } }) { Text(w("spaceteams.create")) } },
            dismissButton = { TextButton(onClick = { naming = false }) { Text(S.cancel) } },
        )
    }
    dropping?.let { t ->
        AlertDialog(
            onDismissRequest = { dropping = null },
            containerColor = Zk.colors.surface1,
            title = { Text(w("spaceteams.delete", "name" to t.name)) },
            text = { Text(w("spaceteams.projects_count", "n" to t.projects), fontSize = 13.sp, color = Zk.colors.fgMuted) },
            confirmButton = { TextButton(enabled = !busy, onClick = { vm.deleteTeam(t) { dropping = null } }) { Text(w("spaceteams.delete", "name" to t.name), color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { dropping = null }) { Text(S.cancel) } },
        )
    }
}

private fun LazyListScope.general(d: SpaceSettingsAnswer, busy: Boolean, onOpenDepartments: () -> Unit, onEdit: () -> Unit, onEmoji: (String?) -> Unit) {
    item(key = "general") {
        Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(w("ws.name") + ": " + "⁨${d.name}⁩", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
            Text(w("ws.desc") + ": " + (d.description?.let { "⁨$it⁩" } ?: w("spset.general.none")), fontSize = 13.sp, color = Zk.colors.fg)
            Text(w("cards.space_type") + ": " + (SpaceWords.all["cards.space_type.${d.layout}"] ?: d.layout), fontSize = 13.sp, color = Zk.colors.fg)
            Text(w("spset.general.layout_hint"), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
            if (d.department) {
                Text(w("spset.general.dept"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                Act(w("spaces.dept.go"), true, onClick = onOpenDepartments)
            } else Act(w("ws.editTitle"), !busy, onClick = onEdit)
        }
        var draft by remember(d.emoji) { mutableStateOf(d.emoji.orEmpty()) }
        Section(w("spset.general.emoji"), w("spset.general.emoji_hint"))
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(draft, { draft = it.take(16) }, singleLine = true, modifier = Modifier.width(110.dp))
            Act(w("spset.general.emoji_save"), !busy && draft.isNotBlank() && draft.trim() != d.emoji.orEmpty()) { onEmoji(draft) }
            if (d.emoji != null) Act(w("spset.general.emoji_clear"), !busy, Zk.colors.fgMuted) { onEmoji(null) }
        }
    }
}

private fun LazyListScope.people(m: MembersAnswer?, directory: List<DirPerson>, busy: Boolean, removed: Boolean, onOpenSite: (String) -> Unit, vm: SpaceSettingsViewModel) {
    item(key = "people") {
        Small(w("spset.people.hint"))
        if (m == null) { Loading(); return@item }
        if (m.members.isEmpty()) Small(w("spaces.no_people"))
        m.members.forEach { p ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(p.name, fontSize = 14.5.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                SS.roleWord(p.role)?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 6.dp)) }
                if (m.canManage && p.role == "MEMBER") Act(w("ws.promote"), !busy) { vm.promote(p.id) }
                if (m.canManage && p.role == "ADMIN") Act(w("ws.demote"), !busy, Zk.colors.fgMuted) { vm.demote(p.id) }
                if (m.canManage) Act(w("ws.removeMember"), !busy, Zk.colors.danger) { vm.remove(p.id) }
            }
            Divider()
        }
        if (removed) {
            Column(Modifier.fillMaxWidth().padding(12.dp)) { WarnFix(SS.removedWarn, SS.removedFix) }
            Act(SS.goSite, true) { onOpenSite("/spaces/" + vm.id + "/settings?tab=people") }
        }
        if (m.canManage) {
            Section(w("ws.addMembers"))
            val addable = SS.addable(m.members, directory)
            if (addable.isEmpty()) Small(w("ws.everyoneIn"))
            addable.forEach { p ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(p.user.name, fontSize = 13.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f))
                    Act("+ " + w("ws.add"), !busy) { vm.add(p.userId) }
                }
            }
        }
    }
}

private fun LazyListScope.teams(t: TeamsAnswer?, m: MembersAnswer?, busy: Boolean, vm: SpaceSettingsViewModel, onNew: () -> Unit, onDrop: (Team) -> Unit) {
    item(key = "teams") {
        Small(w("spaceteams.hint"))
        if (t == null) { Loading(); return@item }
        if (t.canManage) Small(w("teamlead.hint"))
        if (t.teams.isEmpty()) Small(w("spaceteams.none"))
        t.teams.forEach { team ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("⁨${team.name}⁩", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Text(w("spaceteams.projects_count", "n" to team.projects), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    if (t.canManage) Act(w("spaceteams.delete", "name" to "").trim(), !busy, Zk.colors.danger) { onDrop(team) }
                }
                if (team.members.isEmpty()) Text(w("spaceteams.no_members"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    team.members.forEach { p -> Chip(p.name + if (t.canManage) "  ✕" else "", false) { if (t.canManage && !busy) vm.teamRemove(team, p.id) } }
                }
                if (team.members.isNotEmpty() && (t.canManage || team.leadId != null)) {
                    val leadName = team.members.firstOrNull { it.id == team.leadId }?.name ?: w("teamlead.none")
                    if (t.canManage) {
                        var open by remember(team.id) { mutableStateOf(false) }
                        Box {
                            Chip(w("teamlead.label") + ": " + leadName, true) { open = true }
                            DropdownMenu(open, { open = false }) {
                                DropdownMenuItem(text = { Text(w("teamlead.none")) }, onClick = { open = false; if (team.leadId != null) vm.lead(team, null) })
                                team.members.forEach { p -> DropdownMenuItem(text = { Text(p.name) }, onClick = { open = false; if (team.leadId != p.id) vm.lead(team, p.id) }) }
                            }
                        }
                    } else Text(w("teamlead.label") + ": " + leadName, fontSize = 12.5.sp, color = Zk.colors.fg)
                }
                if (t.canManage) {
                    val inTeam = team.members.map { it.id }.toSet()
                    val addable = m?.members.orEmpty().filter { it.id !in inTeam }
                    if (addable.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        addable.forEach { p -> Text("+ " + p.name, fontSize = 12.5.sp, color = Zk.colors.accent, modifier = Modifier.clickable(enabled = !busy) { vm.teamAdd(team, p.id) }.padding(horizontal = 6.dp, vertical = 4.dp)) }
                    }
                }
            }
            Divider()
        }
        if (t.canManage) Act("+ " + w("spaceteams.create"), !busy, onClick = onNew)
    }
}

private fun LazyListScope.chat(d: SpaceSettingsAnswer) {
    item(key = "chat") {
        Section(w("spset.chat.starters"), w("spset.chat.starters_hint"))
        d.starters.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(s.emoji + "  ⁨" + s.title + "⁩", fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                Text(SpaceWords.all["spset.chat.policy.${s.postingPolicy}"] ?: s.postingPolicy, fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
        }
        Section(w("spset.chat.who_opens"))
        Small(w("spset.chat.who_opens_body"), Zk.colors.fg)
        Small(w("spset.chat.fixed"))
    }
}

private fun LazyListScope.work(d: SpaceSettingsAnswer, onOpenSite: (String) -> Unit, onEnter: (String, String) -> Unit) {
    item(key = "work") {
        Section(w("spset.work.columns"), w("spset.work.columns_hint"))
        d.work.columns.forEach { c ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Text("⁨${c.name}⁩", fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                if (d.work.stagesOn) Text(w("spset.work.stage") + ": " + (SpaceWords.all["enum.WorkStage.${c.stage}"] ?: c.stage), fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
        }
        if (!d.work.stagesOn) Small(w("spset.work.stage_off"))
        val p = d.work.parts
        if (p.customFields) { Section(w("spset.work.fields"), w("spset.work.fields_hint")); Act(w("spset.work.fields_go"), true) { onEnter(d.id, "/projects") } }
        if (p.approvals) { Section(w("spset.work.approvals"), w("spset.work.approvals_hint")); Act(w("spset.work.approvals_go"), true) { onEnter(d.id, "/approvals/forms") } }
        if (p.checkins) { Section(w("spset.work.checkins"), w("spset.work.checkins_hint")); Act(SS.goSite, true) { onOpenSite("/spaces/" + d.id + "/settings?tab=work") } }
    }
}

