package io.zakiai.workspace.feature.work

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.AcceptBody2
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.CommentBody
import io.zakiai.workspace.core.net.CompleteBody
import io.zakiai.workspace.core.net.MoveBody
import io.zakiai.workspace.core.net.MyWorkAnswer
import io.zakiai.workspace.core.net.NewReminder
import io.zakiai.workspace.core.net.NewTaskBody
import io.zakiai.workspace.core.net.QuickTarget
import io.zakiai.workspace.core.net.Reminder
import io.zakiai.workspace.core.net.ReturnBody
import io.zakiai.workspace.core.net.StepPatch
import io.zakiai.workspace.core.net.StepTitle
import io.zakiai.workspace.core.net.TaskAnswer
import io.zakiai.workspace.core.net.TaskPatch
import io.zakiai.workspace.core.net.TaskSheet
import io.zakiai.workspace.core.net.TodayAnswer
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import javax.inject.Inject

/** One screen's state: what it shows (the phone's copy first), why the last fetch failed, whether the section is closed to the person. */
data class Screen<T>(val data: T? = null, val failure: ApiFailure? = null, val closed: Boolean = false)

/** A 404 from one of the phone's new doors: the site this app talks to does not have it yet (an older server). */
fun ApiFailure.missingDoor() = status == 404

/**
 * «اليوم»: the site's own day for the space the person is in (`GET /api/today`), opened with the phone's last copy. A tick closes a task
 * through the site's route; «مهمة جديدة» lands where the site's quick add lands (the first target it offers).
 */
