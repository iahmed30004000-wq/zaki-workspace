package io.zakiai.workspace.feature.desk

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.ApprovalDetail
import io.zakiai.workspace.core.net.ApprovalsAnswer
import io.zakiai.workspace.core.net.CheckinAnswerBody
import io.zakiai.workspace.core.net.CheckinExcuseBody
import io.zakiai.workspace.core.net.CheckinToday
import io.zakiai.workspace.core.net.DecideBody
import io.zakiai.workspace.core.net.IdeasAnswer
import io.zakiai.workspace.core.net.NewIdeaBody
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.work.Screen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One screen's read with its notice, shared by the three sections below. */
abstract class DeskViewModel<T>(protected val session: Session) : ViewModel() {
    protected val _state = MutableStateFlow(Screen<T>())
    val state: StateFlow<Screen<T>> = _state.asStateFlow()
    protected val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    protected suspend fun load(call: suspend () -> T) {
        when (val r = apiCall { call() }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    protected suspend fun act(call: suspend () -> Any, then: () -> Unit) {
        when (val r = apiCall { call() }) {
            is ApiResult.Ok -> then()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }

    fun say(text: String) { _notice.value = text }
}

/** The chat's fetch-and-open, for a request's attachments (the same permission check: `/api/files/<id>/raw`). */
@HiltViewModel
class OpenerViewModel @Inject constructor(val opener: io.zakiai.workspace.feature.chat.ChatFiles) : ViewModel()

/** «الأفكار» of the space (`GET /api/ideas`, the site picks the space): add, vote. */
@HiltViewModel
class IdeasViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<IdeasAnswer>(session) {
    fun refresh() = viewModelScope.launch { load { api.ideas() } }
    fun add(title: String, description: String?) = viewModelScope.launch { act({ api.newIdea(NewIdeaBody(title.trim(), description?.trim()?.ifBlank { null })) }) { refresh() } }
    fun vote(id: String) = viewModelScope.launch {
        // drawn at once, the site's answer then read again
        _state.value.data?.let { d ->
            _state.value = _state.value.copy(data = d.copy(ideas = d.ideas.map { if (it.id == id) it.copy(votedByMe = !it.votedByMe, voteCount = it.voteCount + if (it.votedByMe) -1 else 1) else it }))
        }
        act({ api.voteIdea(id) }) { }
        refresh()
    }
}

/** «التسجيل اليومي» of the space (`GET /api/checkins/today`): the answers, the day off. */
@HiltViewModel
class CheckinsViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<CheckinToday>(session) {
    private var space: String? = null
    fun refresh(spaceId: String?) = viewModelScope.launch { space = spaceId; load { api.checkinToday(spaceId) } }
    fun answer(answers: List<String>) = viewModelScope.launch { act({ api.checkinAnswer(CheckinAnswerBody(space, answers)) }) { refresh(space) } }
    fun excuse(on: Boolean) = viewModelScope.launch { act({ api.checkinExcuse(CheckinExcuseBody(space, on)) }) { refresh(space) } }
}

/** «الموافقات» (`GET /api/approvals?view=`, the space the person is in): «طلباتي», «بانتظاري», and «كل الطلبات» while the site allows it. */
@HiltViewModel
class ApprovalsViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<ApprovalsAnswer>(session) {
    private val _allowAll = MutableStateFlow(true)
    /** «كل الطلبات» is offered until the site refuses it (owner and space managers only) */
    val allowAll: StateFlow<Boolean> = _allowAll.asStateFlow()
    private val _waiting = MutableStateFlow(0)
    val waiting: StateFlow<Int> = _waiting.asStateFlow()

    fun refresh(view: String, spaceId: String?) = viewModelScope.launch {
        when (val r = apiCall { api.approvals(view, spaceId) }) {
            is ApiResult.Ok -> { _state.value = Screen(r.value); if (view == "waiting") _waiting.value = r.value.approvals.size }
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                if (view == "all" && r.failure.status == 403) _allowAll.value = false
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 404)
            }
        }
        // the badge of «بانتظاري» (the site's waitingCount), read from that list
        if (view != "waiting") (apiCall { api.approvals("waiting", spaceId) } as? ApiResult.Ok)?.let { _waiting.value = it.value.approvals.size }
    }
}

/** ONE REQUEST (`GET /api/approvals/[id]`): the decision of the approver whose turn it is, the requester's «ألغِ الطلب». */
@HiltViewModel
class ApprovalViewModel @Inject constructor(private val api: WorkspaceApi, session: Session, handle: SavedStateHandle) : DeskViewModel<ApprovalDetail>(session) {
    val id: String = checkNotNull(handle["id"])
    fun refresh() = viewModelScope.launch { load { api.approval(id).approval } }
    /** «وافق» / «اطلب تعديل» / «ارفض»: a refusal and a change need a reason (the site says so if missing). */
    fun decide(decision: String, reason: String?) = viewModelScope.launch {
        act({ api.decideApproval(id, DecideBody(decision, reason?.trim()?.ifBlank { null })) }) { refresh() }
    }
    fun cancel() = viewModelScope.launch { act({ api.cancelApproval(id) }) { refresh() } }
}
