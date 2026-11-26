package io.zakiai.workspace.feature.panel

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
 * «العملاء», «التقارير», «لوحة المالك / لوحة التحكم» (M2 N6 batch 7) — the site's own routes (src/app/api/crm, owner-board) and the doors
 * the phone needed (GET /api/analytics, /api/control-panel/home, /api/control-panel/reports). Only the fields the phone draws.
 */

// ── CRM ──

@Immutable
@Serializable
data class Customer(val id: String = "", val name: String = "", val company: String? = null, val email: String? = null, val phone: String? = null, val notes: String? = null)

@Serializable
data class Customers(val customers: List<Customer> = emptyList())

@Serializable
data class CustomerRef(val id: String = "", val name: String = "", val company: String? = null)

@Immutable
@Serializable
data class Opportunity(
    val id: String = "",
    val number: Int = 0,
    val title: String = "",
    /** the amount: null for who does not hold `prices.view` (the server cuts it) */
    val value: Double? = null,
    val stage: String = "LEAD",
    val notes: String? = null,
    val customer: CustomerRef = CustomerRef(),
)

@Serializable
data class Opportunities(val opportunities: List<Opportunity> = emptyList())

@Serializable
data class CustomerBody(val name: String, val company: String?, val email: String?, val phone: String?, val notes: String?)

/** `value` is sent only by who may see prices (the server refuses it otherwise) */
@Serializable
data class OpportunityBody(val customerId: String? = null, val title: String, val value: Double? = null, val stage: String, val notes: String?)

@Serializable
data class StageBody(val stage: String)

// ── «التقارير» ──

@Serializable
data class PriorityN(val priority: String = "", val n: Int = 0)

@Serializable
data class StatusN(val status: String = "", val n: Int = 0)

@Serializable
data class PersonN(val userId: String? = null, val name: String = "", val n: Int = 0)

@Serializable
data class Analytics(
    val total: Int = 0,
    val open: Int = 0,
    val completed: Int = 0,
    val overdue: Int = 0,
    val created30: Int = 0,
    val completed30: Int = 0,
    val upcoming7: Int = 0,
    val ideas: Int = 0,
    val workspaces: Int = 0,
    val projects: Int = 0,
    val byPriority: List<PriorityN> = emptyList(),
    val ideasByStatus: List<StatusN> = emptyList(),
    val workload: List<PersonN> = emptyList(),
)

@Serializable
data class Totals(
    val total: Int = 0,
    val open: Int = 0,
    val completed: Int = 0,
    val overdue: Int = 0,
    val created30: Int = 0,
    val completed30: Int = 0,
    val upcoming7: Int = 0,
    val rate: Double = 0.0,
    val avgDays: Double? = null,
)

@Serializable
data class WeekPoint(val ago: Int = 0, val created: Int = 0, val completed: Int = 0)

@Serializable
data class IdeasPart(val total: Int = 0, val byStatus: List<StatusN> = emptyList())

@Serializable
data class SpaceRow(val id: String = "", val name: String = "", val open: Int = 0, val overdue: Int = 0, val done30: Int = 0)

@Serializable
data class NamedRef(val id: String = "", val name: String = "")

@Serializable
data class PanelReports(
    val spaceId: String? = null,
    val spaces: List<NamedRef> = emptyList(),
    val totals: Totals = Totals(),
    val series: List<WeekPoint> = emptyList(),
    val byPriority: List<PriorityN> = emptyList(),
    val workload: List<PersonN> = emptyList(),
    val ideas: IdeasPart = IdeasPart(),
    val bySpace: List<SpaceRow> = emptyList(),
)

// ── the owner's panel and board ──

@Serializable
data class Kpis(
    val doneToday: Int = 0,
    val overdue: Int = 0,
    val open: Int = 0,
    val completedWeek: Int = 0,
    val completedPrev: Int = 0,
    val completedChange: Double? = null,
    val onTimeRate: Double? = null,
    val onTimePrev: Double? = null,
    val activeToday: Int = 0,
    val staff: Int = 0,
)

@Immutable
@Serializable
data class Insight(val id: String = "", val tone: String = "info", val href: String? = null, val sentence: String = "", val formula: String = "")

@Serializable
data class TodayRow(val userId: String = "", val name: String = "", val tasks: Int = 0, val steps: Int = 0, val messages: Int = 0, val first: String? = null, val last: String? = null)

@Serializable
data class Idle(val userId: String = "", val name: String = "")

