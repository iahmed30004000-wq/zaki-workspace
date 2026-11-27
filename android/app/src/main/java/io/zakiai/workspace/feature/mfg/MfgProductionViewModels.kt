package io.zakiai.workspace.feature.mfg

import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One part of the ledger read for ONE space; a change of space forgets what the other space showed. */
abstract class MfgPartBase<V>(retrofit: retrofit2.Retrofit, session: Session) : MfgBase(retrofit, session) {
    protected val prod: MfgProductionApi = retrofit.create(MfgProductionApi::class.java)
    private val _data = MutableStateFlow<V?>(null)
    val data: StateFlow<V?> = _data.asStateFlow()
    protected var space: String? = null
    private var job: Job? = null

    protected abstract suspend fun load(spaceId: String): V

    fun refresh(spaceId: String) {
        if (spaceId != space) _data.value = null
        space = spaceId
        job?.cancel()
        job = viewModelScope.launch { read { load(spaceId) }?.let { _data.value = it } }
    }

    protected fun again() { space?.let(::refresh) }
}

/** «أوامر التصنيع»: a draft made, edited, issued (⚠️ stock leaves at once), completed, cancelled or returned — each the ledger's own route. */
@HiltViewModel
class MfgOrdersViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : MfgPartBase<OrdersView>(retrofit, session) {
    override suspend fun load(spaceId: String) = prod.orders(spaceId)

    fun create(recipeId: String, qty: String, note: String, done: () -> Unit) {
        val s = space ?: return
        act({ prod.newOrder(NewOrderBody(s, recipeId, qty.trim(), note.trim().ifBlank { null })) }, w("mfg.order_created")) { done(); again() }
    }

    fun edit(o: Order, body: EditOrderBody, done: () -> Unit) = act({ prod.editOrder(o.id, body) }, w("mfg.order_edited")) { done(); again() }
    fun issue(o: Order) = act({ prod.issueOrder(o.id) }, w("mfg.order_issued_done")) { again() }
    fun complete(o: Order, actual: String, waste: String, wasteNote: String, done: () -> Unit) =
        act({ prod.completeOrder(o.id, CompleteBody(actual.trim(), waste.trim().ifBlank { null }, wasteNote.trim().ifBlank { null })) }, w("mfg.order_completed_done")) { done(); again() }
    fun cancel(o: Order, reason: String, done: () -> Unit) = act({ prod.cancelOrder(o.id, ReasonBody(reason.trim())) }, w("mfg.order_cancelled_done")) { done(); again() }
    fun giveBack(o: Order, reason: String, done: () -> Unit) = act({ prod.returnOrder(o.id, ReasonBody(reason.trim())) }, w("mfg.order_returned_done")) { done(); again() }
}

/** «وصفات»: a recipe made, a NEW version (the old ones are never edited), archived or restored, its finished item kept in stock. */
@HiltViewModel
class MfgRecipesViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : MfgPartBase<RecipesView>(retrofit, session) {
    override suspend fun load(spaceId: String) = prod.recipes(spaceId)

    fun save(recipe: Recipe?, name: String, outputUnit: String, note: String, lines: List<RecipeLineBody>, done: () -> Unit) {
        val s = space ?: return
        val body = RecipeBody(if (recipe == null) s else null, name.trim(), outputUnit.trim(), note.trim().ifBlank { null }, lines)
        act({ if (recipe == null) prod.newRecipe(body) else prod.newVersion(recipe.id, body) }, w(if (recipe == null) "mfg.recipe_saved" else "mfg.recipe_versioned")) { done(); again() }
    }

    fun archive(r: Recipe) = act({ prod.archiveRecipe(r.id, ArchivedBody(!r.archived)) }, w("mfg.saved")) { again() }
    fun stock(r: Recipe) = act({ prod.finishedStock(r.id) }, w("mfg.finished_done")) { again() }
}

/** «تقارير»: read only, for the period asked (the server's default is the last 30 days). */
@HiltViewModel
class MfgReportsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : MfgPartBase<ReportsView>(retrofit, session) {
    private var from: String? = null
    private var to: String? = null

    override suspend fun load(spaceId: String) = prod.reports(spaceId, from, to)

    fun period(from: String, to: String) {
        this.from = from.trim().ifBlank { null }
        this.to = to.trim().ifBlank { null }
        again()
    }
}
