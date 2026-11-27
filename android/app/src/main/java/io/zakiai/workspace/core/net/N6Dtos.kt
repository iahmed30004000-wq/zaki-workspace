package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * M2 N6, batch 1 — the site's own routes for «الأفكار» (GET/POST /api/ideas), «التسجيل اليومي» (GET /api/checkins/today, answer, excuse)
 * and «الموافقات» (GET /api/approvals, /api/approvals/[id], decide, cancel). Only the fields the phone draws.
 */

// ── «الأفكار» ─────────────────────────────────────────────────────────────────────────────────────────────

@Immutable
@Serializable
data class Idea(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    /** NEW · UNDER_REVIEW · ACCEPTED · REJECTED · PLANNING · LAUNCHED */
    val status: String = "NEW",
    val taskId: String? = null,
    val createdAt: String = "",
    val creatorId: String = "",
    val creatorName: String = "",
    val creatorJobTitle: String? = null,
    val voteCount: Int = 0,
    val votedByMe: Boolean = false,
    val workspaceId: String? = null,
    val spaceName: String? = null,
    val shared: Boolean = false,
)

@Serializable
data class IdeasAnswer(val ideas: List<Idea> = emptyList())

@Serializable
data class NewIdeaBody(val title: String, val description: String? = null)

// ── «التسجيل اليومي» ──────────────────────────────────────────────────────────────────────────────────────

@Serializable
data class CheckinSchedule(val timeOfDay: String = "", val weekdays: List<Int> = emptyList())

@Serializable
data class CheckinRound(val id: String = "", val day: String = "", val questions: List<String> = emptyList(), val open: Boolean = false, val closesAt: String? = null)

@Serializable
data class CheckinMe(
    val participant: Boolean = false,
    val answered: Boolean = false,
    val excused: Boolean = false,
    val answers: List<String> = emptyList(),
    /** the tasks attached on the site: sent back untouched with an edit, or the server would drop them */
    val taskIds: List<String> = emptyList(),
    val canEdit: Boolean = false,
)

@Immutable
@Serializable
data class CheckinRosterRow(val userId: String = "", val name: String = "", val status: String = "pending")

@Immutable
@Serializable
data class CheckinAnswer(val userId: String = "", val userName: String = "", val answers: List<String> = emptyList())

@Serializable
data class CheckinToday(
    val enabled: Boolean = false,
    val canManage: Boolean = false,
    val day: String = "",
    val schedule: CheckinSchedule? = null,
    val round: CheckinRound? = null,
    val me: CheckinMe? = null,
    val roster: List<CheckinRosterRow> = emptyList(),
    val team: List<CheckinAnswer>? = null,
)

@Serializable
data class CheckinAnswerBody(val workspaceId: String? = null, val answers: List<String>, val taskIds: List<String> = emptyList())

@Serializable
data class CheckinExcuseBody(val workspaceId: String? = null, val on: Boolean)

// ── «الموافقات» ───────────────────────────────────────────────────────────────────────────────────────────

@Serializable
data class PersonRef(val id: String = "", val name: String = "")

/** An amount exactly as the server gives it: integer minor units and a currency (the phone never works one out). */
@Serializable
data class Money(val minor: Long = 0, val currency: String = "")

@Serializable
data class ApprovalStep(val position: Int = 0, val approver: PersonRef = PersonRef(), val status: String = "PENDING")

@Immutable
@Serializable
data class ApprovalItem(
    val id: String = "",
    val workspaceName: String? = null,
    val title: String = "",
    /** PENDING · APPROVED · REJECTED · CANCELLED · CHANGES_REQUESTED */
    val status: String = "PENDING",
    val version: Int = 1,
    val requester: PersonRef = PersonRef(),
    val amount: Money? = null,
    val amountHidden: Boolean = false,
    val createdAt: String = "",
    val steps: List<ApprovalStep> = emptyList(),
    val waitingOn: PersonRef? = null,
)

@Serializable
data class ApprovalsAnswer(val approvals: List<ApprovalItem> = emptyList())

@Serializable
data class ApprovalStepDetail(val id: String = "", val position: Int = 0, val approver: PersonRef = PersonRef(), val status: String = "PENDING", val reason: String? = null, val decidedAt: String? = null)

@Serializable
data class ApprovalFile(val id: String = "", val fileId: String = "", val name: String = "", val mimeType: String = "", val size: Long = 0, val url: String = "")

@Serializable
data class ApprovalYou(val requester: Boolean = false, val approver: Boolean = false, val canDecide: Boolean = false, val canCancel: Boolean = false, val canResubmit: Boolean = false, val oversight: Boolean = false)

@Serializable
data class ApprovalDetail(
    val id: String = "",
    val title: String = "",
    val status: String = "PENDING",
    val version: Int = 1,
    val requester: PersonRef = PersonRef(),
    val amount: Money? = null,
    val amountHidden: Boolean = false,
    val details: String? = null,
    val createdAt: String = "",
    val attachments: List<ApprovalFile> = emptyList(),
    val stepsDetail: List<ApprovalStepDetail> = emptyList(),
    val you: ApprovalYou = ApprovalYou(),
)

@Serializable
data class ApprovalDetailAnswer(val approval: ApprovalDetail = ApprovalDetail())

@Serializable
data class DecideBody(val decision: String, val reason: String? = null)
