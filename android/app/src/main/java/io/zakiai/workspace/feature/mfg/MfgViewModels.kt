package io.zakiai.workspace.feature.mfg

import android.content.Context
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject

/** One action at a time, the ledger's own precise refusal (`details[0]`), a signed-out answer ends the session. */
abstract class MfgBase(retrofit: retrofit2.Retrofit, protected val session: Session) : ViewModel() {
    protected val api: MfgApi = retrofit.create(MfgApi::class.java)
    protected val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun say(text: String) { _notice.value = text }
    fun consumeNotice() { _notice.value = null }

    protected suspend fun <T> read(call: suspend () -> T): T? = when (val r = apiCall { call() }) {
        is ApiResult.Ok -> { _failure.value = null; r.value }
        is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure; null }
    }

    /** `then` runs only when the server took it; a refusal says the ledger's own sentence and keeps what was typed */
    protected fun act(call: suspend () -> Any, sentence: String?, then: () -> Unit) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let(::say); then() }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); say(Q8.refusal(r.failure.detail, MfgWords.all[r.failure.key ?: ""] ?: r.failure.message)) }
            }
        } finally {
            _busy.value = false
        }
    }
}

/** «المواد» of the manufacturing space: the materials, the stocktakes waiting for a second person, the suppliers. */
@HiltViewModel
class MfgHomeViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : MfgBase(retrofit, session) {
    private val _data = MutableStateFlow<Overview?>(null)
    val data: StateFlow<Overview?> = _data.asStateFlow()
    private var space: String? = null
    private var job: Job? = null

    fun refresh(spaceId: String) {
        if (spaceId != space) _data.value = null
        space = spaceId
        job?.cancel()
        job = viewModelScope.launch { read { api.overview(spaceId) }?.let { _data.value = it } }
    }

    private fun again() { space?.let(::refresh) }

    fun newMaterial(name: String, code: String, unit: String, low: String, done: () -> Unit) {
        val s = space ?: return
        act({ api.newMaterial(NewMaterialBody(s, name.trim(), code.trim().ifBlank { null }, unit.trim(), low.trim().ifBlank { null })) }, w("mfg.material_created")) { done(); again() }
    }

    fun decide(c: CountItem, approve: Boolean, note: String) =
        act({ api.decide(c.id, DecideBody(if (approve) "approve" else "reject", note.trim().ifBlank { null })) }, w(if (approve) "mfg.count_approved" else "mfg.count_rejected")) { again() }

    fun newSupplier(name: String, note: String, done: () -> Unit) {
        val s = space ?: return
        act({ api.newSupplier(NewSupplierBody(s, name.trim(), note.trim().ifBlank { null })) }, w("mfg.saved")) { done(); again() }
    }

    fun archiveSupplier(sp: Supplier) = act({ api.archiveSupplier(sp.id, SupplierArchive(!sp.archived)) }, w("mfg.saved")) { again() }
}

/** One material: its balance, its units, its lots and their prices, its movements; every write is the ledger's own route. */
@HiltViewModel
class MaterialViewModel @Inject constructor(
    retrofit: retrofit2.Retrofit,
    session: Session,
    saved: SavedStateHandle,
    @ApplicationContext private val context: Context,
) : MfgBase(retrofit, session) {
    val id: String = saved.get<String>("id").orEmpty()
    private val _data = MutableStateFlow<MaterialDetail?>(null)
    val data: StateFlow<MaterialDetail?> = _data.asStateFlow()
    private val _proof = MutableStateFlow<String?>(null)
    /** the uploaded receipt's file id, once on the server */
    val proof: StateFlow<String?> = _proof.asStateFlow()
    private val _uploading = MutableStateFlow(false)
    val uploading: StateFlow<Boolean> = _uploading.asStateFlow()

    fun refresh() = viewModelScope.launch { read { api.material(id) }?.let { _data.value = it.material } }

    fun receive(body: ReceiveBody, unpriced: Boolean, done: () -> Unit) =
        act({ api.receive(id, body) }, w(if (unpriced) "mfg.received_unpriced" else "mfg.received")) { _proof.value = null; done(); refresh() }

    fun issue(unitId: String?, qty: String, reason: String, done: () -> Unit) = act({ api.issue(id, MoveBody(unitId, qty.trim(), reason.trim())) }, w("mfg.issued")) { done(); refresh() }
    fun adjust(unitId: String?, qty: String, reason: String, done: () -> Unit) = act({ api.adjust(id, MoveBody(unitId, qty.trim(), reason.trim())) }, w("mfg.adjusted")) { done(); refresh() }
    fun count(unitId: String?, qty: String, note: String, done: () -> Unit) = act({ api.count(id, CountBody(unitId, qty.trim(), note.trim().ifBlank { null })) }, w("mfg.count_sent")) { done(); refresh() }
    fun decide(c: CountItem, approve: Boolean, note: String) =
        act({ api.decide(c.id, DecideBody(if (approve) "approve" else "reject", note.trim().ifBlank { null })) }, w(if (approve) "mfg.count_approved" else "mfg.count_rejected")) { refresh() }
    fun reverse(m: Movement, reason: String, done: () -> Unit) = act({ api.reverse(m.id, ReasonBody(reason.trim())) }, w("mfg.reversed_done")) { done(); refresh() }
    fun fillCost(lot: Lot, unitCost: String, currency: String, done: () -> Unit) = act({ api.fillCost(lot.id, LotCostBody(unitCost.trim(), currency)) }, w("mfg.costed")) { done(); refresh() }
    fun correct(lot: Lot, unitCost: String, currency: String, reason: String, done: () -> Unit) =
        act({ api.correct(lot.id, CorrectBody(unitCost.trim(), currency, reason.trim())) }, w("mfg.price_corrected")) { done(); refresh() }
    fun edit(name: String, code: String, low: String, done: () -> Unit) =
        act({ api.editMaterial(id, EditMaterialBody(name.trim(), code.trim().ifBlank { null }, low.trim().ifBlank { null })) }, w("mfg.saved")) { done(); refresh() }
    fun archive(archived: Boolean) = act({ api.editMaterial(id, EditMaterialBody(archived = archived)) }, w("mfg.saved")) { refresh() }
    fun addUnit(label: String, num: Long, den: Long, done: () -> Unit) = act({ api.addUnit(id, UnitBody(label.trim(), num, den)) }, w("mfg.saved")) { done(); refresh() }
    fun archiveUnit(unitId: String) = act({ api.archiveUnit(id, unitId) }, w("mfg.saved")) { refresh() }

    /** the receipt's photo: made small on the phone, sent as the chat's own upload (its bytes sniffed again by the server) */
    fun uploadProof(uri: Uri) = viewModelScope.launch {
        _uploading.value = true
        try {
            val bytes = withContext(Dispatchers.IO) { shrink(uri) } ?: return@launch
            val part = MultipartBody.Part.createFormData("file", "receipt.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
            when (val r = apiCall { api.upload("IMAGE".toRequestBody("text/plain".toMediaType()), part) }) {
                is ApiResult.Ok -> _proof.value = r.value.id
                is ApiResult.Err -> say(r.failure.message)
            }
        } finally {
            _uploading.value = false
        }
    }

    fun clearProof() { _proof.value = null }

    private fun shrink(uri: Uri): ByteArray? = runCatching {
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
        val bmp = context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        java.io.ByteArrayOutputStream().use { out -> bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out); out.toByteArray() }
    }.getOrNull()
}
