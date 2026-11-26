package io.zakiai.workspace.feature.desks

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
import javax.inject.Inject

/** The shared bones of the three desks: one action at a time, the site's sentence on a refusal, a signed-out answer ends the session. */
abstract class DeskBase(retrofit: retrofit2.Retrofit, protected val session: Session) : ViewModel() {
    protected val api: DesksApi = retrofit.create(DesksApi::class.java)
    private val _facts = MutableStateFlow<DeskFacts?>(null)
    val facts: StateFlow<DeskFacts?> = _facts.asStateFlow()
    protected val _failure = MutableStateFlow<String?>(null)
    val failure: StateFlow<String?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun say(text: String) { _notice.value = text }
    fun consumeNotice() { _notice.value = null }

    protected fun failed(f: ApiFailure) { if (f.signedOut) session.expired(f) }

    protected suspend fun loadFacts(): DeskFacts? = when (val r = apiCall { api.facts() }) {
        is ApiResult.Ok -> r.value.also { _facts.value = it }
        is ApiResult.Err -> { failed(r.failure); _failure.value = r.failure.message; null }
    }

    protected suspend fun <T> read(call: suspend () -> T): T? = when (val r = apiCall { call() }) {
        is ApiResult.Ok -> { _failure.value = null; r.value }
        is ApiResult.Err -> { failed(r.failure); _failure.value = r.failure.message; null }
    }

    protected fun act(call: suspend () -> Any, sentence: String? = null, then: (Any) -> Unit = {}) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let(::say); then(r.value) }
                is ApiResult.Err -> { failed(r.failure); say(r.failure.message) }
            }
        } finally {
            _busy.value = false
        }
    }
}

/** «الحملات»: mine, the departments, the campaigns of the one picked, a campaign's items. */
@HiltViewModel
class CampaignsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskBase(retrofit, session) {
    private val _mine = MutableStateFlow<List<Campaign>?>(null)
    val mine: StateFlow<List<Campaign>?> = _mine.asStateFlow()
    private val _depts = MutableStateFlow<List<Department>?>(null)
    val depts: StateFlow<List<Department>?> = _depts.asStateFlow()
    private val _picked = MutableStateFlow<String?>(null)
    val picked: StateFlow<String?> = _picked.asStateFlow()
    private val _list = MutableStateFlow<List<Campaign>?>(null)
    val list: StateFlow<List<Campaign>?> = _list.asStateFlow()
    private val _items = MutableStateFlow<Map<String, List<CampaignItem>>>(emptyMap())
    val items: StateFlow<Map<String, List<CampaignItem>>> = _items.asStateFlow()
    private var job: Job? = null

    fun refresh(wanted: String?) {
        job?.cancel()
        job = viewModelScope.launch {
            val f = loadFacts() ?: return@launch
            if (f.external || !f.directory || !f.campaigns.view) return@launch
            read { api.myCampaigns() }?.let { _mine.value = it.campaigns }
            // the picker fails quietly for who may not read the departments (the site hides it the same way)
            val depts = (apiCall { api.departments() } as? ApiResult.Ok)?.value?.departments.orEmpty()
            _depts.value = depts
            val pick = listOfNotNull(wanted, _picked.value, f.departmentId).firstOrNull { id -> depts.any { it.id == id } } ?: depts.firstOrNull()?.id
            if (pick != null) open(pick)
        }
    }

    fun open(deptId: String) = viewModelScope.launch {
        if (_picked.value != deptId) _list.value = null
        _picked.value = deptId
        read { api.campaigns(deptId) }?.let { _list.value = it.campaigns }
    }

    private fun reload() { _picked.value?.let { open(it) }; viewModelScope.launch { read { api.myCampaigns() }?.let { _mine.value = it.campaigns } } }

    fun create(title: String, desc: String, priority: String, start: String, end: String, done: () -> Unit) {
        val dept = _picked.value ?: return
        if (title.trim().length < 3) { say(Q.titleShort); return }
        if (end < start) { say(Q.badRange); return }
        act({ api.newCampaign(dept, NewCampaignBody(title.trim(), desc.trim().ifBlank { null }, priority, start, end)) }, Q.campaignCreated) { done(); reload() }
    }

    fun status(c: Campaign, s: String) = act({ api.campaignStatus(c.id, CampaignStatusBody(s)) }) { reload() }
    fun delete(c: Campaign) = act({ api.deleteCampaign(c.id) }, Q.campaignDeleted) { reload() }

    fun loadItems(id: String) = viewModelScope.launch {
        read { api.campaign(id) }?.let { a -> _items.value = _items.value + (id to a.campaign.items) }
    }

