package io.zakiai.workspace.feature.dev

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject

/** One action at a time, the section's own precise refusal, a signed-out answer ends the session. */
abstract class DevBase(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    protected val api: DevApi = retrofit.create(DevApi::class.java)
    protected val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun consumeNotice() { _notice.value = null }

    protected suspend fun <T> read(call: suspend () -> T): T? = when (val r = apiCall { call() }) {
        is ApiResult.Ok -> { _failure.value = null; r.value }
        is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure; null }
    }

    protected fun act(call: suspend () -> Any, sentence: String?, then: () -> Unit) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let { _notice.value = it }; then() }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _notice.value = D.refusal(r.failure.detail, r.failure.key, r.failure.message) }
            }
        } finally {
            _busy.value = false
        }
    }
}

/** «الأداء والتطوير»: who the viewer reads, and the people with their score for a period (by name; by score when asked). */
@HiltViewModel
class DevHomeViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DevBase(retrofit, session) {
    private val _home = MutableStateFlow<DevHomeAnswer?>(null)
    val home: StateFlow<DevHomeAnswer?> = _home.asStateFlow()
    private val _table = MutableStateFlow<ScoreTable?>(null)
    val table: StateFlow<ScoreTable?> = _table.asStateFlow()
    private var period: String? = null
    private var sort = "name"
    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        job = viewModelScope.launch {
            val h = read { api.home() } ?: return@launch
            _home.value = h
            if (h.home.mode != "self") read { api.table(period, sort.takeIf { it == "score" }) }?.let { _table.value = it.table }
        }
    }

    fun pick(period: String) { this.period = period; refresh() }
    fun sortBy(score: Boolean) { sort = if (score) "score" else "name"; refresh() }
}

/** One person's file: the header, and the tab shown (each read when it is opened, as the site's links). */
@HiltViewModel
class DevPersonViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session, saved: SavedStateHandle) : DevBase(retrofit, session) {
    val id: String = saved.get<String>("id").orEmpty()
    private val _person = MutableStateFlow<PersonAnswer?>(null)
    val person: StateFlow<PersonAnswer?> = _person.asStateFlow()
    private val _tab = MutableStateFlow(saved.get<String>("tab")?.takeIf { it in D.TABS } ?: "skills")
    val tab: StateFlow<String> = _tab.asStateFlow()

    private val _skills = MutableStateFlow<List<PersonSkill>?>(null)
    val skills: StateFlow<List<PersonSkill>?> = _skills.asStateFlow()
    private val _history = MutableStateFlow<List<SkillChange>>(emptyList())
    val history: StateFlow<List<SkillChange>> = _history.asStateFlow()
    private val _score = MutableStateFlow<ScoreDetail?>(null)
    val score: StateFlow<ScoreDetail?> = _score.asStateFlow()
    private val _reviews = MutableStateFlow<List<Review>?>(null)
    val reviews: StateFlow<List<Review>?> = _reviews.asStateFlow()
    private val _criteria = MutableStateFlow<List<Criterion>>(emptyList())
    val criteria: StateFlow<List<Criterion>> = _criteria.asStateFlow()
    private val _goals = MutableStateFlow<List<Goal>?>(null)
    val goals: StateFlow<List<Goal>?> = _goals.asStateFlow()
    private val _catalogue = MutableStateFlow<List<Skill>>(emptyList())
    val catalogue: StateFlow<List<Skill>> = _catalogue.asStateFlow()
    private val _notes = MutableStateFlow<List<Note>?>(null)
    val notes: StateFlow<List<Note>?> = _notes.asStateFlow()
    private var period: String? = saved.get<String>("period")

    fun refresh() = viewModelScope.launch {
        val p = read { api.person(id) } ?: return@launch
        _person.value = p
        if (_tab.value !in D.tabsOf(p.person.role)) _tab.value = "skills"
        loadTab()
    }

    fun open(tab: String) { _tab.value = tab; viewModelScope.launch { loadTab() } }
    fun pick(period: String) { this.period = period; viewModelScope.launch { read { api.score(id, period) }?.let { _score.value = it.score } } }

    private suspend fun loadTab() {
        when (_tab.value) {
            "skills" -> { read { api.skills(id) }?.let { _skills.value = it.skills }; read { api.history(id) }?.let { _history.value = it.history } }
            "score" -> read { api.score(id, period) }?.let { _score.value = it.score }
            "reviews" -> { read { api.criteria() }?.let { _criteria.value = it.criteria }; read { api.reviews(id) }?.let { _reviews.value = it.reviews } }
            "plan" -> { read { api.catalogue() }?.let { _catalogue.value = it.skills }; read { api.goals(id) }?.let { _goals.value = it.goals } }
            "notes" -> read { api.notes(id) }?.let { _notes.value = it.notes }
        }
    }

    private fun again() { viewModelScope.launch { loadTab() } }

    fun setLevel(skillId: String, source: String, level: Int, note: String, done: () -> Unit) =
        act({ api.setLevel(id, LevelBody(skillId, source, level, note.trim())) }, w("teamdev.skill.saved")) { done(); again() }

    fun saveReview(body: ReviewBody, done: () -> Unit) = act({ api.saveReview(id, body) }, w("teamdev.review.saved")) { done(); again() }
    fun advance(r: Review, status: String) =
        act({ api.advance(r.id, StatusBody(status)) }, w(if (status == "SHARED") "teamdev.review.shared" else "teamdev.review.submitted")) { again() }

    fun addGoal(body: GoalBody, proposal: Boolean, done: () -> Unit) =
        act({ api.addGoal(id, body) }, w(if (proposal) "teamdev.plan.proposed" else "teamdev.plan.added")) { done(); again() }
    fun patchGoal(g: Goal, patch: GoalPatch, sentence: String) = act({ api.patchGoal(g.id, patch) }, sentence) { again() }
    fun applyGoal(g: Goal) = act({ api.applyGoal(g.id) }, w("teamdev.plan.applied")) { again() }

    fun addNote(body: String, shared: Boolean, done: () -> Unit) = act({ api.addNote(id, NoteBody(body.trim(), shared)) }, null) { done(); again() }
    fun share(n: Note) = act({ api.shareNote(n.id, SharedBody(!n.shared)) }, null) { again() }
}

/** «الهيكل»: who answers to whom, as the viewer may read it; «غيّر المسؤول» for the people they may change. */
@HiltViewModel
class StructureViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DevBase(retrofit, session) {
    private val _data = MutableStateFlow<Structure?>(null)
    val data: StateFlow<Structure?> = _data.asStateFlow()

    fun refresh() = viewModelScope.launch { read { api.structure() }?.let { _data.value = it.structure } }

    /** null is «بدون مسؤول»: written out as null, never left out */
    fun setLine(userId: String, managerId: String?, done: () -> Unit) =
        act({ api.setLine(userId, JsonObject(mapOf("managerId" to (managerId?.let(::JsonPrimitive) ?: JsonNull)))) }, w("teamdev.lines.saved")) { done(); refresh() }
}
