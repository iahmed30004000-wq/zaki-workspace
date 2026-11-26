package io.zakiai.workspace.feature.watch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.feature.desk.DeskViewModel
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import javax.inject.Inject

// ── the site's answers (src/server/services/watch.ts) ────────────────────────────────────────────────────────

@Serializable
data class WatchHost(val id: String = "", val name: String = "")

@Serializable
data class WatchRow(
    val id: String = "",
    val title: String = "",
    val kind: String = "",
    val pageUrl: String = "",
    val thumbUrl: String = "",
    val host: WatchHost = WatchHost(),
    val peopleCount: Int = 0,
    val live: Boolean = false,
    val createdAt: String = "",
    val endedAt: String? = null,
    val conversationId: String = "",
)

@Serializable
data class WatchPerson(val id: String = "", val name: String = "")

@Serializable
data class WatchHomeAnswer(val spaceId: String? = null, val sessions: List<WatchRow> = emptyList(), val candidates: List<WatchPerson> = emptyList(), val canStart: Boolean = false)

@Serializable
data class WatchCan(val end: Boolean = false)

@Serializable
data class WatchDetail(
    val id: String = "",
    val title: String = "",
    val pageUrl: String = "",
    val thumbUrl: String = "",
    val host: WatchHost = WatchHost(),
    val peopleCount: Int = 0,
    val live: Boolean = false,
    val createdAt: String = "",
    val conversationId: String = "",
    val people: List<WatchPerson> = emptyList(),
    val can: WatchCan = WatchCan(),
)

@Serializable
data class WatchDetailAnswer(val session: WatchDetail = WatchDetail())

@Serializable
data class StartBody(val url: String, val title: String? = null, val memberIds: List<String>, val everyone: Boolean)

@Serializable
data class Started(val id: String = "", val conversationId: String = "")

/** «نتفرّج سوا»: the phone's door (`GET /api/watch/home`) and the site's own routes of a session. */
interface WatchApi {
    @GET("api/watch/home")
    suspend fun home(@Header("Cache-Control") cache: String = "no-store"): WatchHomeAnswer

    @POST("api/watch")
    suspend fun start(@Body body: StartBody): Started

    @GET("api/watch/{id}")
    suspend fun session(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): WatchDetailAnswer

    @POST("api/watch/{id}/end")
    suspend fun end(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): JsonObject
}

// ── the words (ar.watch.json) and the rules ───────────────────────────────────────────────────────────────────

object V {
    const val title = "نتفرّج سوا"
    const val subtitle = "الصق رابط فيديو، اختار مين بدّه يتفرّج معك، وتفرّجوا واحكوا عنه سوا."
    const val startHeading = "ابدأ جلسة"
    const val link = "رابط الفيديو"
    const val linkPh = "الصق رابط يوتيوب هون"
    const val linkBad = "هالرابط ما بيشتغل هون. هلّق روابط يوتيوب بس."
    const val linkOk = "تمام، هالفيديو بيشتغل."
    const val name = "اسم الجلسة (إذا بدك)"
    const val namePh = "بنجيب اسم الفيديو لحاله"
    const val who = "مين بدّه يتفرّج معك؟"
    const val everyone = "كل ناس المساحة"
    const val search = "دوّر على اسم"
    const val nobodyHere = "ما في حدا تاني بهالمساحة لسا."
    fun picked(n: Int) = "اخترت $n"
    const val pickSomeone = "اختار حدا واحد على الأقل، أو «كل ناس المساحة»."
    const val go = "يلا نتفرّج"
    const val live = "شغّالة هلّق"
    const val endedLabel = "خلصت"
    const val empty = "ما في جلسات لسا. الصق رابط فوق وابدأ أول وحدة."
    fun people(n: Int) = "$n ناس"
    /** who started it, and how many: the name isolated, so a Latin name never reorders the Arabic line around it */
    fun byLine(host: String, n: Int) = "⁨$host⁩ · " + people(n)
    const val openTalk = "الكلام والمكالمة"
    const val openSite = "افتح على يوتيوب"
    const val end = "خلّص الجلسة"
    const val endConfirm = "بدك تخلّص الجلسة؟ الكلام اللي انحكى بيضل محفوظ."
    const val ended = "خلصت هالجلسة. الكلام اللي انحكى فيها محفوظ بالدردشة."
    const val cancel = "لا"
    const val together = "تفرّجوا سوا"
    const val roomWarn = "⚠️ المشاهدة المتزامنة بتنفتح بصفحة الموقع جوّا التطبيق، لأنه الفيديو بيشتغل بمشغّل يوتيوب نفسه والريموت بيزبط الكل على نفس اللحظة."
    const val roomFix = "🔧 الكلام والمكالمة، ومين بالجلسة، وإنهاؤها، كلهم هون بالتطبيق."

