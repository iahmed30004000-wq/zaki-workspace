package io.zakiai.workspace.feature.routines

import androidx.compose.runtime.Immutable
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.ui.components.ArDate
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/*
 * «روتين المهام» (M2 N6 batch 11) — the site's own routes (src/app/api/daily-routines): the list with what the form may offer,
 * making one, changing one, pausing and resuming. The server decides everything again; the phone only draws.
 */

@Immutable
@Serializable
data class Opt(val id: String, val name: String)

@Immutable
@Serializable
data class Routine(
    val id: String,
    val workspaceId: String,
    val workspaceName: String = "",
    val projectId: String,
    val projectName: String = "",
    val title: String,
    val description: String? = null,
    val assignee: Opt,
    val days: List<Int> = emptyList(),
    val time: String = "",
    val dueTime: String = "",
    val active: Boolean = true,
    val stoppedReason: String? = null,
    val nextRunAt: String? = null,
    val canManage: Boolean = false,
)

@Immutable
@Serializable
data class SpaceOption(val id: String, val name: String, val projects: List<Opt> = emptyList(), val people: List<Opt> = emptyList())

@Immutable
@Serializable
data class RoutinesAnswer(
    val routines: List<Routine> = emptyList(),
    val spaces: List<SpaceOption> = emptyList(),
    val timeZone: String = "",
    val defaultDueTime: String = "18:00",
)

@Serializable
data class RoutineInput(
    val workspaceId: String,
    val projectId: String,
    val title: String,
    val description: String? = null,
    val assigneeId: String,
    val days: List<Int>,
    val time: String,
    val dueTime: String,
)

@Serializable
data class RoutineAction(val action: String)

@Serializable
data class RoutineSaved(val routine: Routine)

interface RoutinesApi {
    @GET("api/daily-routines")
    suspend fun screen(@Header("Cache-Control") cache: String = "no-store"): RoutinesAnswer

    @POST("api/daily-routines")
    suspend fun create(@Body body: RoutineInput): RoutineSaved

    @PATCH("api/daily-routines/{id}")
    suspend fun update(@Path("id") id: String, @Body body: RoutineInput): RoutineSaved

    /** `{ action: "pause" | "resume" }` */
    @PATCH("api/daily-routines/{id}")
    suspend fun act(@Path("id") id: String, @Body body: RoutineAction): RoutineSaved
}

/** A word of the site's own dictionary (generated into [RoutineWords]). */
fun rw(key: String, vararg params: Pair<String, Any?>): String = RoutineWords.s(key, *params)

/** The routines' rules and words, pure (the site's src/lib/daily-routine.ts and routines-view.tsx). */
object RT {
    val EVERY_DAY = listOf(0, 1, 2, 3, 4, 5, 6)
    /** «أيام الدوام»: Sunday to Thursday */
    val WORKING_DAYS = listOf(0, 1, 2, 3, 4)
    val PRESETS = listOf("EVERY", "WORKING", "CUSTOM")
    /** the week as the site draws it: Saturday first */
    val WEEK_ORDER = listOf(6, 0, 1, 2, 3, 4, 5)
    private val CLOCK = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    fun presetOf(days: List<Int>): String {
        fun same(other: List<Int>) = days.size == other.size && other.all { it in days }
        return if (same(EVERY_DAY)) "EVERY" else if (same(WORKING_DAYS)) "WORKING" else "CUSTOM"
    }

    fun daysOf(preset: String, custom: List<Int>): List<Int> = when (preset) {
        "EVERY" -> EVERY_DAY
        "WORKING" -> WORKING_DAYS
        else -> custom.distinct().sorted()
    }

    fun preset(p: String): String = RoutineWords.all["routine.days.$p"] ?: p
    fun day(d: Int): String = RoutineWords.all["recurring.day.$d"] ?: d.toString()

    /** «كل يوم» · «أيام الدوام» · the names of the chosen days */
    fun daysText(days: List<Int>): String {
        val p = presetOf(days)
        if (p != "CUSTOM") return preset(p)
        return WEEK_ORDER.filter { it in days }.joinToString("، ") { day(it) }
    }

    fun forLine(r: Routine): String = rw("routine.for", "name" to r.assignee.name, "space" to r.workspaceName, "project" to r.projectName)
    fun whenLine(r: Routine): String = rw("routine.when", "days" to daysText(r.days), "time" to r.time, "due" to r.dueTime)

    /** «25 تشرين الثاني · 08:00» in the company's zone (the site's `whenLabel`) */
    fun whenLabel(iso: String, zone: String): String? = runCatching {
        val z = runCatching { ZoneId.of(zone) }.getOrDefault(ZoneId.systemDefault())
        val t = Instant.parse(iso).atZone(z)
        ArDate.dm(t.toLocalDate()) + " · " + String.format(Locale.ROOT, "%02d:%02d", t.hour, t.minute)
    }.getOrNull()

    fun stopped(reason: String): String? = RoutineWords.all["routine.stopped.$reason"]

    /** what the form must fix before it sends (the site's own order of checks), or null */
    fun problem(title: String, person: String, days: List<Int>, time: String, due: String): String? = when {
        title.isBlank() -> "routine.title_required"
        person.isEmpty() -> "routine.assignee_required"
        days.isEmpty() -> "routine.days_required"
        !CLOCK.matches(time) || !CLOCK.matches(due) -> "routine.time_invalid"
        due <= time -> "routine.due_after_time"
        else -> null
    }

    /** a refusal in the site's words: the precise validation key first, then the error's key, then what the server said */
    fun refusal(f: ApiFailure): String = (f.detail ?: f.key)?.let { RoutineWords.all[it] } ?: f.message

    /** «08:30» from an hour and a minute */
    fun clock(h: Int, m: Int): String = String.format(Locale.ROOT, "%02d:%02d", h, m)
}
