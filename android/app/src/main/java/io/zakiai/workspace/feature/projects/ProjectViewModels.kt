package io.zakiai.workspace.feature.projects

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Cache
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.BoardAnswer
import io.zakiai.workspace.core.net.GoalProgressBody
import io.zakiai.workspace.core.net.GoalsAnswer
import io.zakiai.workspace.core.net.MilestoneStatusBody
import io.zakiai.workspace.core.net.Milestone
import io.zakiai.workspace.core.net.MoveBody
import io.zakiai.workspace.core.net.NewBoardBody
import io.zakiai.workspace.core.net.NewColumnBody
import io.zakiai.workspace.core.net.NewMilestoneBody
import io.zakiai.workspace.core.net.NewProjectBody
import io.zakiai.workspace.core.net.NewTaskBody
import io.zakiai.workspace.core.net.ProjectAnswer
import io.zakiai.workspace.core.net.ProjectsAnswer
import io.zakiai.workspace.core.net.TimelineAnswer
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.work.Screen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** «المشاريع»: the projects of the space the person is in (`GET /api/work/projects`), opened with the phone's last copy. */
@HiltViewModel
class ProjectsViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private val _state = MutableStateFlow(Screen<ProjectsAnswer>())
    val state: StateFlow<Screen<ProjectsAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, ProjectsAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, ProjectsAnswer.serializer()) { apiCall { api.workProjects() } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403)
            }
        }
    }

    /** «مشروع جديد» in the space the person is in; the server decides whether they may. */
    fun create(name: String, then: (String) -> Unit) = viewModelScope.launch {
        val space = _state.value.data?.space ?: return@launch
        when (val r = apiCall { api.newProject(NewProjectBody(workspaceId = space.id, name = name.trim())) }) {
            is ApiResult.Ok -> { refresh(); then(r.value.project.id) }
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }

    companion object { const val KEY = "projects" }
}

/**
 * ONE PROJECT: its head, boards and progress (`GET /api/work/projects/[id]`); the board of the chosen tab is a [BoardViewModel] of its own;
 * the timeline and the milestones are read when their tab opens.
 */
