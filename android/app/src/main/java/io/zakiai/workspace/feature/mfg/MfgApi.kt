package io.zakiai.workspace.feature.mfg

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * «مخزون التصنيع» (M2 N6 batch 8) — the ledger's own routes (src/app/api/manufacturing/...), shapes of src/lib/manufacturing/view.ts and
 * production-view.ts. Every money field is cut on the SERVER for who does not hold `manufacturing.cost` (null or absent): the phone only
 * draws what it is sent. Quantities are integer micro-units (1 unit = 1,000,000), money integer minor units plus a currency code.
 */

@Serializable
data class Formula(val value: String = "", val qty: String = "", val average: String = "")

@Serializable
data class MaterialCost(val currency: String? = null, val valueMinor: Long = 0, val averageText: String? = null, val formula: Formula? = null)

@Immutable
@Serializable
data class MaterialRow(
    val id: String = "",
    val name: String = "",
    val code: String? = null,
    val baseUnit: String = "",
    val balanceMicro: Long = 0,
    val lowStockMicro: Long? = null,
    val low: Boolean = false,
    val archived: Boolean = false,
    val pendingCount: Boolean = false,
    val unpricedMicro: Long = 0,
    val cost: MaterialCost? = null,
)

@Serializable
data class MfgUnit(val id: String = "", val label: String = "", val num: Long = 1, val den: Long = 1, val archived: Boolean = false)

@Immutable
@Serializable
data class Supplier(val id: String = "", val name: String = "", val note: String? = null, val archived: Boolean = false)

@Immutable
@Serializable
data class CountItem(
    val id: String = "",
    val materialId: String = "",
    val materialName: String = "",
    val baseUnit: String = "",
    val countedMicro: Long = 0,
    val expectedMicro: Long = 0,
    val diffMicro: Long = 0,
    val note: String? = null,
    val status: String = "PENDING",
    val countedBy: String = "",
    val decidedBy: String? = null,
    val decisionNote: String? = null,
    val createdAt: String = "",
    val canDecide: Boolean = false,
)

@Serializable
data class Overview(
    val spaceId: String = "",
    val spaceName: String = "",
    val canEdit: Boolean = false,
    val canCost: Boolean = false,
    val materials: List<MaterialRow> = emptyList(),
    val suppliers: List<Supplier> = emptyList(),
    val pending: List<CountItem> = emptyList(),
)

@Serializable
data class Proof(val id: String = "", val name: String = "", val mimeType: String = "", val url: String = "")

@Serializable
data class LotCost(val currency: String = "", val unitCostMinor: Long = 0, val totalCostMinor: Long = 0)

@Serializable
data class PriceStep(val seq: Int = 0, val unitCostMinor: Long = 0, val totalCostMinor: Long = 0, val currency: String = "", val by: String = "", val at: String = "", val reason: String? = null, val current: Boolean = false)

@Serializable
data class Costed(val by: String = "", val at: String = "")

@Immutable
@Serializable
data class Lot(
    val id: String = "",
    val receivedOn: String = "",
    val expiresOn: String? = null,
    val qtyMicro: Long = 0,
    val enteredQtyMicro: Long = 0,
    val enteredUnitLabel: String = "",
    val supplier: Supplier? = null,
    val note: String? = null,
    val proof: Proof? = null,
    val proofNote: String? = null,
    val createdBy: String = "",
    val createdAt: String = "",
    val cost: LotCost? = null,
    val reversed: Boolean = false,
    val costPending: Boolean = false,
    val costedLater: Costed? = null,
    val canFillCost: Boolean = false,
    val correctionCount: Int = 0,
    val priceHistory: List<PriceStep> = emptyList(),
    val canCorrectPrice: Boolean = false,
)

@Immutable
@Serializable
data class Movement(
    val id: String = "",
    val kind: String = "",
    val qtyMicro: Long = 0,
    val reason: String? = null,
    val reversesId: String? = null,
    val reversedById: String? = null,
    val createdBy: String = "",
    val createdAt: String = "",
    val valueMinor: Long? = null,
    val canReverse: Boolean = false,
)

@Serializable
data class MaterialDetail(
    val id: String = "",
    val spaceId: String = "",
    val spaceName: String = "",
    val name: String = "",
    val code: String? = null,
    val baseUnit: String = "",
    val lowStockMicro: Long? = null,
    val low: Boolean = false,
    val archived: Boolean = false,
    val balanceMicro: Long = 0,
    val unpricedMicro: Long = 0,
    val units: List<MfgUnit> = emptyList(),
    val suppliers: List<Supplier> = emptyList(),
    val canEdit: Boolean = false,
    val canCost: Boolean = false,
    val cost: MaterialCost? = null,
    val lots: List<Lot> = emptyList(),
    val movements: List<Movement> = emptyList(),
    val counts: List<CountItem> = emptyList(),
)

