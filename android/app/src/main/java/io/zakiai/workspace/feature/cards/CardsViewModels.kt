package io.zakiai.workspace.feature.cards

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.StatusBody
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desk.DeskViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject

/** What the editor holds (one shape for a new card and an edit). */
data class CardDraft(
    val kind: String = "NOTE",
    val title: String = "",
    val body: String = "",
    val url: String = "",
    val items: List<Pair<String, Boolean>> = emptyList(),
    val columns: List<String> = listOf(""),
    val rows: List<List<String>> = emptyList(),
    val color: String = "none",
    val category: String = "",
    val tags: String = "",
    val pinned: Boolean = false,
) {
    fun data() = when (kind) {
        "LIST" -> K.listData(items)
        "LINK" -> K.linkData(url)
        "TABLE" -> K.tableData(columns, rows)
        else -> null
    }

    /** What the server would refuse, said before it is sent (the server decides again). */
    fun problem(): String? = when {
        title.isBlank() -> "اكتب عنوانًا للوحة"
        kind == "PROMPT" && body.isBlank() -> "اكتب نص البرومبت"
        kind == "LINK" && !K.isSafeHttps(url) -> "الرابط يجب أن يبدأ بـ https:// وأن يكون عنوانًا صحيحًا"
        else -> null
    }

    companion object {
        fun of(c: CardItem): CardDraft {
            val (cols, rows) = K.table(c.data)
            return CardDraft(
                kind = c.kind, title = c.title, body = c.body.orEmpty(),
                url = (c.data as? JsonObject)?.get("url")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }.orEmpty(),
                items = K.listItems(c.data), columns = cols, rows = rows,
                color = c.color, category = c.category.orEmpty(), tags = c.tags.joinToString("، "), pinned = c.pinned,
            )
        }
    }
}

/** «اللوحات» of a space (`GET /api/cards?spaceId=`), the owner's «المحذوفات» (`archived=1`), and a new card. */
@HiltViewModel
class CardsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskViewModel<CardList>(session) {
    private val api = retrofit.create(CardsApi::class.java)
    private var job: Job? = null
    private var space: String? = null
    private var archived = false

    fun refresh(spaceId: String, archive: Boolean) {
        // another space or the other list: what was drawn belongs to the old one
        if (spaceId != space || archive != archived) _state.value = io.zakiai.workspace.feature.work.Screen()
        space = spaceId; archived = archive
        job?.cancel()
        job = viewModelScope.launch { load { api.list(spaceId, if (archive) "1" else null) } }
    }

    fun create(d: CardDraft, opened: (String) -> Unit) = viewModelScope.launch {
        val s = space ?: return@launch
        d.problem()?.let { say(it); return@launch }
        var made: String? = null
        act({
            api.create(
                NewCardBody(s, d.kind, d.title.trim(), d.body.ifBlank { null }, d.data(), d.color, d.category.trim().ifBlank { null }, K.tagsOf(d.tags), d.pinned),
            ).card.id.also { made = it }
        }) { say(K.created); made?.let(opened); refresh(s, archived) }
    }

    fun pin(c: CardItem) = viewModelScope.launch { act({ api.patch(c.id, CardPatch(pinned = !c.pinned)) }) { space?.let { refresh(it, archived) } } }

    fun restore(c: CardItem) = viewModelScope.launch { act({ api.restore(c.id) }) { say(K.restored); space?.let { refresh(it, archived) } } }
}

/** The page inside a card (`GET /api/cards/[id]/page`) and everything done on it, through the site's own routes. */
@HiltViewModel
class CardViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session, saved: SavedStateHandle) : DeskViewModel<CardPageData>(session) {
    private val api = retrofit.create(CardsApi::class.java)
    val id: String = saved.get<String>("id").orEmpty()

