package io.zakiai.workspace.feature.panel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desks.DeskFacts
import io.zakiai.workspace.feature.desks.DesksApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The shared bones: the facts (who may), the site's sentence on a refusal, one action at a time. */
abstract class PanelBase(retrofit: retrofit2.Retrofit, protected val session: Session) : ViewModel() {
    protected val api: PanelApi = retrofit.create(PanelApi::class.java)
    private val desks: DesksApi = retrofit.create(DesksApi::class.java)
    private val _facts = MutableStateFlow<DeskFacts?>(null)
    val facts: StateFlow<DeskFacts?> = _facts.asStateFlow()
    private val _failure = MutableStateFlow<String?>(null)
    val failure: StateFlow<String?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun say(text: String) { _notice.value = text }
    fun consumeNotice() { _notice.value = null }

    protected suspend fun loadFacts(): DeskFacts? = _facts.value ?: when (val r = apiCall { desks.facts() }) {
        is ApiResult.Ok -> r.value.also { _facts.value = it }
        is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure.message; null }
    }

    protected suspend fun <T> read(call: suspend () -> T): T? = when (val r = apiCall { call() }) {
        is ApiResult.Ok -> { _failure.value = null; r.value }
        is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure.message; null }
    }

    protected fun act(call: suspend () -> Any, sentence: String? = null, then: () -> Unit = {}) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { call() }) {
                is ApiResult.Ok -> { sentence?.let(::say); then() }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); say(r.failure.message) }
            }
        } finally {
            _busy.value = false
        }
    }
}

/** «العملاء»: the customers and the opportunities of the space (the server scopes them); amounts only for who holds `prices.view`. */
@HiltViewModel
class CrmViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : PanelBase(retrofit, session) {
    private val _customers = MutableStateFlow<List<Customer>?>(null)
    val customers: StateFlow<List<Customer>?> = _customers.asStateFlow()
    private val _opps = MutableStateFlow<List<Opportunity>?>(null)
    val opps: StateFlow<List<Opportunity>?> = _opps.asStateFlow()

    fun refresh() = viewModelScope.launch {
        val f = loadFacts() ?: return@launch
        if (f.external || !f.crm.view) return@launch
        read { api.customers() }?.let { _customers.value = it.customers }
        read { api.opportunities() }?.let { _opps.value = it.opportunities }
    }

    fun saveCustomer(id: String?, c: CustomerBody, done: () -> Unit) {
        if (c.name.trim().length < 2) { say(B.nameShort); return }
        val body = c.copy(name = c.name.trim(), company = c.company?.trim()?.ifBlank { null }, email = c.email?.trim()?.ifBlank { null }, phone = c.phone?.trim()?.ifBlank { null }, notes = c.notes?.trim()?.ifBlank { null })
        act({ if (id == null) api.newCustomer(body) else api.editCustomer(id, body) }, B.saved) { done(); refresh() }
    }

    fun saveOpportunity(id: String?, o: OpportunityBody, done: () -> Unit) {
        if (o.title.trim().length < 3) { say(B.titleShort); return }
        val prices = facts.value?.prices == true
        // the amount travels only for who may see it; an edit never moves the opportunity to another customer
        val body = o.copy(title = o.title.trim(), notes = o.notes?.trim()?.ifBlank { null }, value = if (prices) o.value ?: 0.0 else null, customerId = if (id == null) o.customerId else null)
        act({ if (id == null) api.newOpportunity(body) else api.editOpportunity(id, body) }, B.saved) { done(); refresh() }
    }

    fun stage(o: Opportunity, s: String) = act({ api.stage(o.id, StageBody(s)) }) { refresh() }
    fun deleteCustomer(id: String) = act({ api.deleteCustomer(id) }, B.deleted) { refresh() }
    fun deleteOpportunity(id: String) = act({ api.deleteOpportunity(id) }, B.deleted) { refresh() }
}

/** «التقارير»: the owner's panel reports (the whole company or one space) when the panel is his, the person's report otherwise. */
@HiltViewModel
class ReportsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : PanelBase(retrofit, session) {
    private val _panel = MutableStateFlow<PanelReports?>(null)
    val panel: StateFlow<PanelReports?> = _panel.asStateFlow()
    private val _plain = MutableStateFlow<Analytics?>(null)
    val plain: StateFlow<Analytics?> = _plain.asStateFlow()
    private var job: Job? = null

    fun refresh(space: String?) {
        job?.cancel()
        job = viewModelScope.launch {
            val f = loadFacts() ?: return@launch
            if (f.panel) read { api.panelReports(space) }?.let { _panel.value = it }
            else if (f.reports) read { api.analytics() }?.let { _plain.value = it }
        }
    }
}

/** «لوحة المالك / لوحة التحكم»: the panel's home (the owner), the people of the board over a range, one person's page. */
@HiltViewModel
class BoardViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session) : PanelBase(retrofit, session) {
    private val _home = MutableStateFlow<PanelHome?>(null)
    val home: StateFlow<PanelHome?> = _home.asStateFlow()
    private val _overview = MutableStateFlow<Overview?>(null)
    val overview: StateFlow<Overview?> = _overview.asStateFlow()
    private var job: Job? = null

    fun refresh(range: String, sort: String) {
        job?.cancel()
        job = viewModelScope.launch {
            val f = loadFacts() ?: return@launch
            if (f.panel) read { api.panelHome() }?.let { _home.value = it }
            if (f.board == "owner" || f.board == "team") {
                read { api.board(range, sort, if (sort == "name") "asc" else "desc") }?.let { _overview.value = it.overview }
            }
        }
    }
}

@HiltViewModel
class BoardPersonViewModel @Inject constructor(retrofit: retrofit2.Retrofit, session: Session, saved: SavedStateHandle) : PanelBase(retrofit, session) {
    val id: String = saved.get<String>("id").orEmpty()
    private val _view = MutableStateFlow<PersonView?>(null)
    val view: StateFlow<PersonView?> = _view.asStateFlow()
    private var job: Job? = null

    fun refresh(range: String) {
        job?.cancel()
        job = viewModelScope.launch { read { api.person(id, range) }?.let { _view.value = it.view } }
    }
}
