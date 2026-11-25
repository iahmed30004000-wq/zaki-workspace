package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * «اليوم», «مهامي» AND ONE TASK — what the site's doors answer (src/app/api/today, /api/my-work, /api/tasks/[id]/sheet, the task's own
 * write routes). Only the fields the phone draws; a field the server adds later is ignored, one it leaves out takes its default.
 */

// ── «اليوم» (GET /api/today) ──────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class TodayTask(
    val id: String = "",
    val title: String = "",
    val projectId: String = "",
    val projectName: String = "",
    val priority: String = "NORMAL",
    val priorityLabel: String = "",
    /** already in Arabic (the company's day): «اليوم», «متأخرة ٣ أيام» … */
    val dueLabel: String? = null,
    val editable: Boolean = false,
)

@Immutable
@Serializable
data class TodayCounts(val open: Int = 0, val overdue: Int = 0, val today: Int = 0, val later: Int = 0, val doneToday: Int = 0)

@Immutable
@Serializable
data class TodayTasks(
    val overdue: List<TodayTask> = emptyList(),
    val today: List<TodayTask> = emptyList(),
    val later: List<TodayTask> = emptyList(),
    val counts: TodayCounts = TodayCounts(),
)

@Immutable
@Serializable
data class Greeting(val period: String = "morning", val firstName: String = "")

@Immutable
@Serializable
data class TodayProject(val id: String = "", val name: String = "", val statusLabel: String = "", val openTasks: Int = 0)

@Immutable
@Serializable
data class QuickTarget(val projectId: String = "", val projectName: String = "", val workspaceId: String = "", val workspaceName: String = "", val boardId: String = "")

@Immutable
@Serializable
data class QuickAdd(val assigneeId: String? = null, val targets: List<QuickTarget> = emptyList(), val dueToday: String? = null, val dueTomorrow: String? = null)

@Immutable
@Serializable
data class TodayData(
    val greeting: Greeting = Greeting(),
    val dateLabel: String = "",
    val hasSpaces: Boolean = true,
    val isExternal: Boolean = false,
    val tasks: TodayTasks = TodayTasks(),
    val projects: List<TodayProject> = emptyList(),
    val quickAdd: QuickAdd? = null,
)

@Immutable
@Serializable
data class MyWeek(val open: Int = 0, val overdue: Int = 0, val dueToday: Int = 0, val doneWeek: Int = 0, val weekTotal: Int = 0, val percent: Int? = null)

@Immutable
@Serializable
data class TodayDashboard(val mine: MyWeek? = null, val unreadChat: Int = 0)

@Immutable
@Serializable
data class InboxRow(val id: String = "", val kind: String = "", val title: String = "", val href: String? = null, val place: String? = null, val at: String? = null, val count: Int = 0)

@Immutable
@Serializable
data class InboxCard(val total: Int = 0, val rows: List<InboxRow> = emptyList())

@Immutable
@Serializable
data class FollowUp(val id: String = "", val title: String = "", val dueLabel: String = "", val late: Boolean = false)

@Immutable
@Serializable
data class PinnedCard(val id: String = "", val key: String = "", val title: String = "", val dueDate: String? = null, val completed: Boolean = false, val projectName: String = "")

@Immutable
@Serializable
data class SpaceSummary(val id: String = "", val name: String = "", val emoji: String? = null, val open: Int = 0, val overdue: Int = 0, val unread: Int = 0)

@Immutable
@Serializable
data class TodayCards(val reminders: Boolean = false, val time: Boolean = false, val checkins: Boolean = false)

@Immutable
@Serializable
data class TodaySpace(val id: String = "", val name: String = "", val kind: String = "")

@Immutable
@Serializable
data class TodayAnswer(
    val space: TodaySpace? = null,
    val today: TodayData = TodayData(),
    val mission: TodayTask? = null,
    val dashboard: TodayDashboard? = null,
    val waiting: InboxCard? = null,
    val mentions: InboxCard? = null,
    val followUps: List<FollowUp> = emptyList(),
    val pinned: List<PinnedCard> = emptyList(),
    val bySpace: List<SpaceSummary>? = null,
    val cards: TodayCards = TodayCards(),
)

// ── «مهامي» (GET /api/my-work?tab=) ────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class WorkTask(
    val id: String = "",
    val key: String = "",
    val title: String = "",
    val priority: String = "NORMAL",
    val dueDate: String? = null,
    val completedAt: String? = null,
    val columnId: String = "",
    val columnName: String = "",
    val columnDone: Boolean = false,
    val columnStage: String = "DOING",
    val workspaceId: String = "",
    val projectId: String = "",
    val projectName: String = "",
    val assigneeIds: List<String> = emptyList(),
    val assigneeNames: List<String> = emptyList(),
    val visibility: String = "SPACE",
    val pinned: Boolean = false,
)