@HiltViewModel
class TodayViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private val _state = MutableStateFlow(Screen<TodayAnswer>())
    val state: StateFlow<Screen<TodayAnswer>> = _state.asStateFlow()

    private val _reminders = MutableStateFlow<List<Reminder>>(emptyList())
    val reminders: StateFlow<List<Reminder>> = _reminders.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, TodayAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, TodayAnswer.serializer()) { apiCall { api.today() } }) {
            is ApiResult.Ok -> {
                _state.value = Screen(r.value)
                if (r.value.cards.reminders) (apiCall { api.reminders() } as? ApiResult.Ok)?.let { _reminders.value = it.value.reminders.filter { x -> x.status != "DISMISSED" } }
            }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _state.value = _state.value.copy(failure = r.failure) }
        }
    }

    fun complete(taskId: String) = viewModelScope.launch {
        when (val r = apiCall { api.complete(taskId, CompleteBody(true)) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    /** «مهمة جديدة»: into the target the site's quick add offers first, for the person, due today / tomorrow / never. */
    fun quickAdd(title: String, target: QuickTarget, due: String?, then: () -> Unit) = viewModelScope.launch {
        val qa = _state.value.data?.today?.quickAdd
        val body = NewTaskBody(workspaceId = target.workspaceId, projectId = target.projectId, boardId = target.boardId, title = title.trim(), assigneeId = qa?.assigneeId, dueDate = due)
        when (val r = apiCall { api.newTask(body) }) {
            is ApiResult.Ok -> { then(); refresh() }
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun dismissReminder(id: String) = viewModelScope.launch {
        if (apiCall { api.dismissReminder(id) } is ApiResult.Ok) _reminders.value = _reminders.value.filter { it.id != id }
    }

    fun consumeNotice() { _notice.value = null }

    companion object { const val KEY = "today" }
}

/** «مهامي»: the six tabs of the site's page, each with its count; a tick closes or reopens a task through the site's route. */
@HiltViewModel
class MyWorkViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private val _tab = MutableStateFlow("today")
    val tab: StateFlow<String> = _tab.asStateFlow()

    private val _state = MutableStateFlow(Screen<MyWorkAnswer>())
    val state: StateFlow<Screen<MyWorkAnswer>> = _state.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init { show("today") }

    fun show(tab: String) {
        _tab.value = tab
        viewModelScope.launch {
            cache.read(keyOf(tab), MyWorkAnswer.serializer())?.let { c -> if (_tab.value == tab) _state.value = Screen(c) }
            refresh()
        }
    }

    fun refresh() = viewModelScope.launch {
        val tab = _tab.value
        val r = cache.refresh(keyOf(tab), MyWorkAnswer.serializer()) { apiCall { api.myWork(tab) } }
        if (tab != _tab.value) return@launch
        when (r) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403)
            }
        }
    }

    fun toggle(taskId: String, done: Boolean) = viewModelScope.launch {
        when (val r = apiCall { api.complete(taskId, CompleteBody(done)) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }

    private fun keyOf(tab: String) = "my-work:$tab"
}

/**
 * ONE TASK: its sheet as the site's page shows it (`GET /api/tasks/[id]/sheet`), and every change through the task's own routes — the
 * status (a column), done, the priority, the day, «لمين» (a higher rank is a REQUEST, the server decides), the steps, the comments, the
 * answer to a request, «ذكّرني». After each change the sheet is read again: the server is the truth.
 */
@HiltViewModel
class TaskViewModel @Inject constructor(savedState: SavedStateHandle, private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    val id: String = checkNotNull(savedState["id"])
    private val key = "task-sheet:$id"

    private val _state = MutableStateFlow(Screen<TaskSheet>())
    val state: StateFlow<Screen<TaskSheet>> = _state.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        viewModelScope.launch { cache.read(key, TaskSheet.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(key, TaskSheet.serializer()) { apiCall { api.taskSheet(id) } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                // gone, or no longer the person's to read: what the phone kept of it goes too
                if (r.failure.status == 404 || r.failure.status == 403) { cache.remove(key); _state.value = Screen(failure = r.failure, closed = true) }
                else _state.value = _state.value.copy(failure = r.failure)
            }
        }
    }

    private fun act(said: String? = null, block: suspend () -> ApiResult<*>) = viewModelScope.launch {
        _busy.value = true
        val r = block()
        _busy.value = false
        when (r) {
            is ApiResult.Ok -> { said?.let { _notice.value = it }; refresh() }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure) else _notice.value = r.failure.message }
        }
    }

    fun complete(done: Boolean) = act { apiCall { api.complete(id, CompleteBody(done)) } }

    fun move(columnId: String) = act { apiCall { api.move(id, MoveBody(columnId)) } }

    fun priority(p: String) = act { apiCall { api.patchTask(id, TaskPatch(priority = p)) } }

    fun rename(title: String) = act(W.saved) { apiCall { api.patchTask(id, TaskPatch(title = title.trim())) } }

    fun describe(text: String) = act(W.saved) { apiCall { api.patchTask(id, TaskPatch(description = text)) } }

    /** A plain day «YYYY-MM-DD» (noon in the company's zone, as the site's date box), or none. */
    fun due(day: LocalDate?) = act {
        apiCall { api.patchTaskRaw(id, buildJsonObject { put("dueDate", if (day == null) JsonNull else JsonPrimitive(day.toString())) }) }
    }

    /** «لمين»: the primary first. Somebody of a higher rank is only ASKED — the answer says so. */
    fun assign(ids: List<String>) = viewModelScope.launch {
        _busy.value = true
        val r = apiCall { api.patchTask(id, TaskPatch(assigneeIds = ids)) }
        _busy.value = false
        when (r) {
            is ApiResult.Ok -> { if (r.value.task.assignRequest != null || r.value.task.coRequests.isNotEmpty()) _notice.value = W.requestSent; refresh() }
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun addStep(title: String) = act { apiCall { api.addStep(id, StepTitle(title.trim())) } }

    fun tickStep(stepId: String, done: Boolean) = act { apiCall { api.patchStep(id, stepId, StepPatch(done = done)) } }

    fun deleteStep(stepId: String) = act { apiCall { api.deleteStep(id, stepId) } }

    fun comment(body: String) = act { apiCall { api.addComment(id, CommentBody(body.trim())) } }

    fun deleteComment(commentId: String) = act { apiCall { api.deleteComment(id, commentId) } }

    fun accept(requestId: String) = act { apiCall { api.acceptRequest(id, AcceptBody2(requestId)) } }

    fun giveBack(requestId: String, reason: String) = act { apiCall { api.returnRequest(id, ReturnBody(reason.trim(), requestId)) } }

    /** «ذكّرني»: a moment of the person's choice, in their phone's clock. */
    fun remind(title: String, at: LocalDateTime) = act(W.reminderSet) {
        apiCall { api.addReminder(NewReminder(title = title.take(200), dueAt = at.atZone(ZoneId.systemDefault()).toInstant().toString(), taskId = id)) }
    }

    fun consumeNotice() { _notice.value = null }

    companion object {
        /** The three quick moments of «ذكّرني»: in an hour, this evening at six (or tomorrow's if already past), tomorrow at nine. Pure. */
        fun quickMoments(now: LocalDateTime): List<Pair<String, LocalDateTime>> {
            val evening = now.toLocalDate().atTime(LocalTime.of(18, 0)).let { if (it.isAfter(now.plusMinutes(5))) it else it.plusDays(1) }
            return listOf(
                W.remindInHour to now.plusHours(1).withSecond(0).withNano(0),
                W.remindTonight to evening,
                W.remindTomorrow to now.toLocalDate().plusDays(1).atTime(LocalTime.of(9, 0)),
            )
        }
    }
}
