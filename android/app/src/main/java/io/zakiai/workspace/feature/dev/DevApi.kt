package io.zakiai.workspace.feature.dev

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * «الأداء والتطوير» and «الهيكل» (M2 N6 batch 9) — the section's own routes (src/app/api/team-development/...), shapes of
 * src/server/services/team-*.ts. Who reads whom is decided on the SERVER (the owner everybody, a supervisor their people, anybody else
 * only themselves; outside that 404): the phone draws what it is sent. A review's private note is absent for the person themselves.
 */

@Serializable
data class PeriodChoice(val key: String = "", val kind: String = "month", val label: String = "")

@Serializable
data class DevPersonRow(val userId: String = "", val name: String = "", val jobTitle: String? = null, val role: String = "MEMBER", val supervisor: String? = null)

@Serializable
data class DevHome(val mode: String = "self", val viewerId: String = "", val canManageLines: Boolean = false, val canReview: Boolean = false, val people: List<DevPersonRow> = emptyList())

@Serializable
data class DevHomeAnswer(val home: DevHome = DevHome(), val periods: List<PeriodChoice> = emptyList())

@Serializable
data class ScorePeriod(val key: String = "", val kind: String = "month", val from: String = "", val to: String = "", val partial: Boolean = false)

@Serializable
data class Weights(val manual: Int = 0, val completed: Int = 0, val onTime: Int = 0, val steps: Int = 0)

@Immutable
@Serializable
data class ScoreRow(
    val userId: String = "",
    val name: String = "",
    val jobTitle: String? = null,
    val score: Int? = null,
    val band: String? = null,
    val light: String? = null,
    val suggestedLight: String? = null,
    val reviews: Int = 0,
)

@Serializable
data class ScoreTable(val period: ScorePeriod = ScorePeriod(), val weights: Weights = Weights(), val sort: String = "name", val rows: List<ScoreRow> = emptyList())

@Serializable
data class ScoreTableAnswer(val table: ScoreTable = ScoreTable())

@Serializable
data class Baseline(val value: Double = 0.0, val source: String = "own", val n: Int = 0)

@Serializable
data class Indicator(
    val value: Double? = null,
    val weight: Int = 0,
    val share: Double? = null,
    val average: Double? = null,
    val reviews: Int = 0,
    val count: Int = 0,
    val baseline: Baseline? = null,
    val onTime: Int = 0,
    val withDue: Int = 0,
)

@Serializable
data class Checkins(val answered: Int = 0, val streak: Int = 0)

@Serializable
data class Extras(val openNow: Int = 0, val overdueNow: Int = 0, val messages: Int = 0, val trackedMinutes: Int? = null, val checkins: Checkins? = null)

@Serializable
data class ScoreDetail(
    val userId: String = "",
    val period: ScorePeriod = ScorePeriod(),
    val weights: Weights = Weights(),
    val sharedOnly: Boolean = false,
    val score: Int? = null,
    val band: String? = null,
    val light: String? = null,
    val suggestedLight: String? = null,
    val manual: Indicator = Indicator(),
    val completed: Indicator = Indicator(),
    val onTime: Indicator = Indicator(),
    val steps: Indicator = Indicator(),
    val extras: Extras = Extras(),
)

@Serializable
data class ScoreAnswer(val score: ScoreDetail = ScoreDetail())

@Serializable
data class Named(val userId: String = "", val name: String = "")

@Serializable
data class PersonHeader(
    val userId: String = "",
    val name: String = "",
    val jobTitle: String? = null,
    val role: String = "MEMBER",
    val inactive: Boolean = false,
    val supervisor: Named? = null,
    val isSelf: Boolean = false,
    val canEnter: Boolean = false,
    val asReviewer: Boolean = false,
)

@Serializable
data class PersonAnswer(val person: PersonHeader = PersonHeader(), val periods: List<PeriodChoice> = emptyList())

@Serializable
data class Skill(val id: String = "", val name: String = "", val category: String = "", val description: String = "", val archived: Boolean = false)

@Serializable
data class SkillsAnswer(val skills: List<Skill> = emptyList())

@Serializable
data class Level(val level: Int = 0, val note: String = "", val updatedAt: String = "", val updatedBy: String = "")

@Immutable
@Serializable
data class PersonSkill(val skill: Skill = Skill(), val manual: Level? = null, val self: Level? = null, val gap: Int? = null)

@Serializable
data class PersonSkillsAnswer(val skills: List<PersonSkill> = emptyList())

@Serializable
data class SkillChange(val id: String = "", val skillId: String = "", val source: String = "MANUAL", val oldLevel: Int? = null, val newLevel: Int = 0, val note: String = "", val reason: String = "", val changedBy: String = "", val at: String = "")

@Serializable
data class HistoryAnswer(val history: List<SkillChange> = emptyList())

@Serializable
data class Criterion(val id: String = "", val code: String = "", val name: String = "", val position: Int = 0, val archived: Boolean = false)

@Serializable
data class CriteriaAnswer(val criteria: List<Criterion> = emptyList())

@Immutable
@Serializable
data class Review(
    val id: String = "",
    val reviewerName: String = "",
    val period: String = "",
    val version: Int = 1,
    val status: String = "DRAFT",
    val ratings: Map<String, Int> = emptyMap(),
    val light: String? = null,
    val strengths: String = "",
    val improvement: String = "",
    /** absent for the person themselves: the server never sends it to them */
    val privateNote: String? = null,
    val updatedAt: String = "",
    val mine: Boolean = false,
    val editable: Boolean = false,
    val live: Boolean = true,
)

