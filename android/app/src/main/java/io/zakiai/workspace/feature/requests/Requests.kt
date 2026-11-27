package io.zakiai.workspace.feature.requests

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.AcceptBody2
import io.zakiai.workspace.core.net.DecideBody
import io.zakiai.workspace.core.net.RequestRow
import io.zakiai.workspace.core.net.RequestSection
import io.zakiai.workspace.core.net.RequestsAnswer
import io.zakiai.workspace.core.net.ReturnBody
import io.zakiai.workspace.core.net.StatusBody
import io.zakiai.workspace.core.net.TicketPatch
import io.zakiai.workspace.core.net.WorkspaceApi
import io.zakiai.workspace.feature.desk.D
import io.zakiai.workspace.feature.desk.DeskViewModel
import io.zakiai.workspace.feature.office.O
import io.zakiai.workspace.feature.projects.P
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.work.Screen
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * «الطلبات» (GET /api/work/requests): the person's own inbox. Each row acts through the door that already exists for it — an approval
 * `/decide`, an assignment `/request/accept|return`, a ticket PATCH, a card's and a product sheet's `/status` — and the list is read
 * again after (the row leaves it). Approvals stay in the app: nothing here goes through Telegram.
 */
@HiltViewModel
class RequestsViewModel @Inject constructor(private val api: WorkspaceApi, session: Session) : DeskViewModel<RequestsAnswer>(session) {
    private var job: Job? = null
    private var shown: String? = null

    /** A newer read cancels the older one; the other tab starts empty. */
    fun refresh(tab: String) {
        job?.cancel()
        if (shown != tab) { shown = tab; _state.value = Screen() }
        job = viewModelScope.launch { load { api.requests(tab) } }
    }

    private fun after(tab: String): () -> Unit = { say(R.done); refresh(tab) }

    fun decide(row: RequestRow, decision: String, reason: String?, tab: String) = viewModelScope.launch {
        D.reasonProblem(decision, reason.orEmpty())?.let { say(it); return@launch }
        act({ api.decideApproval(row.id, DecideBody(decision, reason?.trim()?.ifBlank { null })) }, after(tab))
    }

    fun accept(row: RequestRow, tab: String) = viewModelScope.launch {
        val task = row.taskId ?: return@launch
        act({ api.acceptRequest(task, AcceptBody2(row.requestId)) }, after(tab))
    }

    fun giveBack(row: RequestRow, reason: String, tab: String) = viewModelScope.launch {
        val task = row.taskId ?: return@launch
        if (reason.isBlank()) { say(R.reasonRequired); return@launch }
        act({ api.returnRequest(task, ReturnBody(reason.trim(), row.requestId)) }, after(tab))
    }

    /** «استلمها»: in progress and assigned to the person (the site's own update); «حُلّت»: resolved. */
    fun ticket(row: RequestRow, take: Boolean, viewerId: String, tab: String) = viewModelScope.launch {
        act({ api.patchTicket(row.id, if (take) TicketPatch(status = "IN_PROGRESS", assigneeId = viewerId) else TicketPatch(status = "RESOLVED")) }, after(tab))
    }

    fun card(row: RequestRow, approve: Boolean, tab: String) = viewModelScope.launch {
        act({ api.cardStatus(row.id, StatusBody(if (approve) "APPROVED" else "DRAFT")) }, after(tab))
    }

    /** an approval is of the version the approver SAW: the server refuses it if the sheet moved on */
    fun sheet(row: RequestRow, approve: Boolean, tab: String) = viewModelScope.launch {
        act({ api.sheetStatus(row.id, if (approve) StatusBody("APPROVED", row.version) else StatusBody("DRAFT")) }, after(tab))
    }
}

/**
 * The screen (src/components/work/requests/requests-view.tsx): «بانتظاري» / «طلباتي», the sections in the server's order with their count,
 * each row with its own buttons; inside «الشركة» one group per space. A row's title opens its page (natively where the app has it).
 * The switch `workRequests` off: the site shows its approvals page instead, and so does the phone.
 */
