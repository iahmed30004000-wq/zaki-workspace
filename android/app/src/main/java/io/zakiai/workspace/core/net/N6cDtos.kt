package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * M2 N6, batch 3 — «الطلبات» (GET /api/work/requests?tab=waiting|mine, src/components/work/requests/types.ts): the person's own inbox,
 * every row already cut by the server to what they may see. One flat row with a `kind` (approval · assign · ticket · card · sheet);
 * only the fields of its kind are filled. Every field has a default.
 */

@Immutable
@Serializable
data class RequestRow(
    val kind: String = "",
    val id: String = "",
    val title: String = "",
    val at: String = "",
    val href: String = "",
    val place: String? = null,
    // approval
    val byName: String? = null,
    /** the amount as the SERVER wrote it, and only when it handed it to this person */
    val amount: String? = null,
    val status: String? = null,
    val waitingOn: String? = null,
    val canDecide: Boolean = false,
    // assign
    val taskId: String? = null,
    val requestId: String? = null,
    val key: String? = null,
    val fromName: String? = null,
    val toName: String? = null,
    val canAnswer: Boolean = false,
    // ticket
    val priority: String? = null,
    val assignee: String? = null,
    val canTake: Boolean = false,
    val canResolve: Boolean = false,
    // card
    val cardKind: String? = null,
    // sheet
    val version: Int = 0,
)

@Serializable
data class RequestSection(val key: String = "", val total: Int = 0, val rows: List<RequestRow> = emptyList(), val allHref: String? = null)

@Serializable
data class RequestGroup(val spaceId: String? = null, val name: String? = null, val total: Int = 0, val sections: List<RequestSection> = emptyList())

@Serializable
data class RequestsAnswer(
    val tab: String = "waiting",
    val space: CalSpace? = null,
    val groups: List<RequestGroup>? = null,
    val viewerId: String = "",
    val total: Int = 0,
    val sections: List<RequestSection> = emptyList(),
)

// accepting / returning an assignment uses the task sheet's own AcceptBody2 / ReturnBody

@Serializable
data class StatusBody(val status: String, val version: Int? = null)