    /** Only YouTube links play here today (src/lib/watch/source.ts): said before it is sent, the server decides again. */
    fun looksPlayable(url: String): Boolean {
        val u = runCatching { java.net.URI(url.trim()) }.getOrNull() ?: return false
        val host = u.host?.lowercase()?.removePrefix("www.")?.removePrefix("m.") ?: return false
        return (u.scheme == "https" || u.scheme == "http") && (host == "youtube.com" || host == "youtu.be" || host == "music.youtube.com")
    }

    /** Live sessions first, then the newest (the site's order). */
    fun ordered(rows: List<WatchRow>): List<WatchRow> = rows.sortedWith(compareByDescending<WatchRow> { it.live }.thenByDescending { it.createdAt })
}

// ── the screens ───────────────────────────────────────────────────────────────────────────────────────────────

@HiltViewModel
class WatchHomeViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskViewModel<WatchHomeAnswer>(session) {
    private val api = retrofit.create(WatchApi::class.java)
    private var job: Job? = null
    fun refresh() { job?.cancel(); job = viewModelScope.launch { load { api.home() } } }

    fun start(url: String, title: String, everyone: Boolean, ids: List<String>, opened: (String) -> Unit) = viewModelScope.launch {
        if (!V.looksPlayable(url)) { say(V.linkBad); return@launch }
        if (!everyone && ids.isEmpty()) { say(V.pickSomeone); return@launch }
        var made: String? = null
        act({ api.start(StartBody(url.trim(), title.trim().ifBlank { null }, if (everyone) emptyList() else ids, everyone)).id.also { made = it } }) {
            made?.let(opened); refresh()
        }
    }
}

/** «نتفرّج سوا» of the space (src/components/watch/watch-home.tsx): the sessions, live first, and «ابدأ جلسة» for who may. */
@Composable
fun WatchHomeScreen(onOpen: (String) -> Unit, spaceKey: String?, vm: WatchHomeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var starting by rememberSaveable { mutableStateOf(false) }
    WhileOnScreen(30_000, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val data = state.data
    Box(Modifier.fillMaxSize().background(Zk.colors.surface)) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                item(key = "head") { Text(V.subtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) }
                if (data.sessions.isEmpty()) item(key = "empty") { QuietEmpty(V.title, V.empty) }
                items(V.ordered(data.sessions), key = { it.id }) { s -> SessionRow(s) { onOpen(s.id) } }
            }
        }
        if (data?.canStart == true) RoundFab(Icons.Filled.Add, V.startHeading, Modifier.align(Alignment.BottomEnd).padding(18.dp)) { starting = true }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    val d = data
    if (starting && d != null) StartDialog(d.candidates, busy, onClose = { starting = false }) { url, title, everyone, ids ->
        vm.start(url, title, everyone, ids) { id -> starting = false; onOpen(id) }
    }
}

@Composable
private fun SessionRow(s: WatchRow, onOpen: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(model = s.thumbUrl, contentDescription = s.title, contentScale = ContentScale.Crop, modifier = Modifier.width(120.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface2))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(s.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(V.byLine(s.host.name, s.peopleCount), fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 1)
            Text(
                if (s.live) V.live else V.endedLabel,
                fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold,
                color = if (s.live) Zk.colors.ok else Zk.colors.fgMuted,
            )
        }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(start = 144.dp))
}