@Composable
fun RequestsScreen(spaceKey: String?, onOpenPath: (String) -> Unit, approvalsFallback: @Composable () -> Unit, vm: RequestsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("waiting") }
    WhileOnScreen(60_000, spaceKey, tab) { vm.refresh(tab) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    // the switch is off (404): the site's approvals page, as the site does
    if (state.data == null && state.failure?.status == 404) { approvalsFallback(); return }
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            PillStrip {
                PillTab(R.waiting, if (tab == "waiting") data?.total ?: 0 else 0, tab == "waiting") { tab = "waiting" }
                PillTab(R.mine, 0, tab == "mine") { tab = "mine" }
            }
            when {
                data == null && state.failure == null -> Loading()
                data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(tab) })
                data.sections.all { it.rows.isEmpty() } ->
                    if (tab == "mine") QuietEmpty(R.emptyMine, R.emptyMineHint) else QuietEmpty(R.emptyWaiting, R.emptyWaitingHint)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                    val groups = data.groups
                    if (!groups.isNullOrEmpty()) {
                        groups.forEach { g ->
                            item(key = "g-" + (g.spaceId ?: "company")) {
                                Text(g.name ?: R.company, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                            }
                            sections(g.sections, prefix = g.spaceId ?: "company", tab, data.viewerId, busy, vm, onOpenPath)
                        }
                    } else sections(data.sections, prefix = "", tab, data.viewerId, busy, vm, onOpenPath)
                }
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.sections(
    sections: List<RequestSection>,
    prefix: String,
    tab: String,
    viewerId: String,
    busy: Boolean,
    vm: RequestsViewModel,
    onOpenPath: (String) -> Unit,
) {
    sections.filter { it.rows.isNotEmpty() }.forEach { s ->
        item(key = "$prefix-s-${s.key}") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(R.section(s.key, tab == "mine"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                Text(R.count(s.total), fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
        }
        items(s.rows, key = { "$prefix-${s.key}-${it.id}" }) { row -> RowView(row, tab, viewerId, busy, vm, onOpenPath) }
        if (s.total > s.rows.size) item(key = "$prefix-more-${s.key}") {
            Text(
                R.more(s.total - s.rows.size),
                fontSize = 12.5.sp,
                color = Zk.colors.accent,
                modifier = Modifier.fillMaxWidth().clickable(enabled = s.allHref != null) { s.allHref?.let(onOpenPath) }.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun Action(label: String, tone: Color, filled: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (filled) Zk.colors.accentFg else tone,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (filled) tone.copy(alpha = if (enabled) 1f else 0.5f) else tone.copy(alpha = 0.12f))
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 7.dp),
    )
}

@Composable
private fun RowView(row: RequestRow, tab: String, viewerId: String, busy: Boolean, vm: RequestsViewModel, onOpenPath: (String) -> Unit) {
    // a refusal, a change and a return need a reason, typed in place (the site's ReasonForm)
    var asking by remember(row.id) { mutableStateOf<String?>(null) }
    var reason by remember(row.id) { mutableStateOf("") }
    val meta = when (row.kind) {
        "approval" -> listOfNotNull(row.byName?.let(R::by), row.place, row.amount, row.waitingOn?.let(R::waitingOn), if (row.status == "CHANGES_REQUESTED") R.sentBack else null, P.dmy(row.at))
        "assign" -> listOfNotNull(row.key, row.place, P.dmy(row.at))
        "ticket" -> listOfNotNull(row.key, row.place, row.priority?.let(O::priority), row.status?.let(O::status), row.assignee?.let(R::takenBy) ?: R.nobody, P.dmy(row.at))
        "sheet" -> listOfNotNull(row.byName?.let(R::by), R.version(row.version), P.dmy(row.at))
        else -> listOfNotNull(row.byName?.let(R::by), row.place, P.dmy(row.at))
    }
    Column(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
            Text(row.title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable(enabled = row.href.isNotBlank()) { onOpenPath(row.href) })
            Text(meta.joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 2.dp))
            if (row.kind == "assign") Text(
                if (row.canAnswer) R.assignBanner(row.fromName.orEmpty()) else R.assignWaiting(row.toName.orEmpty()),
                fontSize = 13.sp,
                color = Zk.colors.fg,
                modifier = Modifier.padding(top = 4.dp),
            )
            val actions: List<Triple<String, Color, () -> Unit>> = when {
                row.kind == "approval" && row.canDecide -> listOf(
                    Triple(R.approve, Zk.colors.accent) { vm.decide(row, "APPROVE", null, tab) },
                    Triple(R.changes, Zk.colors.info) { asking = "CHANGES" },
                    Triple(R.reject, Zk.colors.danger) { asking = "REJECT" },
                )
                row.kind == "assign" && row.canAnswer -> listOf(
                    Triple(R.accept, Zk.colors.accent) { vm.accept(row, tab) },
                    Triple(R.giveBack, Zk.colors.danger) { asking = "RETURN" },
                )
                row.kind == "ticket" -> listOfNotNull(
                    if (row.canTake) Triple(R.take, Zk.colors.accent) { vm.ticket(row, true, viewerId, tab) } else null,
                    if (row.canResolve) Triple(R.resolve, Zk.colors.ok) { vm.ticket(row, false, viewerId, tab) } else null,
                )
                row.kind == "card" && row.canDecide -> listOf(
                    Triple(R.cardApprove, Zk.colors.accent) { vm.card(row, true, tab) },
                    Triple(R.cardBack, Zk.colors.fgMuted) { vm.card(row, false, tab) },
                )
                row.kind == "sheet" && row.canDecide -> listOf(
                    Triple(R.sheetApprove, Zk.colors.accent) { vm.sheet(row, true, tab) },
                    Triple(R.sheetBack, Zk.colors.fgMuted) { vm.sheet(row, false, tab) },
                )
                else -> emptyList()
            }
            if (asking != null) {
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(reason, { reason = it.take(1000) }, placeholder = { Text(R.reasonLabel) }, maxLines = 3, modifier = Modifier.weight(1f))
                    Action(R.send, Zk.colors.danger, filled = true, enabled = !busy && reason.isNotBlank()) {
                        when (asking) {
                            "RETURN" -> vm.giveBack(row, reason, tab)
                            else -> vm.decide(row, asking!!, reason, tab)
                        }
                    }
                    Action(R.cancel, Zk.colors.fgMuted, filled = false, enabled = true) { asking = null; reason = "" }
                }
            } else if (actions.isNotEmpty()) {
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    actions.forEachIndexed { i, (label, tone, go) -> Action(label, tone, filled = i == 0, enabled = !busy, onClick = go) }
                }
            }
        }
        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
    }
}