@Immutable
@Serializable
data class WorkRow(val editable: Boolean = false, val task: WorkTask = WorkTask())

@Immutable
@Serializable
data class MyWorkAnswer(val tab: String = "today", val counts: Map<String, Int> = emptyMap(), val rows: List<WorkRow> = emptyList())

// ── one task (GET /api/tasks/[id]/sheet) ───────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class SheetComment(val id: String = "", val author: String = "", val authorId: String = "", val body: String = "", val createdAt: String = "")

@Immutable
@Serializable
data class SheetTask(
    val id: String = "",
    val number: Int = 0,
    val key: String = "",
    val title: String = "",
    val description: String? = null,
    val priority: String = "NORMAL",
    val type: String = "TASK",
    val workspaceId: String = "",
    val projectId: String = "",
    val boardId: String = "",
    val boardName: String = "",
    val columnId: String = "",
    val status: String = "",
    val columnDone: Boolean = false,
    val dueDate: String? = null,
    val completedAt: String? = null,
    val creatorId: String = "",
    val creatorName: String = "",
    val visibility: String = "SPACE",
    val assigneeId: String? = null,
    val assigneeName: String? = null,
    val assigneeIds: List<String> = emptyList(),
    val pinned: Boolean = false,
    val comments: List<SheetComment> = emptyList(),
)

@Immutable
@Serializable
data class SheetPerson(val id: String = "", val name: String = "", val request: Boolean = false)

/** A pending request to give the task to somebody of a higher rank: `addressee` answers it, the `owner` may too, `waiting` is the asker. */
@Immutable
@Serializable
data class AssignRequestRow(val id: String = "", val mode: String = "", val fromName: String = "", val toName: String = "")

@Immutable
@Serializable
data class SheetColumn(val id: String = "", val name: String = "", val done: Boolean = false, val stage: String = "DOING")

@Immutable
@Serializable
data class Step(val id: String = "", val title: String = "", val done: Boolean = false)

@Immutable
@Serializable
data class StepProgress(val done: Int = 0, val total: Int = 0)

@Immutable
@Serializable
data class SheetSteps(val steps: List<Step> = emptyList(), val progress: StepProgress = StepProgress(), val canEdit: Boolean = false)

@Immutable
@Serializable
data class TaskSheet(
    val task: SheetTask = SheetTask(),
    val canEdit: Boolean = false,
    val viewerId: String = "",
    val members: List<SheetPerson> = emptyList(),
    val assignRequests: List<AssignRequestRow> = emptyList(),
    val columns: List<SheetColumn> = emptyList(),
    val steps: SheetSteps? = null,
    val remind: Boolean = false,
    val lockedFields: Boolean = false,
)

// ── writing a task (the site's own routes) ─────────────────────────────────────────────────────────────────

@Serializable
data class CompleteBody(val complete: Boolean)

@Serializable
data class MoveBody(val columnId: String, val index: Int? = null)

/** `PATCH /api/tasks/[id]`: only the fields sent change. A due date is a plain day «YYYY-MM-DD» (noon in the company's zone). */
@Serializable
data class TaskPatch(
    val title: String? = null,
    val description: String? = null,
    val priority: String? = null,
    val assigneeIds: List<String>? = null,
)

@Serializable
data class StepTitle(val title: String)

@Serializable
data class StepPatch(val done: Boolean? = null, val title: String? = null)

@Serializable
data class CommentBody(val body: String)

@Serializable
data class ReturnBody(val reason: String, val requestId: String? = null)

@Serializable
data class AcceptBody2(val requestId: String? = null)

@Serializable
data class NewTaskBody(
    val workspaceId: String,
    val projectId: String,
    val boardId: String,
    val title: String,
    /** a card added inside one column of the board (the board's own آ«+آ»); left out: the board's first column */
    val columnId: String? = null,
    val assigneeId: String? = null,
    val dueDate: String? = null,
)

@Serializable
data class RequestRef(val id: String = "", val toUserId: String = "")

/** A write's answer: only what the phone reads (a reward's amounts the server may add here are never read or kept). */
@Serializable
data class TaskRef(val id: String = "", val assignRequest: RequestRef? = null, val coRequests: List<RequestRef> = emptyList())

@Serializable
data class TaskAnswer(val task: TaskRef = TaskRef())

// ── «ذكّرني» (/api/reminders) ──────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class Reminder(val id: String = "", val title: String = "", val dueAt: String = "", val repeat: String = "NONE", val status: String = "PENDING", val fired: Boolean = false, val taskId: String? = null, val href: String? = null)

@Serializable
data class Reminders(val reminders: List<Reminder> = emptyList())

/** `dueAt`: a full instant (the phone's chosen moment, ISO) — the server refuses a time in the past. */
@Serializable
data class NewReminder(val title: String, val dueAt: String, val taskId: String? = null)