@Serializable
data class TodayStrip(val done: List<TodayRow> = emptyList(), val idle: List<Idle> = emptyList())

@Serializable
data class PanelHome(val asOf: String = "", val timeZone: String = "", val kpis: Kpis = Kpis(), val insights: List<Insight> = emptyList(), val todayStrip: TodayStrip = TodayStrip())

@Serializable
data class Window(val from: String = "", val to: String = "", val days: List<String> = emptyList(), val timeZone: String = "", val preset: String? = null)

@Serializable
data class Cards(
    val completed: Int = 0,
    val open: Int = 0,
    val overdue: Int = 0,
    val late: Int = 0,
    val avgDays: Double? = null,
    val messages: Int = 0,
    val activePeople: Int = 0,
    val idlePeople: Int = 0,
)

@Immutable
@Serializable
data class PersonRow(
    val userId: String = "",
    val name: String = "",
    val role: String = "MEMBER",
    val status: String = "ACTIVE",
    val online: Boolean = false,
    val completed: Int = 0,
    val openTasks: Int = 0,
    val overdue: Int = 0,
    val onTimeRate: Double? = null,
    val avgDays: Double? = null,
    val steps: Int = 0,
    val messages: Int = 0,
    val lastActivity: String? = null,
    val spark: List<Int> = emptyList(),
)

@Serializable
data class Overview(
    val mode: String = "self",
    val window: Window = Window(),
    val cards: Cards? = null,
    val people: List<PersonRow> = emptyList(),
    val today: TodayStrip? = null,
)

@Serializable
data class OverviewAnswer(val overview: Overview = Overview())

@Serializable
data class DayTask(val id: String = "", val number: Int = 0, val title: String = "")

@Serializable
data class PersonDay(val day: String = "", val tasks: List<DayTask> = emptyList(), val steps: Int = 0, val messages: Int = 0, val first: String? = null, val last: String? = null)

@Serializable
data class OpenTask(val id: String = "", val title: String = "", val dueDate: String? = null, val overdue: Boolean = false, val space: String? = null)

@Serializable
data class PersonView(
    val mode: String = "self",
    val window: Window = Window(),
    val person: PersonRow = PersonRow(),
    val days: List<PersonDay> = emptyList(),
    val open: List<OpenTask> = emptyList(),
    val openTotal: Int = 0,
    val spaces: List<NamedRef> = emptyList(),
)

@Serializable
data class PersonAnswer(val view: PersonView = PersonView())

interface PanelApi {
    @GET("api/crm/customers")
    suspend fun customers(@Header("Cache-Control") cache: String = "no-store"): Customers

    @POST("api/crm/customers")
    suspend fun newCustomer(@Body body: CustomerBody): JsonObject

    @PATCH("api/crm/customers/{id}")
    suspend fun editCustomer(@Path("id") id: String, @Body body: CustomerBody): JsonObject

    @DELETE("api/crm/customers/{id}")
    suspend fun deleteCustomer(@Path("id") id: String): JsonObject

    @GET("api/crm/opportunities")
    suspend fun opportunities(@Header("Cache-Control") cache: String = "no-store"): Opportunities

    @POST("api/crm/opportunities")
    suspend fun newOpportunity(@Body body: OpportunityBody): JsonObject

    @PATCH("api/crm/opportunities/{id}")
    suspend fun editOpportunity(@Path("id") id: String, @Body body: OpportunityBody): JsonObject

    @PATCH("api/crm/opportunities/{id}")
    suspend fun stage(@Path("id") id: String, @Body body: StageBody): JsonObject

    @DELETE("api/crm/opportunities/{id}")
    suspend fun deleteOpportunity(@Path("id") id: String): JsonObject

    @GET("api/analytics")
    suspend fun analytics(@Header("Cache-Control") cache: String = "no-store"): Analytics

    @GET("api/control-panel/reports")
    suspend fun panelReports(@Query("space") space: String?, @Header("Cache-Control") cache: String = "no-store"): PanelReports

    @GET("api/control-panel/home")
    suspend fun panelHome(@Header("Cache-Control") cache: String = "no-store"): PanelHome

    @GET("api/owner-board")
    suspend fun board(@Query("range") range: String, @Query("sort") sort: String?, @Query("dir") dir: String?, @Header("Cache-Control") cache: String = "no-store"): OverviewAnswer

    @GET("api/owner-board/people/{id}")
    suspend fun person(@Path("id") id: String, @Query("range") range: String, @Header("Cache-Control") cache: String = "no-store"): PersonAnswer
}
