package io.zakiai.workspace.feature.mfg

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * «أوامر التصنيع», «وصفات», «تقارير» of the manufacturing ledger (M2 N6 batch 8): the shapes of src/lib/manufacturing/production-view.ts and the
 * ledger's own routes. A recipe holds no price; every money field of an order or a report is cut on the SERVER (null or absent) for who does
 * not hold `manufacturing.cost`, so the phone only draws what it is sent.
 */

@Serializable
data class RecipeLine(
    val id: String = "",
    val materialId: String = "",
    val materialName: String = "",
    val baseUnit: String = "",
    val qtyMicro: Long = 0,
    val enteredQtyMicro: Long = 0,
    val enteredUnitLabel: String = "",
    val materialArchived: Boolean = false,
)

@Serializable
data class RecipeVersion(
    val id: String = "",
    val version: Int = 1,
    val name: String = "",
    val outputUnit: String = "",
    val note: String? = null,
    val createdBy: String = "",
    val createdAt: String = "",
    val lines: List<RecipeLine> = emptyList(),
)

@Serializable
data class FinishedLink(val materialId: String = "", val name: String = "")

@Immutable
@Serializable
data class Recipe(
    val id: String = "",
    val archived: Boolean = false,
    val current: RecipeVersion = RecipeVersion(),
    val versions: List<RecipeVersion> = emptyList(),
    val finished: FinishedLink? = null,
    val canStock: Boolean = false,
)

@Serializable
data class RecipeMaterial(val id: String = "", val name: String = "", val baseUnit: String = "", val units: List<MfgUnit> = emptyList())

@Serializable
data class RecipesView(
    val spaceId: String = "",
    val spaceName: String = "",
    val canEdit: Boolean = false,
    val canCost: Boolean = false,
    val recipes: List<Recipe> = emptyList(),
    val materials: List<RecipeMaterial> = emptyList(),
)

@Serializable
data class OrderLine(
    val id: String = "",
    val materialId: String = "",
    val materialName: String = "",
    val baseUnit: String = "",
    val perUnitMicro: Long = 0,
    val requiredMicro: Long = 0,
    val balanceMicro: Long = 0,
    val unpricedMicro: Long = 0,
    val issuedMicro: Long = 0,
    val enough: Boolean = true,
)

@Serializable
data class CostPiece(val lotReceivedOn: String? = null, val qtyMicro: Long = 0, val unitText: String? = null, val amountMinor: Long? = null)

@Serializable
data class CostLine(val materialName: String = "", val baseUnit: String = "", val currency: String? = null, val qtyMicro: Long = 0, val pieces: List<CostPiece> = emptyList())

@Serializable
data class CostTotal(val currency: String = "", val totalMinor: Long = 0, val perUnitText: String? = null)

@Serializable
data class OrderCost(val totals: List<CostTotal> = emptyList(), val lines: List<CostLine> = emptyList(), val frozen: Boolean = false)

@Serializable
data class OrderFinished(val materialId: String = "", val materialName: String = "", val qtyMicro: Long = 0, val costPending: Boolean = false)

@Immutable
@Serializable
data class Order(
    val id: String = "",
    val seq: Int = 0,
    val status: String = "DRAFT",
    val recipeId: String = "",
    val recipeName: String = "",
    val version: Int = 1,
    val outputUnit: String = "",
    val plannedMicro: Long = 0,
    val actualMicro: Long? = null,
    val wasteMicro: Long? = null,
    val wasteNote: String? = null,
    val note: String? = null,
    val createdBy: String = "",
    val createdAt: String = "",
    val closeNote: String? = null,
    val lines: List<OrderLine> = emptyList(),
    val costIncomplete: Boolean = false,
    val cost: OrderCost? = null,
    val canIssue: Boolean = false,
    val canComplete: Boolean = false,
    val canCancel: Boolean = false,
    val canReturn: Boolean = false,
    val canEditDraft: Boolean = false,
    val recipeStocked: Boolean = false,
    val finished: OrderFinished? = null,
)

@Serializable
data class OrderRecipe(val id: String = "", val name: String = "", val outputUnit: String = "", val version: Int = 1, val stocked: Boolean = false)

@Serializable
data class OrdersView(
    val spaceId: String = "",
    val spaceName: String = "",
    val canEdit: Boolean = false,
    val canCost: Boolean = false,
    val orders: List<Order> = emptyList(),
    val recipes: List<OrderRecipe> = emptyList(),
)

@Serializable
data class Period(val from: String = "", val to: String = "")

@Serializable
data class ValuationRow(val materialId: String = "", val name: String = "", val baseUnit: String = "", val qtyMicro: Long = 0, val unpricedMicro: Long = 0, val cost: MaterialCost? = null)