    private val _notes = MutableStateFlow<NotesView?>(null)
    val notes: StateFlow<NotesView?> = _notes.asStateFlow()
    private val _log = MutableStateFlow<List<LogEntry>?>(null)
    val log: StateFlow<List<LogEntry>?> = _log.asStateFlow()
    private val _links = MutableStateFlow<LinksView?>(null)
    val links: StateFlow<LinksView?> = _links.asStateFlow()
    private val _revisions = MutableStateFlow<RevisionsView?>(null)
    val revisions: StateFlow<RevisionsView?> = _revisions.asStateFlow()
    private val _topics = MutableStateFlow<List<CardTopic>?>(null)
    val topics: StateFlow<List<CardTopic>?> = _topics.asStateFlow()
    private val _projects = MutableStateFlow<List<NamedRow>?>(null)
    val projects: StateFlow<List<NamedRow>?> = _projects.asStateFlow()
    private val _boards = MutableStateFlow<List<NamedRow>?>(null)
    val boards: StateFlow<List<NamedRow>?> = _boards.asStateFlow()
    /** the card as it is now, when a save met a newer version (409): the person chooses */
    private val _conflict = MutableStateFlow<CardItem?>(null)
    val conflict: StateFlow<CardItem?> = _conflict.asStateFlow()
    private val _gone = MutableStateFlow(false)
    /** the card was deleted from here: the screen goes back */
    val gone: StateFlow<Boolean> = _gone.asStateFlow()

    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        job = viewModelScope.launch {
            load { api.page(id) }
            val d = _state.value.data ?: return@launch
            if (d.abilities.internal) {
                (apiCall { api.notes(id) } as? ApiResult.Ok)?.let { _notes.value = it.value }
                (apiCall { api.links(id) } as? ApiResult.Ok)?.let { _links.value = it.value }
            }
        }
    }

    fun loadLog() = viewModelScope.launch { (apiCall { api.log(id) } as? ApiResult.Ok)?.let { _log.value = it.value.entries } }
    fun loadRevisions() = viewModelScope.launch { (apiCall { api.revisions(id) } as? ApiResult.Ok)?.let { _revisions.value = it.value } }

    private fun after(sentence: String?): () -> Unit = { sentence?.let(::say); refresh(); _log.value = null; _revisions.value = null }

    /**
     * Saves the editor against the version it started from. A card that moved on answers 409 with the card as it is now: nothing
     * is written over a colleague's work until the person chooses ([keepMine] or [takeTheirs]).
     */
    fun save(d: CardDraft, base: Int, done: () -> Unit) = viewModelScope.launch {
        d.problem()?.let { say(it); return@launch }
        val patch = CardPatch(
            version = base, title = d.title.trim(), body = d.body, data = d.data(), color = d.color,
            category = d.category.trim(), tags = K.tagsOf(d.tags), pinned = d.pinned,
        )
        when (val r = apiCall { api.patch(id, patch) }) {
            is ApiResult.Ok -> { done(); after(K.saved)() }
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                if (r.failure.status == 409) pending = d
                say(r.failure.message)
                if (r.failure.status == 409) refreshConflict()
            }
        }
    }

    /** the person's edit that met a newer version, kept until they choose */
    private var pending: CardDraft? = null

    private suspend fun refreshConflict() {
        (apiCall { api.page(id) } as? ApiResult.Ok)?.let { _conflict.value = it.value.card }
    }

    /** the person's own choice: their edit over the newer version (sent against it) */
    fun keepMine(done: () -> Unit) {
        val now = _conflict.value ?: return
        val mine = pending ?: return
        _conflict.value = null
        save(mine, now.version, done)
    }

    fun takeTheirs(done: () -> Unit) { _conflict.value = null; pending = null; done(); refresh() }

    fun toggleItem(c: CardItem, index: Int) = viewModelScope.launch {
        val items = K.listItems(c.data).mapIndexed { i, it -> if (i == index) it.first to !it.second else it }
        // drawn at once; the server's answer then replaces it
        _state.value.data?.let { d -> _state.value = _state.value.copy(data = d.copy(card = d.card.copy(data = K.listData(items)))) }
        when (val r = apiCall { api.patch(id, CardPatch(version = c.version, data = K.listData(items))) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> { say(r.failure.message); refresh() }
        }
    }

    fun pin(c: CardItem) = viewModelScope.launch { act({ api.patch(id, CardPatch(pinned = !c.pinned)) }, after(null)) }
    fun status(to: String) = viewModelScope.launch { act({ api.status(id, StatusBody(to)) }, after(K.statusChanged)) }
    fun rate(stars: Int) = viewModelScope.launch { act({ api.rate(id, StarsBody(stars)) }, after(K.starsSaved)) }
    fun duplicate(opened: (String) -> Unit) = viewModelScope.launch {
        var made: String? = null
        act({ api.duplicate(id).card.id.also { made = it } }) { say(K.duplicated); made?.let(opened) }
    }
    fun archive() = viewModelScope.launch { act({ api.archive(id) }) { say(K.deleted); _gone.value = true } }
    fun restore() = viewModelScope.launch { act({ api.restore(id) }, after(K.restored)) }
    fun restoreRevision(v: Int, current: Int) = viewModelScope.launch { act({ api.restoreRevision(id, v, VersionBody(current)) }, after(K.versionRestored(v))) }

    fun addNote(body: String, private: Boolean, done: () -> Unit) = viewModelScope.launch {
        if (body.isBlank()) return@launch
        act({ api.addNote(id, NoteBody(body.trim(), if (private) "PRIVATE" else "PUBLIC")) }) { done(); say(K.noteAdded); reloadNotes() }
    }
    fun editNote(noteId: String, body: String, done: () -> Unit) = viewModelScope.launch {
        if (body.isBlank()) return@launch
        act({ api.editNote(id, noteId, NoteEdit(body.trim())) }) { done(); reloadNotes() }
    }
    fun deleteNote(noteId: String) = viewModelScope.launch { act({ api.deleteNote(id, noteId) }) { say(K.noteDeleted); reloadNotes() } }
    private fun reloadNotes() = viewModelScope.launch { (apiCall { api.notes(id) } as? ApiResult.Ok)?.let { _notes.value = it.value } }

    fun loadTopics(spaceId: String) = viewModelScope.launch {
        _topics.value = null
        when (val r = apiCall { api.topics(spaceId) }) {
            is ApiResult.Ok -> _topics.value = r.value.topics
            is ApiResult.Err -> { _topics.value = emptyList(); say(r.failure.message) }
        }
    }
    fun send(conversationId: String, done: () -> Unit) = viewModelScope.launch { act({ api.send(id, SendBody(conversationId)) }) { done(); after(K.sent)() } }

    fun loadProjects(spaceId: String) = viewModelScope.launch {
        _projects.value = null; _boards.value = null
        when (val r = apiCall { api.projects(spaceId) }) {
            is ApiResult.Ok -> _projects.value = r.value.projects
            is ApiResult.Err -> { _projects.value = emptyList(); say(r.failure.message) }
        }
    }
    fun loadBoards(projectId: String) = viewModelScope.launch {
        _boards.value = null
        (apiCall { api.boards(projectId) } as? ApiResult.Ok)?.let { _boards.value = it.value.boards } ?: run { _boards.value = emptyList() }
    }
    fun toTask(projectId: String, boardId: String, opened: (String) -> Unit) = viewModelScope.launch {
        var task: String? = null
        act({ api.toTask(id, TaskBody(projectId, boardId)).also { o -> task = (o["taskId"] as? kotlinx.serialization.json.JsonPrimitive)?.content } }) {
            after(K.taskMade)(); task?.let(opened)
        }
    }

}
