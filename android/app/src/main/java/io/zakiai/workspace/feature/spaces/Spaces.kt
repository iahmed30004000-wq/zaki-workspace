package io.zakiai.workspace.feature.spaces

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.hilt.navigation.compose.hiltViewModel
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
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import java.util.Locale
import javax.inject.Inject

/*
 * «كل المساحات» (M2 N6 batch 10) — the owner's and the admins' one look over every space they can open: numbers only, never the work
 * (GET /api/spaces/overview, the same answer the page draws). Enter a space, rename it, archive it and bring it back, through the site's
 * own routes, and the old things from before spaces had their own moved into one. Deleting a space stays the site's page (marked).
 */

/** The site's sentence of [key] (generated from ar.spaces.json), its «{param}» filled. */
fun w(key: String, vararg params: Pair<String, Any?>): String = SpaceWords.s(key, *params)

@Immutable
@Serializable
data class SpaceCard(val id: String = "", val name: String = "", val emoji: String? = null, val kind: String = "TEAM", val members: Int = 0, val open: Int = 0, val overdue: Int = 0, val unread: Int = 0)

@Serializable
data class ArchivedSpace(val id: String = "", val name: String = "", val emoji: String? = null, val archivedAt: String = "")

@Serializable
data class SpacesScreen(val cards: List<SpaceCard> = emptyList(), val hereId: String? = null, val archived: List<ArchivedSpace> = emptyList())

@Serializable
data class RenameBody(val name: String)

@Serializable
data class ArchiveBody(val archived: Boolean)

interface SpacesApi {
    @GET("api/spaces/overview")
    suspend fun overview(@Header("Cache-Control") cache: String = "no-store"): SpacesScreen

    @PATCH("api/workspaces/{id}")
    suspend fun rename(@Path("id") id: String, @Body body: RenameBody): JsonObject

    @POST("api/workspaces/{id}/archive")
    suspend fun archive(@Path("id") id: String, @Body body: ArchiveBody): JsonObject

    @GET("api/spaces/unplaced")
    suspend fun unplaced(@Header("Cache-Control") cache: String = "no-store"): UnplacedAnswer

    @POST("api/spaces/unplaced/move")
    suspend fun move(@Body body: MoveBody): MovedAnswer
}

/** an idea, file, goal, routine, customer or opportunity from before spaces had their own (a title only) */
@Serializable
data class Unplaced(val kind: String = "", val id: String = "", val title: String = "", val createdAt: String = "")

@Serializable
data class UnplacedAnswer(val rows: List<Unplaced> = emptyList())

@Serializable
data class MoveBody(val kind: String, val ids: List<String>, val spaceId: String)

@Serializable
data class MovedAnswer(val moved: Int = 0)

/** Pure pieces of the screen (SpacesTest pins them). */
object S {
    const val cancel = "إلغاء"
    const val save = "حفظ"
    const val siteWarn = "⚠️ حذف مساحة لسا من صفحة الموقع."
    const val siteFix = "🔧 الحذف بيمسح المساحة مع شغلها، فبيضل على الموقع مع تأكيد بكتابة اسمها."

    /** the kinds of old things, in the site's order */
    val KINDS = listOf("idea", "file", "goal", "routine", "customer", "opportunity")

    /** the old things grouped by kind, empty kinds left out */
    fun groups(rows: List<Unplaced>): List<Pair<String, List<Unplaced>>> = KINDS.map { k -> k to rows.filter { it.kind == k } }.filter { it.second.isNotEmpty() }

    fun n(v: Int): String = String.format(Locale.ROOT, "%d", v)

    /** a card's numbers in one line, each with its word; the late ones first when there are any */
    fun figures(c: SpaceCard): String = listOf(
        n(c.open) + " " + w("spaces.overview.open"),
        n(c.overdue) + " " + w("spaces.overview.overdue"),
        n(c.unread) + " " + w("spaces.overview.unread"),
        n(c.members) + " " + w("spaces.overview.members"),
    ).joinToString(" · ")

    /** «الشركة» (the company's own space) is never archived */
    fun archivable(c: SpaceCard): Boolean = c.kind != "HQ"

