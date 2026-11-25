package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * «المشاريع» (M2 N3) — what the site's doors answer: GET /api/work/projects, /api/work/projects/[id], /api/work/boards/[id] (one shared
 * service with the pages, src/server/services/work-app.ts), the project's timeline and milestones, and «الأهداف» (GET /api/goals).
 * Only the fields the phone draws; a field the server adds later is ignored, one it leaves out takes its default.
 */

// ── the projects of the space (GET /api/work/projects) ─────────────────────────────────────────────────────

@Immutable
@Serializable
data class ProjectRow(
    val id: String = "",
    val name: String = "",
    val systemKey: String? = null,
    val description: String? = null,
    val status: String = "PLANNING",
    val priority: String = "NORMAL",
    val targetDate: String? = null,
    val workspaceName: String = "",
    val tasks: Int = 0,
    val boards: Int = 0,
)

@Serializable
data class ProjectsSpace(val id: String = "", val name: String = "", val description: String? = null, val manager: Boolean = false)

@Serializable
data class ProjectsAnswer(
    val space: ProjectsSpace? = null,
    val inboxes: List<ProjectRow> = emptyList(),
    val projects: List<ProjectRow> = emptyList(),
    val canCreate: Boolean = false,
)

@Serializable
data class NewProjectBody(val workspaceId: String, val name: String, val description: String? = null, val targetDate: String? = null)

@Serializable
data class NewProjectAnswer(val project: ProjectRef = ProjectRef())

@Serializable
data class ProjectRef(val id: String = "", val name: String = "", val status: String = "")

// ── one project (GET /api/work/projects/[id]) ─────────────────────────────────────────────────────────────

@Serializable
data class ProjectHead(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val status: String = "PLANNING",
    val targetDate: String? = null,
    val teamId: String? = null,
    val workspaceId: String = "",
    val workspaceName: String = "",
)

@Immutable
@Serializable
data class BoardRef(val id: String = "", val name: String = "", val tasks: Int = 0)

@Serializable
data class ProjectProgress(val open: Int = 0, val done: Int = 0, val pct: Int = 0)

@Serializable
data class ProjectAccess(
    val canEdit: Boolean = false,
    val milestonesOn: Boolean = false,
    val canEditMilestones: Boolean = false,
)

@Serializable
data class ProjectAnswer(
    val project: ProjectHead = ProjectHead(),
    val boards: List<BoardRef> = emptyList(),
    val progress: ProjectProgress = ProjectProgress(),
    val access: ProjectAccess = ProjectAccess(),
    val pinned: List<PinnedCard> = emptyList(),
)

@Serializable
data class NewBoardBody(val projectId: String, val name: String)

@Serializable
data class NewBoardAnswer(val board: BoardRef = BoardRef())

// ── one board (GET /api/work/boards/[id]) ─────────────────────────────────────────────────────────────────

@Serializable
data class BoardHead(
    val id: String = "",
    val name: String = "",
    val workspaceId: String = "",
    val workspaceName: String = "",
    val projectId: String = "",
    val projectName: String = "",
)

@Immutable
@Serializable
data class BoardColumn(val id: String = "", val name: String = "", val color: String = "#6b7280", val position: Double = 0.0, val done: Boolean = false)

@Immutable
@Serializable
data class CardLabel(val id: String = "", val name: String = "", val color: String = "#6b7280")

@Serializable
data class CardPerson(val id: String = "", val name: String = "")

@Immutable
@Serializable
data class BoardCard(
    val id: String = "",
    val key: String = "",
    val title: String = "",
    val priority: String = "NORMAL",
    val columnId: String = "",
    val dueDate: String? = null,
    val labels: List<CardLabel> = emptyList(),
    val assignee: CardPerson? = null,
    val assigneeNames: List<String> = emptyList(),
    val commentCount: Int = 0,
    val completed: Boolean = false,
    val steps: StepProgress? = null,
    val pinned: Boolean = false,
    val running: Boolean = false,
    val recurring: Boolean = false,
)

@Serializable
data class BoardAnswer(
    val board: BoardHead = BoardHead(),
    val columns: List<BoardColumn> = emptyList(),
    val tasks: List<BoardCard> = emptyList(),
    val canEdit: Boolean = false,
)

@Serializable
data class NewColumnBody(val name: String)

@Serializable
data class ColumnAnswer(val column: BoardColumn = BoardColumn())

// ── the timeline (GET /api/projects/[id]/timeline) ────────────────────────────────────────────────────────

@Immutable
@Serializable
data class TimelineTask(
    val id: String = "",
    val title: String = "",
    val start: String? = null,
    val end: String? = null,
    val done: Boolean = false,
    val priority: String = "NORMAL",
    val assignee: String? = null,
)

@Immutable
@Serializable
data class TimelineMilestone(val id: String = "", val name: String = "", val date: String? = null, val status: String = "OPEN")

@Serializable
data class TimelineProject(val id: String = "", val name: String = "", val startDate: String? = null, val targetDate: String? = null)

@Serializable
data class UndatedTask(val id: String = "", val title: String = "")

@Serializable
data class TimelineAnswer(
    val project: TimelineProject = TimelineProject(),
    val tasks: List<TimelineTask> = emptyList(),
    val milestones: List<TimelineMilestone> = emptyList(),
    val undated: List<UndatedTask> = emptyList(),
)

// ── milestones (GET/POST /api/projects/[id]/milestones, PATCH/DELETE /api/milestones/[id]) ────────────────

@Immutable
@Serializable
data class Milestone(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val status: String = "OPEN",
    val targetDate: String? = null,
    val overdue: Boolean = false,
    val openTasks: Int = 0,
)

@Serializable
data class MilestonesAnswer(val milestones: List<Milestone> = emptyList())

@Serializable
data class NewMilestoneBody(val name: String, val targetDate: String? = null)

@Serializable
data class MilestoneStatusBody(val status: String)

// ── «الأهداف» (GET /api/goals) ─────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class KeyResult(
    val id: String = "",
    val title: String = "",
    val startValue: Double = 0.0,
    val targetValue: Double = 100.0,
    val currentValue: Double = 0.0,
    val unit: String? = null,
    val percent: Double = 0.0,
)

@Immutable
@Serializable
data class Goal(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val period: String = "WEEKLY",
    val periodStart: String = "",
    val periodEnd: String = "",
    val progress: Double = 0.0,
    val fromKeyResults: Boolean = false,
    val ownerName: String? = null,
    val light: String? = null,
    val keyResults: List<KeyResult> = emptyList(),
    val canEdit: Boolean = false,
)

@Serializable
data class GoalsAnswer(val goals: List<Goal> = emptyList(), val okr: Boolean = false)

@Serializable
data class GoalProgressBody(val progress: Int)