    fun makeTask(campaignId: String, item: CampaignItem) = act({ api.itemTask(item.id) }) { r ->
        say(if ((r as? MadeTask)?.created == true) Q.taskMade else Q.taskAlready)
        loadItems(campaignId)
    }
}

/** «الأقسام»: the company's departments; the owner and the admins make, edit, delete them and pick their people. */
@HiltViewModel
class DepartmentsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskBase(retrofit, session) {
    private val _list = MutableStateFlow<List<Department>?>(null)
    val list: StateFlow<List<Department>?> = _list.asStateFlow()
    private val _people = MutableStateFlow<List<DirectoryUser>?>(null)
    val people: StateFlow<List<DirectoryUser>?> = _people.asStateFlow()

    fun refresh() = viewModelScope.launch {
        val f = loadFacts() ?: return@launch
        if (f.external || !f.directory || f.spaceOnly) return@launch
        read { api.departments() }?.let { _list.value = it.departments }
    }

    fun loadPeople() = viewModelScope.launch {
        (apiCall { api.directory() } as? ApiResult.Ok)?.let { r -> _people.value = r.value.people.map { it.user } } ?: run { _people.value = emptyList() }
    }

    fun save(id: String?, name: String, emoji: String?, color: String?, leadId: String?, done: () -> Unit) {
        if (name.trim().length < 2) { say(Q.nameShort); return }
        val body = DepartmentBody(name.trim(), emoji, color, leadId)
        act({ if (id == null) api.newDepartment(body) else api.editDepartment(id, body) }, Q.deptSaved) { done(); refresh() }
    }

    fun delete(id: String) = act({ api.deleteDepartment(id) }, Q.deptDeleted) { refresh() }
    fun add(id: String, userId: String) = act({ api.members(id, MembersBody(addUserIds = listOf(userId))) }) { refresh() }
    fun remove(id: String, userId: String) = act({ api.members(id, MembersBody(removeUserIds = listOf(userId))) }) { refresh() }
}

/** «الروتين اليومي»: one day's checklist (the company's day first), ticked by anybody who reads it; the routines for who may edit. */
@HiltViewModel
class ProductionViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : DeskBase(retrofit, session) {
    private val _day = MutableStateFlow<DayAnswer?>(null)
    val day: StateFlow<DayAnswer?> = _day.asStateFlow()
    private val _routines = MutableStateFlow<List<Routine>?>(null)
    val routines: StateFlow<List<Routine>?> = _routines.asStateFlow()
    private val _people = MutableStateFlow<List<DirectoryUser>?>(null)
    val people: StateFlow<List<DirectoryUser>?> = _people.asStateFlow()
    private var job: Job? = null
    private var shown: String? = null

    /** `day` null: the company's today (from the facts) */
    fun refresh(day: String?) {
        job?.cancel()
        job = viewModelScope.launch {
            val f = facts.value ?: loadFacts() ?: return@launch
            if (!f.production.view) return@launch
            val d = day ?: shown ?: f.today
            if (d != shown) _day.value = null
            shown = d
            read { api.day(d) }?.let { _day.value = it }
        }
    }

    fun current(): String? = shown

    fun tick(item: RoutineDay) {
        val d = shown ?: return
        val on = item.doneAt == null
        // drawn at once, the site's answer then read again
        _day.value = _day.value?.let { a -> a.copy(items = a.items.map { if (it.id == item.id) it.copy(doneAt = if (on) "now" else null) else it }) }
        act({ api.check(CheckBody(item.id, d, on)) }) { refresh(d) }
    }

    fun loadRoutines() = viewModelScope.launch {
        read { api.routines() }?.let { _routines.value = it.routines }
        if (_people.value == null) (apiCall { api.directory() } as? ApiResult.Ok)?.let { r -> _people.value = r.value.people.map { it.user } } ?: run { _people.value = emptyList() }
    }

    fun save(id: String?, title: String, desc: String, assigneeId: String?, weekdays: Set<Int>, active: Boolean, done: () -> Unit) {
        if (title.trim().length < 2) { say(Q.titleShort); return }
        // all seven days (or none) is «كل يوم»: the server stores it as nothing
        val days = if (weekdays.size == 7) emptyList() else weekdays.sorted()
        val body = RoutineBody(title.trim(), desc.trim().ifBlank { null }, assigneeId, days, active)
        act({ if (id == null) api.newRoutine(body) else api.editRoutine(id, body) }, Q.routineSaved) { done(); loadRoutines(); refresh(shown) }
    }

    fun delete(id: String) = act({ api.deleteRoutine(id) }, Q.routineDeleted) { loadRoutines(); refresh(shown) }

    fun convert(id: String) = act({ api.convert(id) }) { r ->
        say(if ((r as? MadeTask)?.created == true) Q.converted else Q.convertedAlready)
        loadRoutines(); refresh(shown)
    }
}
