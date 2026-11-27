package io.zakiai.workspace.feature.desks

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * «الحملات», «الأقسام», «الروتين اليومي» (M2 N6 batch 6) — the site's own routes (src/app/api/campaigns, departments, production) and
 * the one door the phone needed, `GET /api/desks/facts` (what the three pages read on the server). Only the fields the phone draws.
 */

@Serializable
data class May(val view: Boolean = false, val edit: Boolean = false, val delete: Boolean = false)

@Serializable
data class DeskFacts(
    val role: String = "MEMBER",
    val external: Boolean = false,
    val spaceOnly: Boolean = false,
    val directory: Boolean = false,
    val manager: Boolean = false,
    val campaigns: May = May(),
    val tickets: May = May(),
    val production: May = May(),
    val departmentId: String? = null,
    val timeZone: String = "",
    val today: String = "",
    val crm: May = May(),
    val prices: Boolean = false,
    val reports: Boolean = false,
    /** owner · team · self, or null when the board is not theirs */
    val board: String? = null,
    val panel: Boolean = false,
    /** «الأداء والتطوير» exists for this person (its switch on, not a partner) */
    val development: Boolean = false,
    /** «كل المساحات»: the owner and the admins */
    val spaces: Boolean = false,
    /** «الحسابات والصلاحيات»: whoever holds `users.manage` */
    val accounts: Boolean = false,
    /** the company the person is in: the accounts' doors carry it */
    val orgId: String = "",
    /** «روتين المهام» exists for this person (the company's switch on, not a partner, the tasks section readable) */
    val routines: Boolean = false,
)

// ── departments ──

@Serializable
data class Member(val id: String = "", val name: String = "", val jobTitle: String? = null, val avatarUrl: String? = null)

@Immutable
@Serializable
data class Department(
    val id: String = "",
    val name: String = "",
    val emoji: String? = null,
    val color: String? = null,
    val leadId: String? = null,
    val members: List<Member> = emptyList(),
    val projectsCount: Int = 0,
    val openTasks: Int = 0,
    val overdueTasks: Int = 0,
    val openTickets: Int = 0,
)

@Serializable
data class Departments(val departments: List<Department> = emptyList())

@Serializable
data class DepartmentBody(val name: String, val emoji: String?, val color: String?, val leadId: String?)

@Serializable
data class MembersBody(val addUserIds: List<String>? = null, val removeUserIds: List<String>? = null)

@Serializable
data class DirectoryUser(val id: String = "", val name: String = "", val jobTitle: String? = null, val avatarUrl: String? = null)

@Serializable
data class DirectoryRow(val userId: String = "", val user: DirectoryUser = DirectoryUser())

@Serializable
data class Directory(val people: List<DirectoryRow> = emptyList())

// ── campaigns ──

@Serializable
data class DeptRef(val id: String = "", val name: String = "", val emoji: String? = null)

@Serializable
data class Count(val items: Int = 0)

@Serializable
data class Owner(val id: String = "", val name: String = "")

@Immutable
@Serializable
data class Campaign(
    val id: String = "",
    val number: Int = 0,
    val title: String = "",
    val description: String? = null,
    val status: String = "DRAFT",
    val priority: String = "NORMAL",
    val startDate: String = "",
    val endDate: String = "",
    val owner: Owner? = null,
    val department: DeptRef? = null,
    @kotlinx.serialization.SerialName("_count") val count: Count = Count(),
)

@Serializable
data class Campaigns(val campaigns: List<Campaign> = emptyList())

@Serializable
data class LinkedTask(val state: String = "", val id: String? = null, val key: String? = null, val title: String? = null)

@Serializable
data class CampaignItem(val id: String = "", val title: String = "", val kind: String = "post", val dueDate: String = "", val doneAt: String? = null, val task: LinkedTask? = null)

@Serializable
data class CampaignDetail(val id: String = "", val items: List<CampaignItem> = emptyList())