    fun title(name: String, emoji: String?): String = (emoji?.takeIf { it.isNotBlank() }?.let { "$it " } ?: "") + "⁨$name⁩"
}

@HiltViewModel
class SpacesViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    private val api = retrofit.create(SpacesApi::class.java)
    private val _data = MutableStateFlow<SpacesScreen?>(null)
    val data: StateFlow<SpacesScreen?> = _data.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _unplaced = MutableStateFlow<List<Unplaced>?>(null)
    val unplaced: StateFlow<List<Unplaced>?> = _unplaced.asStateFlow()

    fun consumeNotice() { _notice.value = null }

    fun refresh() = viewModelScope.launch {
        when (val r = apiCall { api.overview() }) {
            is ApiResult.Ok -> { _failure.value = null; _data.value = r.value }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
        (apiCall { api.unplaced() } as? ApiResult.Ok)?.let { _unplaced.value = it.value.rows }
    }

    fun move(kind: String, ids: List<String>, spaceId: String) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { api.move(MoveBody(kind, ids, spaceId)) }) {
                is ApiResult.Ok -> { _notice.value = w("spaces.unplaced.moved", "n" to r.value.moved); refresh() }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _notice.value = w("spaces.unplaced.move_failed") }
            }
        } finally {
            _busy.value = false
        }
    }

    private fun act(call: suspend () -> Any, sentence: String?, then: () -> Unit = {}) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let { _notice.value = it }; then(); refresh() }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _notice.value = r.failure.key?.let { SpaceWords.all[it] } ?: w("spaces.archive.failed") }
            }
        } finally {
            _busy.value = false
        }
    }

    fun rename(c: SpaceCard, name: String, done: () -> Unit) = act({ api.rename(c.id, RenameBody(name.trim())) }, null, done)
    fun archive(c: SpaceCard, done: () -> Unit) = act({ api.archive(c.id, ArchiveBody(true)) }, w("spaces.archive.done"), done)
    fun restore(a: ArchivedSpace) = act({ api.archive(a.id, ArchiveBody(false)) }, w("spaces.archived.restored"))
}

/**
 * «كل المساحات» (src/components/control-panel/sections/spaces-body.tsx): a row per space with what is open, late and waiting there, and the
 * way in; each space's own settings; the archived spaces under them, each brought back with one tap.
 */