@Serializable
data class MaterialAnswer(val material: MaterialDetail = MaterialDetail())

// ── bodies ──

@Serializable
data class NewMaterialBody(val spaceId: String, val name: String, val code: String?, val baseUnit: String, val lowStock: String?)

@Serializable
data class EditMaterialBody(val name: String? = null, val code: String? = null, val lowStock: String? = null, val archived: Boolean? = null)

@Serializable
data class NewSupplierBody(val spaceId: String, val name: String, val note: String?)

@Serializable
data class SupplierArchive(val archived: Boolean)

@Serializable
data class ReceiveBody(
    val unitId: String?,
    val qty: String,
    val unitCost: String? = null,
    val currency: String? = null,
    val unpriced: Boolean? = null,
    val supplierId: String?,
    val receivedOn: String,
    val expiresOn: String?,
    val note: String?,
    val proofFileId: String?,
    val proofNote: String?,
)

@Serializable
data class MoveBody(val unitId: String?, val qty: String, val reason: String)

@Serializable
data class CountBody(val unitId: String?, val qty: String, val note: String?)

@Serializable
data class DecideBody(val decision: String, val note: String?)

@Serializable
data class ReasonBody(val reason: String)

@Serializable
data class LotCostBody(val unitCost: String, val currency: String, val note: String? = null)

@Serializable
data class CorrectBody(val unitCost: String, val currency: String, val reason: String)

@Serializable
data class UnitBody(val label: String, val num: Long, val den: Long)

@Serializable
data class Uploaded(val id: String = "")

interface MfgApi {
    @GET("api/manufacturing/overview")
    suspend fun overview(@Query("spaceId") spaceId: String, @Header("Cache-Control") cache: String = "no-store"): Overview

    @POST("api/manufacturing/materials")
    suspend fun newMaterial(@Body body: NewMaterialBody): JsonObject

    @GET("api/manufacturing/materials/{id}")
    suspend fun material(@Path("id") id: String, @Header("Cache-Control") cache: String = "no-store"): MaterialAnswer

    @PATCH("api/manufacturing/materials/{id}")
    suspend fun editMaterial(@Path("id") id: String, @Body body: EditMaterialBody): JsonObject

    @POST("api/manufacturing/materials/{id}/receive")
    suspend fun receive(@Path("id") id: String, @Body body: ReceiveBody): JsonObject

    @POST("api/manufacturing/materials/{id}/issue")
    suspend fun issue(@Path("id") id: String, @Body body: MoveBody): JsonObject

    @POST("api/manufacturing/materials/{id}/adjust")
    suspend fun adjust(@Path("id") id: String, @Body body: MoveBody): JsonObject

    @POST("api/manufacturing/materials/{id}/count")
    suspend fun count(@Path("id") id: String, @Body body: CountBody): JsonObject

    @POST("api/manufacturing/materials/{id}/units")
    suspend fun addUnit(@Path("id") id: String, @Body body: UnitBody): JsonObject

    @DELETE("api/manufacturing/materials/{id}/units/{unit}")
    suspend fun archiveUnit(@Path("id") id: String, @Path("unit") unit: String): JsonObject

    @POST("api/manufacturing/counts/{id}/decide")
    suspend fun decide(@Path("id") id: String, @Body body: DecideBody): JsonObject

    @POST("api/manufacturing/movements/{id}/reverse")
    suspend fun reverse(@Path("id") id: String, @Body body: ReasonBody): JsonObject

    @POST("api/manufacturing/lots/{id}/cost")
    suspend fun fillCost(@Path("id") id: String, @Body body: LotCostBody): JsonObject

    @POST("api/manufacturing/lots/{id}/correct")
    suspend fun correct(@Path("id") id: String, @Body body: CorrectBody): JsonObject

    @POST("api/manufacturing/suppliers")
    suspend fun newSupplier(@Body body: NewSupplierBody): JsonObject

    @PATCH("api/manufacturing/suppliers/{id}")
    suspend fun archiveSupplier(@Path("id") id: String, @Body body: SupplierArchive): JsonObject

    /** the receipt's photo goes up as the chat's own upload (the ledger checks it is the uploader's, an image or a PDF, unused) */
    @Multipart
    @POST("api/chat/uploads")
    suspend fun upload(@Part("kind") kind: RequestBody, @Part file: MultipartBody.Part): Uploaded
}