@Serializable
data class ConsumptionCost(val currency: String? = null, val totalMinor: Long = 0, val incomplete: Boolean = false)

@Serializable
data class ConsumptionRow(val materialId: String = "", val name: String = "", val baseUnit: String = "", val qtyMicro: Long = 0, val viaOrdersMicro: Long = 0, val cost: ConsumptionCost? = null)

@Serializable
data class OrderTotals(val totals: List<CostTotal> = emptyList())

@Serializable
data class OrderCostRow(
    val orderId: String = "",
    val seq: Int = 0,
    val status: String = "",
    val recipeName: String = "",
    val outputUnit: String = "",
    val plannedMicro: Long = 0,
    val actualMicro: Long? = null,
    val day: String = "",
    val costIncomplete: Boolean = false,
    val cost: OrderTotals? = null,
)

@Serializable
data class LowRow(val materialId: String = "", val name: String = "", val baseUnit: String = "", val qtyMicro: Long = 0, val lowStockMicro: Long = 0)

@Serializable
data class CurrencyTotal(val currency: String = "", val valueMinor: Long = 0)

@Serializable
data class ReportsView(
    val spaceId: String = "",
    val spaceName: String = "",
    val canCost: Boolean = false,
    val period: Period = Period(),
    val valuation: List<ValuationRow> = emptyList(),
    val valuationTotals: List<CurrencyTotal>? = null,
    val consumption: List<ConsumptionRow> = emptyList(),
    val orders: List<OrderCostRow> = emptyList(),
    val low: List<LowRow> = emptyList(),
)

// ── bodies ──

@Serializable
data class NewOrderBody(val spaceId: String, val recipeId: String, val qty: String, val note: String?)

/** a draft's change: what is null is left as it is (an empty note clears it) */
@Serializable
data class EditOrderBody(val recipeId: String? = null, val qty: String? = null, val note: String? = null)

@Serializable
data class CompleteBody(val actualQty: String, val wasteQty: String?, val wasteNote: String?)

@Serializable
data class RecipeLineBody(val materialId: String, val unitId: String?, val qty: String)

@Serializable
data class RecipeBody(val spaceId: String? = null, val name: String, val outputUnit: String, val note: String?, val lines: List<RecipeLineBody>)

@Serializable
data class ArchivedBody(val archived: Boolean)

interface MfgProductionApi {
    @GET("api/manufacturing/orders")
    suspend fun orders(@Query("spaceId") spaceId: String, @Header("Cache-Control") cache: String = "no-store"): OrdersView

    @POST("api/manufacturing/orders")
    suspend fun newOrder(@Body body: NewOrderBody): JsonObject

    @PATCH("api/manufacturing/orders/{id}")
    suspend fun editOrder(@Path("id") id: String, @Body body: EditOrderBody): JsonObject

    /** ⚠️ moves stock: everything the order needs leaves, oldest lot first, all or none */
    @POST("api/manufacturing/orders/{id}/issue")
    suspend fun issueOrder(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): JsonObject

    @POST("api/manufacturing/orders/{id}/complete")
    suspend fun completeOrder(@Path("id") id: String, @Body body: CompleteBody): JsonObject

    @POST("api/manufacturing/orders/{id}/cancel")
    suspend fun cancelOrder(@Path("id") id: String, @Body body: ReasonBody): JsonObject

    @POST("api/manufacturing/orders/{id}/return")
    suspend fun returnOrder(@Path("id") id: String, @Body body: ReasonBody): JsonObject

    @GET("api/manufacturing/recipes")
    suspend fun recipes(@Query("spaceId") spaceId: String, @Header("Cache-Control") cache: String = "no-store"): RecipesView

    @POST("api/manufacturing/recipes")
    suspend fun newRecipe(@Body body: RecipeBody): JsonObject

    @POST("api/manufacturing/recipes/{id}/versions")
    suspend fun newVersion(@Path("id") id: String, @Body body: RecipeBody): JsonObject

    @PATCH("api/manufacturing/recipes/{id}")
    suspend fun archiveRecipe(@Path("id") id: String, @Body body: ArchivedBody): JsonObject

    @POST("api/manufacturing/recipes/{id}/finished-stock")
    suspend fun finishedStock(@Path("id") id: String, @Body body: JsonObject = JsonObject(emptyMap())): JsonObject

    @GET("api/manufacturing/reports")
    suspend fun reports(@Query("spaceId") spaceId: String, @Query("from") from: String?, @Query("to") to: String?, @Header("Cache-Control") cache: String = "no-store"): ReportsView
}