@Composable
fun SpacesOverviewScreen(onBack: () -> Unit, onEnter: (String) -> Unit, onOpenSettings: (String) -> Unit, vm: SpacesViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val unplaced by vm.unplaced.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf<Pair<String, SpaceCard>?>(null) }
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val d = data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = w("spaces.overview.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            val f = failure
            when {
                d == null && f != null -> if (f.status == 404) Empty(w("spaces.manage_denied")) else Failure(f.message, onRetry = { vm.refresh() })
                d == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                    item(key = "head") {
                        Text(w("spaces.overview.hint"), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                        if (d.cards.isEmpty()) Empty(w("spaces.overview.empty_hint"))
                    }
                    items(d.cards, key = { it.id }) { c ->
                        val here = c.id == d.hereId
                        Column(Modifier.fillMaxWidth().clickable { onEnter(c.id) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(S.title(c.name, c.emoji), fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                if (here) Text(w("spaces.overview.here"), fontSize = 12.sp, color = Zk.colors.accentFg, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accent).padding(horizontal = 8.dp, vertical = 3.dp))
                            }
                            Text(S.figures(c), fontSize = 12.5.sp, color = if (c.overdue > 0) Zk.colors.warn else Zk.colors.fgMuted)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                TextButton(onClick = { onEnter(c.id) }) { Text(w("spaces.overview.enter"), color = Zk.colors.accent, fontSize = 13.sp) }
                                TextButton(enabled = !busy, onClick = { menu = "rename" to c }) { Text(w("spaces.card.rename"), color = Zk.colors.fgMuted, fontSize = 13.sp) }
                                if (S.archivable(c)) TextButton(enabled = !busy, onClick = { menu = "archive" to c }) { Text(w("spaces.card.archive"), color = Zk.colors.fgMuted, fontSize = 13.sp) }
                                TextButton(onClick = { onOpenSettings(c.id) }) { Text(w("spset.open"), color = Zk.colors.fgMuted, fontSize = 13.sp) }
                            }
                        }
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
                    }
                    item(key = "archived") {
                        if (d.archived.isNotEmpty()) {
                            Text(w("spaces.archived.title"), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp))
                            Text(w("spaces.archived.hint"), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        }
                    }
                    items(d.archived, key = { "a" + it.id }) { a ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(S.title(a.name, a.emoji), fontSize = 14.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f))
                            TextButton(enabled = !busy, onClick = { vm.restore(a) }) { Text(w("spaces.archived.restore"), color = Zk.colors.accent) }
                        }
                    }
                    item(key = "unplaced") {
                        Text(w("spaces.unplaced.title"), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp))
                        Text(w("spaces.unplaced.hint"), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                        val rows = unplaced
                        when {
                            rows == null -> Text(w("spaces.unplaced.loading"), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                            rows.isEmpty() -> Text(w("spaces.unplaced.none"), fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                            else -> S.groups(rows).forEach { (kind, list) ->
                                var target by remember(kind) { mutableStateOf<SpaceCard?>(null) }
                                var open by remember(kind) { mutableStateOf(false) }
                                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(10.dp)) {
                                    Text((SpaceWords.all["spaces.unplaced.kind.$kind"] ?: kind) + " (" + S.n(list.size) + ")", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                                    if (kind == "customer") Text(w("spaces.unplaced.customer_note"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box {
                                            TextButton(onClick = { open = true }) { Text(w("spaces.unplaced.to") + " " + (target?.let { S.title(it.name, it.emoji) } ?: w("spaces.unplaced.pick")), color = Zk.colors.accent, fontSize = 13.sp) }
                                            DropdownMenu(open, { open = false }) { d.cards.forEach { c -> DropdownMenuItem(text = { Text(S.title(c.name, c.emoji)) }, onClick = { target = c; open = false }) } }
                                        }
                                        TextButton(enabled = !busy && target != null, onClick = { target?.let { t -> vm.move(kind, list.map { it.id }, t.id) } }) { Text(w("spaces.unplaced.move_all"), fontSize = 13.sp) }
                                    }
                                    list.forEach { r ->
                                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                            Text("⁨${r.title}⁩", fontSize = 13.sp, color = Zk.colors.fg, maxLines = 1, modifier = Modifier.weight(1f))
                                            TextButton(enabled = !busy && target != null, onClick = { target?.let { t -> vm.move(kind, listOf(r.id), t.id) } }) { Text(w("spaces.unplaced.move"), fontSize = 12.5.sp) }
                                        }
                                    }
                                }
                            }
                        }
                        Column(Modifier.fillMaxWidth().padding(12.dp)) { WarnFix(S.siteWarn, S.siteFix) }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    menu?.let { (kind, c) ->
        var name by remember(c.id) { mutableStateOf(c.name) }
        AlertDialog(
            onDismissRequest = { menu = null },
            containerColor = Zk.colors.surface1,
            title = { Text(if (kind == "rename") w("spaces.card.rename") else w("spaces.card.archive")) },
            text = {
                if (kind == "rename") OutlinedTextField(name, { name = it.take(80) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                else Text(S.title(c.name, c.emoji) + "\n" + w("spaces.archived.hint"), fontSize = 13.5.sp, color = Zk.colors.fg)
            },
            confirmButton = {
                TextButton(enabled = !busy && (kind != "rename" || (name.isNotBlank() && name.trim() != c.name)), onClick = {
                    if (kind == "rename") vm.rename(c, name) { menu = null } else vm.archive(c) { menu = null }
                }) { Text(if (kind == "rename") S.save else w("spaces.card.archive"), color = if (kind == "rename") Zk.colors.accent else Zk.colors.warn) }
            },
            dismissButton = { TextButton(onClick = { menu = null }) { Text(S.cancel) } },
        )
    }
}