@Serializable
data class CampaignAnswer(val campaign: CampaignDetail = CampaignDetail())

@Serializable
data class NewCampaignBody(val title: String, val description: String?, val priority: String, val startDate: String, val endDate: String)

@Serializable
data class CampaignStatusBody(val status: String)

@Serializable
data class MadeTask(val created: Boolean = false, val task: LinkedTask? = null)

// ── the daily routine ──

@Immutable
@Serializable
data class RoutineDay(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val departmentName: String? = null,
    val assigneeId: String? = null,
    val assigneeName: String? = null,
    val doneAt: String? = null,
    val archived: Boolean = false,
)

@Serializable
data class DayAnswer(val day: String = "", val items: List<RoutineDay> = emptyList())

@Serializable
data class CheckBody(val routineId: String, val day: String, val done: Boolean)

@Immutable
@Serializable
data class Routine(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val assigneeId: String? = null,
    val assigneeName: String? = null,
    val weekdays: String = "",
    val active: Boolean = true,
    val convertedTask: LinkedTask? = null,
)

@Serializable
data class Routines(val routines: List<Routine> = emptyList())

@Serializable
data class RoutineBody(val title: String, val description: String?, val assigneeId: String?, val weekdays: List<Int>, val active: Boolean)

interface DesksApi {
    @GET("api/desks/facts")
    suspend fun facts(@Header("Cache-Control") cache: String = "no-store"): DeskFacts

    @GET("api/departments")
    suspend fun departments(@Header("Cache-Control") cache: String = "no-store"): Departments

    @POST("api/departments")
    suspend fun newDepartment(@Body body: DepartmentBody): JsonObject

    @PATCH("api/departments/{id}")
    suspend fun editDepartment(@Path("id") id: String, @Body body: DepartmentBody): JsonObject

    @DELETE("api/departments/{id}")
    suspend fun deleteDepartment(@Path("id") id: String): JsonObject

    @POST("api/departments/{id}/members")
    suspend fun members(@Path("id") id: String, @Body body: MembersBody): JsonObject

    @GET("api/chat/directory")
    suspend fun directory(@Header("Cache-Control") cache: String = "no-store"): Directory

    @GET("api/campaigns/mine")
    suspend fun myCampaigns(@Header("Cache-Control") cache: String = "no-store"): Campaigns

    @GET("api/departments/{id}/campaigns")
    suspend fun campaigns(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): Campaigns

    @POST("api/departments/{id}/campaigns")
    suspend fun newCampaign(@Path("id") id: String, @Body body: NewCampaignBody): JsonObject

    @PATCH("api/campaigns/{id}")
    suspend fun campaignStatus(@Path("id") id: String, @Body body: CampaignStatusBody): JsonObject

    @DELETE("api/campaigns/{id}")
    suspend fun deleteCampaign(@Path("id") id: String): JsonObject

    @GET("api/campaigns/{id}")
    suspend fun campaign(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): CampaignAnswer

    @POST("api/production/campaign-items/{id}/task")
    suspend fun itemTask(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): MadeTask

    @GET("api/production")
    suspend fun day(@Query("day") day: String, @Header("Cache-Control") cache: String = "no-store"): DayAnswer

    @POST("api/production/checklist")
    suspend fun check(@Body body: CheckBody): JsonObject

    @GET("api/production/routines")
    suspend fun routines(@Header("Cache-Control") cache: String = "no-store"): Routines

    @POST("api/production/routines")
    suspend fun newRoutine(@Body body: RoutineBody): JsonObject

    @PATCH("api/production/routines/{id}")
    suspend fun editRoutine(@Path("id") id: String, @Body body: RoutineBody): JsonObject

    @DELETE("api/production/routines/{id}")
    suspend fun deleteRoutine(@Path("id") id: String): JsonObject

    @POST("api/production/routines/{id}/convert")
    suspend fun convert(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): MadeTask
}
