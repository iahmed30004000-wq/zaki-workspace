package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * M2 N6, batch 2 — «التقويم» (GET /api/calendar), the staff directory (GET /api/people), a person's profile (GET /api/users/[id]),
 * «تقرير الوقت» (GET /api/time/report) and «التذاكر» (GET /api/tickets/mine, /api/departments, /api/departments/[id]/tickets,
 * /api/tickets/[id]/detail and their writes). Only the fields the phone draws; every field has a default.
 */

// ── «التقويم» ─────────────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class CalTask(val id: String = "", val key: String = "", val title: String = "", val dueDate: String = "")

@Serializable
data class CalSpace(val id: String = "", val name: String = "")

@Serializable
data class CalendarAnswer(
    val space: CalSpace? = null,
    val month: String = "",
    val todayIso: String = "",
    val timeZone: String = "Asia/Damascus",
    val editable: Boolean = false,
    val mine: Boolean = false,
    val tasks: List<CalTask> = emptyList(),
)

// ── the staff directory and a profile ─────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class StaffPerson(
    val id: String = "",
    val name: String = "",
    val jobTitle: String? = null,
    val role: String = "MEMBER",
    val email: String? = null,
    val avatarUrl: String? = null,
    val verified: Boolean = false,
)

@Serializable
data class PeopleAnswer(val people: List<StaffPerson> = emptyList())

@Serializable
data class ProfileStats(val ideasCreated: Int = 0, val ideasVotesReceived: Int = 0, val openTasksAssigned: Int = 0, val tasksCompleted: Int = 0)

@Serializable
data class SharedSpace(val id: String = "", val name: String = "", val emoji: String? = null)

@Serializable
data class Profile(
    val id: String = "",
    val name: String = "",
    val jobTitle: String? = null,
    val bio: String? = null,
    val createdAt: String? = null,
    val organizationName: String? = null,
    val organizationRole: String? = null,
    val avatarUrl: String? = null,
    /** null on a guest's limited view (names only) */
    val stats: ProfileStats? = null,
    val sharedSpaces: List<SharedSpace> = emptyList(),
    val lastSeenAt: String? = null,
    val online: Boolean? = null,
    val hue: Int? = null,
)

@Serializable
data class ProfileAnswer(val profile: Profile = Profile())

// ── «تقرير الوقت» ─────────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class TimeRow(
    val id: String = "",
    val day: String = "",
    val userId: String = "",
    val userName: String = "",
    val projectName: String? = null,
    val taskId: String? = null,
    val taskKey: String? = null,
    val taskTitle: String = "",
    val seconds: Long = 0,
    val note: String = "",
    /** TIMER · MANUAL */
    val source: String = "TIMER",
    val autoStopped: Boolean = false,
)

@Serializable
data class TimeGroup(val key: String = "", val label: String = "", val seconds: Long = 0)

@Serializable
data class NamedRef(val id: String = "", val name: String = "")

@Serializable
data class TimeFilters(val userId: String? = null, val projectId: String? = null, val taskId: String? = null, val workspaceId: String? = null)

@Serializable
data class TimeReport(
    val from: String = "",
    val to: String = "",
    val timeZone: String = "Asia/Damascus",
    val totalSeconds: Long = 0,
    val rows: List<TimeRow> = emptyList(),
    val byPerson: List<TimeGroup> = emptyList(),
    val byProject: List<TimeGroup> = emptyList(),
    val byDay: List<TimeGroup> = emptyList(),
    val people: List<NamedRef> = emptyList(),
    val canPickPerson: Boolean = false,
    val spaces: List<NamedRef> = emptyList(),
    val projects: List<NamedRef> = emptyList(),
    val filters: TimeFilters = TimeFilters(),
)

// ── «التذاكر» ─────────────────────────────────────────────────────────────────────────────────────────────

@Serializable
data class TicketDept(val id: String = "", val name: String = "", val emoji: String? = null)

@Immutable
@Serializable
data class TicketItem(
    val id: String = "",
    val number: Int = 0,
    val title: String = "",
    val description: String? = null,
    /** OPEN · IN_PROGRESS · RESOLVED · CLOSED */
    val status: String = "OPEN",
    /** URGENT · HIGH · NORMAL · LOW */
    val priority: String = "NORMAL",
    val createdAt: String = "",
    val department: TicketDept? = null,
    val creator: NamedRef? = null,
    val assignee: NamedRef? = null,
)

@Serializable
data class TicketsAnswer(val tickets: List<TicketItem> = emptyList())

@Immutable
@Serializable
data class Department(
    val id: String = "",
    val name: String = "",
    val emoji: String? = null,
    val leadId: String? = null,
    val members: List<NamedRef> = emptyList(),
    val openTickets: Int = 0,
)

@Serializable
data class DepartmentsAnswer(val departments: List<Department> = emptyList())

@Serializable
data class TicketComment(val id: String = "", val body: String = "", val editedAt: String? = null, val createdAt: String = "", val author: NamedRef = NamedRef())

@Serializable
data class TicketActivity(val id: String = "", val event: String = "", val createdAt: String = "", val actor: NamedRef = NamedRef())

@Serializable
data class TicketTaskLink(val state: String = "hidden", val id: String? = null, val key: String? = null, val title: String? = null)

@Serializable
data class TicketDetail(
    val id: String = "",
    val departmentId: String? = null,
    val number: Int = 0,
    val title: String = "",
    val description: String? = null,
    val status: String = "OPEN",
    val priority: String = "NORMAL",
    val resolvedAt: String? = null,
    val createdAt: String = "",
    val creatorId: String = "",
    val assigneeId: String? = null,
    /**
     * ⚠️ A customer's number, decrypted by the server for the ticket's readers only. 🔧 Drawn on screen and never stored on the phone
     * (no cache, no log): the app keeps tickets in memory only.
     */
    val customerNumber: String? = null,
    val creator: NamedRef = NamedRef(),
    val assignee: NamedRef? = null,
    val comments: List<TicketComment> = emptyList(),
    val task: TicketTaskLink? = null,
)

@Serializable
data class TicketDetailAnswer(val ticket: TicketDetail = TicketDetail())

@Serializable
data class NewTicketBody(val title: String, val description: String? = null, val priority: String = "NORMAL", val assigneeId: String? = null)

@Serializable
data class TicketPatch(val status: String? = null, val priority: String? = null, val assigneeId: String? = null)

// a comment's body is the work sheet's `CommentBody` ({ body }), the same shape