@Serializable
data class ReviewsAnswer(val reviews: List<Review> = emptyList())

@Immutable
@Serializable
data class Goal(
    val id: String = "",
    val skillId: String? = null,
    val skillName: String? = null,
    val title: String = "",
    val targetLevel: Int? = null,
    val actions: String = "",
    val dueDate: String? = null,
    val status: String = "OPEN",
    val proposal: Boolean = false,
    val applied: Boolean = false,
    val createdBy: String = "",
    val canApply: Boolean = false,
    val canEdit: Boolean = false,
)

@Serializable
data class GoalsAnswer(val goals: List<Goal> = emptyList())

@Immutable
@Serializable
data class Note(val id: String = "", val author: String = "", val body: String = "", val shared: Boolean = false, val createdAt: String = "", val mine: Boolean = false, val canShare: Boolean = false)

@Serializable
data class NotesAnswer(val notes: List<Note> = emptyList())

@Immutable
@Serializable
data class StructureNode(
    val userId: String = "",
    val name: String = "",
    val jobTitle: String? = null,
    val role: String = "MEMBER",
    val managerId: String? = null,
    val canEdit: Boolean = false,
    val direct: Int = 0,
    val total: Int = 0,
)

@Serializable
data class MyLine(val userId: String = "", val supervisor: Named? = null, val teamMates: List<Named> = emptyList(), val reports: Int = 0)

@Serializable
data class Structure(
    val mode: String = "own",
    val canManage: Boolean = false,
    val nodes: List<StructureNode> = emptyList(),
    val roots: List<String> = emptyList(),
    val unassigned: List<String> = emptyList(),
    val me: MyLine = MyLine(),
)

@Serializable
data class StructureAnswer(val structure: Structure = Structure())

// ── bodies ──

@Serializable
data class ReviewBody(val period: String, val ratings: Map<String, Int>, val light: String?, val strengths: String, val improvement: String, val privateNote: String, val newVersion: Boolean? = null)

@Serializable
data class StatusBody(val status: String)

@Serializable
data class GoalBody(val skillId: String?, val title: String, val targetLevel: Int?, val actions: String, val dueDate: String?)

@Serializable
data class GoalPatch(val status: String? = null, val accept: Boolean? = null)

@Serializable
data class NoteBody(val body: String, val shared: Boolean)

@Serializable
data class SharedBody(val shared: Boolean)

@Serializable
data class LevelBody(val skillId: String, val source: String, val level: Int, val note: String)

interface DevApi {
    @GET("api/team-development/home")
    suspend fun home(@Header("Cache-Control") cache: String = "no-store"): DevHomeAnswer

    @GET("api/team-development/people")
    suspend fun table(@Query("period") period: String?, @Query("sort") sort: String?): ScoreTableAnswer

    @GET("api/team-development/people/{id}")
    suspend fun person(@Path("id") id: String): PersonAnswer

    @GET("api/team-development/people/{id}/score")
    suspend fun score(@Path("id") id: String, @Query("period") period: String?): ScoreAnswer

    @GET("api/team-development/people/{id}/skills")
    suspend fun skills(@Path("id") id: String): PersonSkillsAnswer

    @GET("api/team-development/people/{id}/skills/history")
    suspend fun history(@Path("id") id: String): HistoryAnswer

    @PUT("api/team-development/people/{id}/skills")
    suspend fun setLevel(@Path("id") id: String, @Body body: LevelBody): JsonObject

    @GET("api/team-development/people/{id}/reviews")
    suspend fun reviews(@Path("id") id: String): ReviewsAnswer

    @GET("api/team-development/criteria")
    suspend fun criteria(@Query("all") all: String = "1"): CriteriaAnswer

    @PUT("api/team-development/people/{id}/reviews")
    suspend fun saveReview(@Path("id") id: String, @Body body: ReviewBody): JsonObject

    @PATCH("api/team-development/reviews/{id}")
    suspend fun advance(@Path("id") id: String, @Body body: StatusBody): JsonObject

    @GET("api/team-development/people/{id}/goals")
    suspend fun goals(@Path("id") id: String): GoalsAnswer

    @GET("api/team-development/skills")
    suspend fun catalogue(): SkillsAnswer

    @POST("api/team-development/people/{id}/goals")
    suspend fun addGoal(@Path("id") id: String, @Body body: GoalBody): JsonObject

    @PATCH("api/team-development/goals/{id}")
    suspend fun patchGoal(@Path("id") id: String, @Body body: GoalPatch): JsonObject

    @POST("api/team-development/goals/{id}/apply")
    suspend fun applyGoal(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): JsonObject

    @GET("api/team-development/people/{id}/notes")
    suspend fun notes(@Path("id") id: String): NotesAnswer

    @POST("api/team-development/people/{id}/notes")
    suspend fun addNote(@Path("id") id: String, @Body body: NoteBody): JsonObject

    @PATCH("api/team-development/notes/{id}")
    suspend fun shareNote(@Path("id") id: String, @Body body: SharedBody): JsonObject

    @GET("api/team-development/lines")
    suspend fun structure(@Header("Cache-Control") cache: String = "no-store"): StructureAnswer

    @PUT("api/team-development/lines/{userId}")
    suspend fun setLine(@Path("userId") userId: String, @Body body: JsonObject): JsonObject
}
