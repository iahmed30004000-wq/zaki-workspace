package io.zakiai.workspace.feature.office

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.CalendarAnswer
import io.zakiai.workspace.core.net.CommentBody
import io.zakiai.workspace.core.net.DepartmentsAnswer
import io.zakiai.workspace.core.net.DmBody
import io.zakiai.workspace.core.net.NewTicketBody
import io.zakiai.workspace.core.net.PeopleAnswer
import io.zakiai.workspace.core.net.Profile
import io.zakiai.workspace.core.net.TicketDetail
import io.zakiai.workspace.core.net.TicketPatch
import io.zakiai.workspace.core.net.TicketsAnswer
import io.zakiai.workspace.core.net.TimeReport
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desk.DeskViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import javax.inject.Inject

/** «التقويم» of the space the person is in (`GET /api/calendar`): a month, «مهامي فقط», and moving a task to another day. */
@HiltViewModel
class CalendarViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<CalendarAnswer>(session) {
    private var job: Job? = null

    /** A newer read cancels the older one, so a slow month never lands under another. */
    fun refresh(month: String?, mine: Boolean) {
        job?.cancel()
        job = viewModelScope.launch { load { api.calendar(month, if (mine) "1" else null) } }
    }

    /** The grid's drop (calendar-grid.tsx): the day as a day, the server makes it noon in the company's zone (`PATCH /api/tasks/[id]`). */
    fun moveTo(taskId: String, day: String, month: String?, mine: Boolean) = viewModelScope.launch {
        act({ api.patchTaskRaw(taskId, buildJsonObject { put("dueDate", JsonPrimitive(day)) }) }) { say(O.moved); refresh(month, mine) }
    }
}

/** «الناس» (`GET /api/people`): the staff directory, read-only. */
@HiltViewModel
class PeopleViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<PeopleAnswer>(session) {
    fun refresh() = viewModelScope.launch { load { api.staff() } }
}

/** One person (`GET /api/users/[id]`) and «راسله» (`POST /api/chat/dm`, the same as the chat's). */
@HiltViewModel
class ProfileViewModel @Inject constructor(private val api: WorkspaceApi, session: Session, handle: SavedStateHandle) : DeskViewModel<Profile>(session) {
    val id: String = checkNotNull(handle["id"])
    fun refresh() = viewModelScope.launch { load { api.profile(id).profile } }
    private var opening = false

    /** one conversation per tap: a double tap never pushes two chat screens */
    fun message(then: (String) -> Unit) = viewModelScope.launch {
        if (opening) return@launch
        opening = true
        try {
            when (val r = apiCall { api.openDm(DmBody(userId = id)) }) {
                is ApiResult.Ok -> then(r.value.id)
                is ApiResult.Err -> say(r.failure.message)
            }
        } finally {
            opening = false
        }
    }
}

/** The report's filters, as the site's form sends them. */
data class TimeQuery(val from: String? = null, val to: String? = null, val userId: String? = null, val projectId: String? = null)

/**
 * «تقرير الوقت» (`GET /api/time/report`). ⚠️ Without a space the route reads every space of the person while the page reads the space they are
 * in. 🔧 The space the person is in is always sent, as the page does.
 */
@HiltViewModel
class TimeViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<TimeReport>(session) {
    private val _query = MutableStateFlow(TimeQuery())
    val query: StateFlow<TimeQuery> = _query.asStateFlow()
    private var job: Job? = null

    /** another filter starts empty: the old report never shows under the new person or project */
    fun set(q: TimeQuery, spaceId: String?) {
        if (q != _query.value) _state.value = io.zakiai.workspace.feature.work.Screen()
        _query.value = q
        refresh(spaceId)
    }

    fun refresh(spaceId: String?) {
        job?.cancel()
        val q = _query.value
        job = viewModelScope.launch { load { api.timeReport(q.from, q.to, q.userId, q.projectId, spaceId) } }
    }
}

/** «التذاكر»: «تذاكري», the departments, one department's desk, and a new ticket in it. */
@HiltViewModel
class TicketsViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<TicketsAnswer>(session) {
    private val _departments = MutableStateFlow<DepartmentsAnswer?>(null)
    val departments: StateFlow<DepartmentsAnswer?> = _departments.asStateFlow()
    private var job: Job? = null
    private var shown: String? = "\u0000"

    /** [department] null: «تذاكري» (`/api/tickets/mine`); else that department's desk. Another desk starts empty (never the old list under its pill). */
    fun refresh(department: String?) {
        job?.cancel()
        if (shown != department) { shown = department; _state.value = io.zakiai.workspace.feature.work.Screen() }
        job = viewModelScope.launch {
            // read again each time: a department added (or a person added to one) shows at the next refresh
            (apiCall { api.departments() } as? ApiResult.Ok)?.let { _departments.value = it.value }
            load { if (department == null) api.myTickets() else api.departmentTickets(department) }
        }
    }

    fun create(department: String, title: String, description: String, priority: String, assigneeId: String?, done: () -> Unit) = viewModelScope.launch {
        act({ api.newTicket(department, NewTicketBody(title.trim(), description.trim().ifBlank { null }, priority, assigneeId)) }) {
            done(); say(O.ticketCreated); refresh(department)
        }
    }
}

/**
 * ONE TICKET (`GET /api/tickets/[id]/detail`): status, priority, who it is with, the comments. Kept in memory only: ⚠️ the customer's number the
 * server sends to the ticket's readers is never stored on the phone. 🔧 Nothing of a ticket goes to the app's database or its logs.
 */
@HiltViewModel
class TicketViewModel @Inject constructor(private val api: WorkspaceApi, session: Session, handle: SavedStateHandle) : DeskViewModel<TicketDetail>(session) {
    val id: String = checkNotNull(handle["id"])
    fun refresh() = viewModelScope.launch { load { api.ticket(id).ticket } }
    fun patch(p: TicketPatch) = viewModelScope.launch { act({ api.patchTicket(id, p) }) { say(O.updated); refresh() } }
    fun comment(body: String, done: () -> Unit) = viewModelScope.launch {
        if (body.isBlank()) return@launch
        act({ api.commentTicket(id, CommentBody(body.trim())) }) { done(); say(O.commentAdded); refresh() }
    }
}