@HiltViewModel
class ProjectViewModel @Inject constructor(
    private val api: WorkspaceApi,
    private val cache: Cache,
    private val session: Session,
    handle: SavedStateHandle,
) : ViewModel() {
    val id: String = checkNotNull(handle["id"])
    private val key = "project:$id"
    private val _state = MutableStateFlow(Screen<ProjectAnswer>())
    val state: StateFlow<Screen<ProjectAnswer>> = _state.asStateFlow()
    private val _timeline = MutableStateFlow(Screen<TimelineAnswer>())
    val timeline: StateFlow<Screen<TimelineAnswer>> = _timeline.asStateFlow()
    private val _milestones = MutableStateFlow<List<Milestone>?>(null)
    val milestones: StateFlow<List<Milestone>?> = _milestones.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { cache.read(key, ProjectAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(key, ProjectAnswer.serializer()) { apiCall { api.workProject(id) } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    fun loadTimeline() = viewModelScope.launch {
        when (val r = apiCall { api.timeline(id) }) {
            is ApiResult.Ok -> _timeline.value = Screen(r.value)
            is ApiResult.Err -> _timeline.value = _timeline.value.copy(failure = r.failure)
        }
    }

    fun loadMilestones() = viewModelScope.launch {
        (apiCall { api.milestones(id) } as? ApiResult.Ok)?.let { _milestones.value = it.value.milestones }
    }

    fun addMilestone(name: String, date: String?) = viewModelScope.launch {
        when (val r = apiCall { api.newMilestone(id, NewMilestoneBody(name.trim(), date)) }) {
            is ApiResult.Ok -> loadMilestones()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun toggleMilestone(m: Milestone) = viewModelScope.launch {
        val next = if (m.status == "COMPLETED") "OPEN" else "COMPLETED"
        when (val r = apiCall { api.milestoneStatus(m.id, MilestoneStatusBody(next)) }) {
            is ApiResult.Ok -> loadMilestones()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun addBoard(name: String) = viewModelScope.launch {
        when (val r = apiCall { api.newBoard(NewBoardBody(projectId = id, name = name.trim())) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }
}

/**
 * ONE BOARD: the columns and the cards (`GET /api/work/boards/[id]`). A drag is drawn at once ([BoardLogic.moved]) and sent through the
 * site's `POST /api/tasks/[id]/move`; a refused move puts the board back as it was and says why.
 */
@HiltViewModel
class BoardViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private var boardId: String? = null
    private val _state = MutableStateFlow(Screen<BoardAnswer>())
    val state: StateFlow<Screen<BoardAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    /** a move in flight: a refresh that lands meanwhile must not snap the card back */
    private var moving = 0

    fun open(id: String) {
        if (boardId == id) return
        boardId = id
        _state.value = Screen()
        viewModelScope.launch { cache.read("board:$id", BoardAnswer.serializer())?.let { c -> if (_state.value.data == null && boardId == id) _state.value = _state.value.copy(data = c) } }
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        val id = boardId ?: return@launch
        val r = cache.refresh("board:$id", BoardAnswer.serializer()) { apiCall { api.workBoard(id) } }
        if (boardId != id || moving > 0) return@launch
        when (r) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403 || r.failure.status == 404)
            }
        }
    }

    fun move(cardId: String, toColumn: String, overIndex: Int?) = viewModelScope.launch {
        val data = _state.value.data ?: return@launch
        val before = data.tasks
        val card = before.firstOrNull { it.id == cardId } ?: return@launch
        val index = BoardLogic.dropIndex(before, cardId, toColumn, overIndex)
        val done = data.columns.firstOrNull { it.id == toColumn }?.done == true
        if (card.columnId == toColumn && index == null) return@launch
        _state.value = _state.value.copy(data = data.copy(tasks = BoardLogic.moved(before, cardId, toColumn, index, done)))
        moving++
        val r = apiCall { api.move(cardId, MoveBody(toColumn, index)) }
        moving--
        if (r is ApiResult.Err) {
            _state.value.data?.let { _state.value = _state.value.copy(data = it.copy(tasks = before)) }
            _notice.value = r.failure.message
        }
        if (moving == 0) refresh()
    }

    fun addCard(columnId: String, title: String) = viewModelScope.launch {
        val b = _state.value.data?.board ?: return@launch
        val body = NewTaskBody(workspaceId = b.workspaceId, projectId = b.projectId, boardId = b.id, columnId = columnId, title = title.trim())
        when (val r = apiCall { api.newTask(body) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun addColumn(name: String) = viewModelScope.launch {
        val id = boardId ?: return@launch
        when (val r = apiCall { api.newColumn(id, NewColumnBody(name.trim())) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }
}

/** «الأهداف»: the goals of the space (`GET /api/goals`); the progress slider writes through the site's `PATCH /api/goals/[id]`. */
@HiltViewModel
class GoalsViewModel @Inject constructor(private val api: WorkspaceApi, private val cache: Cache, private val session: Session) : ViewModel() {
    private val _state = MutableStateFlow(Screen<GoalsAnswer>())
    val state: StateFlow<Screen<GoalsAnswer>> = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    init {
        viewModelScope.launch { cache.read(KEY, GoalsAnswer.serializer())?.let { c -> if (_state.value.data == null) _state.value = _state.value.copy(data = c) } }
    }

    fun refresh() = viewModelScope.launch {
        when (val r = cache.refresh(KEY, GoalsAnswer.serializer()) { apiCall { api.goals() } }) {
            is ApiResult.Ok -> _state.value = Screen(r.value)
            is ApiResult.Err -> {
                if (r.failure.signedOut) session.expired(r.failure)
                _state.value = _state.value.copy(failure = r.failure, closed = r.failure.status == 403)
            }
        }
    }

    fun setProgress(goalId: String, value: Int) = viewModelScope.launch {
        when (val r = apiCall { api.goalProgress(goalId, GoalProgressBody(value.coerceIn(0, 100))) }) {
            is ApiResult.Ok -> refresh()
            is ApiResult.Err -> _notice.value = r.failure.message
        }
    }

    fun consumeNotice() { _notice.value = null }

    companion object { const val KEY = "goals" }
}
