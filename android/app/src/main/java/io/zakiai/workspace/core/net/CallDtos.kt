package io.zakiai.workspace.core.net

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/*
 * CALLS (M2 N5) — what the site's call routes answer (src/server/services/calls.ts `CallDto`, `callPass`). The media itself never passes
 * through the app's server: the pass opens the site's own LiveKit room `zk-<callId>`, the same room the browser joins.
 */

@Serializable
data class CallPerson(val userId: String = "", val name: String = "", val canRemove: Boolean = false, val canMute: Boolean = false, val avatarUrl: String? = null)

@Serializable
data class CallStarter(val id: String = "", val name: String = "", val avatarUrl: String? = null)

@Serializable
data class CallCan(val invite: Boolean = false, val end: Boolean = false)

@Immutable
@Serializable
data class CallDetail(
    val id: String = "",
    val title: String? = null,
    val conversationId: String? = null,
    val conversationTitle: String? = null,
    val video: Boolean = false,
    /** DM · GROUP · TOPIC · MEETING */
    val kind: String = "DM",
    val startedByMe: Boolean = false,
    val answered: Boolean = false,
    /** declined · missed · answered · null while it runs */
    val endedHow: String? = null,
    val startedAt: String? = null,
    val endedAt: String? = null,
    val startedBy: CallStarter? = null,
    val people: List<CallPerson> = emptyList(),
    val can: CallCan = CallCan(),
)

/** `POST /api/calls/[id]/token`: the LiveKit address and a two-minute pass for this person. */
@Serializable
data class CallPass(val url: String = "", val token: String = "", val room: String = "", val noiseFilter: Boolean = false)

@Serializable
data class CallTokenBody(val prefetch: Boolean? = null)

@Serializable
data class CallUserBody(val userId: String)