@Composable
private fun StartDialog(candidates: List<WatchPerson>, busy: Boolean, onClose: () -> Unit, onGo: (String, String, Boolean, List<String>) -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var everyone by rememberSaveable { mutableStateOf(true) }
    var q by rememberSaveable { mutableStateOf("") }
    val picked = remember { mutableListOf<String>().toMutableStateList() }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(V.startHeading) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(url, { url = it.take(2000) }, label = { Text(V.link) }, placeholder = { Text(V.linkPh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (url.isNotBlank()) Text(if (V.looksPlayable(url)) V.linkOk else V.linkBad, fontSize = 12.sp, color = if (V.looksPlayable(url)) Zk.colors.ok else Zk.colors.danger)
                OutlinedTextField(title, { title = it.take(120) }, label = { Text(V.name) }, placeholder = { Text(V.namePh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(V.who, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(V.everyone, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Switch(everyone, { everyone = it }, colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent))
                }
                if (!everyone) {
                    if (candidates.isEmpty()) Text(V.nobodyHere, fontSize = 13.sp, color = Zk.colors.fgMuted)
                    else {
                        OutlinedTextField(q, { q = it.take(60) }, placeholder = { Text(V.search) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        if (picked.isNotEmpty()) Text(V.picked(picked.size), fontSize = 12.sp, color = Zk.colors.accent)
                        candidates.filter { q.isBlank() || it.name.contains(q.trim(), ignoreCase = true) }.forEach { p ->
                            Row(Modifier.fillMaxWidth().clickable { if (p.id in picked) picked.remove(p.id) else picked.add(p.id) }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(p.id in picked, { on -> if (on) picked.add(p.id) else picked.remove(p.id) }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                                Text(p.name, fontSize = 14.sp, color = Zk.colors.fg)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && url.isNotBlank(), onClick = { onGo(url, title, everyone, picked.toList()) }) { Text(V.go) } },
        dismissButton = { TextButton(onClick = onClose) { Text(V.cancel) } },
    )
}

@HiltViewModel
class WatchSessionViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session, saved: SavedStateHandle) : DeskViewModel<WatchDetail>(session) {
    private val api = retrofit.create(WatchApi::class.java)
    val id: String = saved.get<String>("id").orEmpty()
    fun refresh() = viewModelScope.launch { load { api.session(id).session } }
    fun end() = viewModelScope.launch { act({ api.end(id) }) { say(V.ended); refresh() } }
}

/**
 * One session: what it is, who started it, who is in it; its talk and call (the session's own topic, native), the video at its own site,
 * and «خلّص الجلسة» for who may. Watching in step opens the site's room inside the app, marked: the video plays in YouTube's own player.
 */
@Composable
fun WatchSessionScreen(onBack: () -> Unit, onOpenChat: (String) -> Unit, onOpenSite: (String) -> Unit, vm: WatchSessionViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var ending by rememberSaveable { mutableStateOf(false) }
    WhileOnScreen(20_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val uri = LocalUriHandler.current
    val s = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = V.title, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                s == null && state.failure == null -> Loading()
                s == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                s == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                    AsyncImage(model = s.thumbUrl, contentDescription = s.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Zk.colors.surface2))
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(s.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                        Text(V.byLine(s.host.name, s.peopleCount), fontSize = 13.sp, color = Zk.colors.fgMuted)
                        Text(if (s.live) V.live else V.ended, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (s.live) Zk.colors.ok else Zk.colors.fgMuted)
                    }
                    if (s.live) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                            io.zakiai.workspace.ui.components.WarnFix(V.roomWarn, V.roomFix)
                        }
                        TextButton(onClick = { onOpenSite("/watch/" + s.id) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(V.together, color = Zk.colors.accent, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                    }
                    TextButton(onClick = { onOpenChat(s.conversationId) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(V.openTalk, color = Zk.colors.accent, fontSize = 15.sp) }
                    if (s.pageUrl.startsWith("https://")) TextButton(onClick = { runCatching { uri.openUri(s.pageUrl) } }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(V.openSite, color = Zk.colors.accent, fontSize = 15.sp) }
                    if (s.people.isNotEmpty()) {
                        Text(V.people(s.people.size), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
                        s.people.forEach { p -> Text(p.name, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                    }
                    if (s.live && s.can.end) {
                        Spacer(Modifier.height(16.dp))
                        OutlinedButton(onClick = { ending = true }, enabled = !busy, border = androidx.compose.foundation.BorderStroke(1.dp, Zk.colors.danger), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                            Text(V.end, color = Zk.colors.danger)
                        }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (ending) AlertDialog(
        onDismissRequest = { ending = false },
        containerColor = Zk.colors.surface1,
        text = { Text(V.endConfirm, fontSize = 14.sp, color = Zk.colors.fg) },
        confirmButton = { TextButton(onClick = { ending = false; vm.end() }) { Text(V.end, color = Zk.colors.danger) } },
        dismissButton = { TextButton(onClick = { ending = false }) { Text(V.cancel) } },
    )
}

