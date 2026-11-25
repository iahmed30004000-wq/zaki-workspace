package io.zakiai.workspace.feature.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.ApprovalItem
import io.zakiai.workspace.core.net.Idea
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.projects.StateChip
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk

@Composable
private fun Notices(notice: String?, consume: () -> Unit, snack: SnackbarHostState) {
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); consume() } }
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        color = if (on) Zk.colors.accentFg else Zk.colors.fgMuted,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** A part the phone does not hold yet, marked (⚠️ with its 🔧) with the way to the site's own page. */
@Composable
private fun SiteLine(warn: String, fix: String, onOpen: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(RoundedCornerShape(12.dp))) {
        WarnFix(warn, fix)
        TextButton(onClick = onOpen, modifier = Modifier.padding(horizontal = 4.dp)) { Text(D.openSite, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
    }
}

// ── «الأفكار» ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «الأفكار» (src/components/ideas-view.tsx): the filters, one card per idea — the vote box on the start side (the count, the accent while
 * voted), the title, the description, who and where, the status pill; «إضافة فكرة» is the round button.
 */
@Composable
fun IdeasScreen(spaceKey: String?, meId: String?, isHq: Boolean = false, vm: IdeasViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    var filter by rememberSaveable { mutableStateOf("ALL") }
    var adding by remember { mutableStateOf(false) }
    val me = meId
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> {
                val shown = data.ideas.filter { i ->
                    when (filter) { "ALL" -> true; "MINE" -> i.creatorId == me; "SHARED" -> i.shared; else -> i.status == filter }
                }
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((k, label) in D.IDEA_FILTERS) Chip(label, k == filter) { filter = k }
                    }
                    if (shown.isEmpty()) QuietEmpty(D.ideasEmpty, "")
                    else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                        items(shown, key = { it.id }) { IdeaCard(it, isHq, spaceKey) { vm.vote(it.id) } }
                    }
                }
            }
        }
        if (data != null) RoundFab(Icons.Filled.Add, D.addIdea, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { adding = true }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    if (adding) {
        var title by rememberSaveable { mutableStateOf("") }
        var desc by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { adding = false },
            containerColor = Zk.colors.surface1,
            title = { Text(D.addIdea) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(title, { title = it.take(140) }, label = { Text(D.ideaTitle) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(desc, { desc = it.take(2000) }, label = { Text(D.ideaDesc) }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth())
                }
            },
            // the site's rule: three letters at least
            confirmButton = { TextButton(enabled = title.trim().length >= 3 && !busy, onClick = { vm.add(title, desc) { adding = false } }) { Text(D.addIdea) } },
            dismissButton = { TextButton(onClick = { adding = false }) { Text(io.zakiai.workspace.feature.projects.P.cancel) } },
        )
    }
}

@Composable
private fun ideaTone(s: String): Color = when (s) {
    "UNDER_REVIEW" -> Zk.colors.warn
    "PLANNING" -> Zk.colors.info
    "LAUNCHED", "ACCEPTED" -> Zk.colors.ok
    "REJECTED" -> Zk.colors.danger
    else -> Zk.colors.fgMuted
}

@Composable
private fun IdeaCard(i: Idea, isHq: Boolean, here: String?, onVote: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 5.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            Modifier.width(44.dp).heightIn(min = 56.dp).clip(RoundedCornerShape(10.dp))
                .background(if (i.votedByMe) Zk.colors.accent.copy(alpha = 0.12f) else Zk.colors.surface2)
                .border(1.dp, if (i.votedByMe) Zk.colors.accent else Zk.colors.border, RoundedCornerShape(10.dp)).clickable(onClick = onVote),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.KeyboardArrowUp, D.vote, tint = if (i.votedByMe) Zk.colors.accent else Zk.colors.fgMuted)
            Text("${i.voteCount}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (i.votedByMe) Zk.colors.accent else Zk.colors.fg)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(i.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                StateChip(D.ideaStatus(i.status), ideaTone(i.status))
            }
            i.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, lineHeight = 19.sp, color = Zk.colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp)) }
            Text(
                D.ideaLine(i.creatorName, i.creatorJobTitle, i.shared, i.spaceName, i.workspaceId, isHq, here, i.taskId != null),
                fontSize = 12.sp,
                color = Zk.colors.fgMuted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

// ── «التسجيل اليومي» ──────────────────────────────────────────────────────────────────────────────────────

/**
 * «التسجيل اليومي» (src/components/checkins/checkins-view.tsx): off, waiting for its hour, open (one field per question, «إرسال التسجيل» /
 * «حفظ التعديل», «إجازة اليوم»), or excused («إلغاء الإجازة»); then who answered, then the team's answers (shown after one's own).
 */
@Composable
fun CheckinsScreen(spaceId: String?, onOpenSite: (String) -> Unit = {}, vm: CheckinsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceId) { vm.refresh(spaceId) }
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(spaceId) })
            !data.enabled -> QuietEmpty(D.checkinsOff, "")
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 96.dp)) {
                val round = data.round
                val me = data.me
                // the site's own states (checkins-view.tsx): waiting · closed · excused (undo only while open) · the form · not a participant
                when {
                    round == null -> QuietEmpty(D.waitingLine(data.day, data.schedule?.timeOfDay, data.schedule?.weekdays), "")
                    !round.open -> Text(D.roundClosed, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp))
                    me == null -> {}
                    !me.participant -> Text(D.notParticipant, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp))
                    me.excused -> SoftCard {
                        Text(D.excusedOn, fontSize = 15.sp, color = Zk.colors.info)
                        TextButton(enabled = !busy, onClick = { vm.excuse(false) }) { Text(D.unexcuse, color = Zk.colors.accent) }
                    }
                    else -> {
                        // kept across a turn of the phone; re-read when the server's answer changes
                        var answers by rememberSaveable(round.id, me.answered, me.answers.joinToString("\u0001")) {
                            mutableStateOf(ArrayList(round.questions.indices.map { me.answers.getOrElse(it) { "" } }))
                        }
                        SoftCard(D.checkins) {
                            round.questions.forEachIndexed { qi, q ->
                                Text(q, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(top = if (qi > 0) 10.dp else 0.dp))
                                OutlinedTextField(
                                    answers.getOrElse(qi) { "" },
                                    { v -> answers = ArrayList(answers).also { it[qi] = v.take(1000) } },
                                    minLines = 2,
                                    maxLines = 6,
                                    modifier = Modifier.fillMaxWidth(),
                                    enabled = !me.answered || me.canEdit,
                                )
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(enabled = !busy && answers.any { it.isNotBlank() } && (!me.answered || me.canEdit), onClick = { vm.answer(answers.toList(), me.taskIds) }) { Text(if (me.answered) D.update else D.submit, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
                                if (!me.answered) TextButton(enabled = !busy, onClick = { vm.excuse(true) }) { Text(D.excuse, color = Zk.colors.fgMuted) }
                            }
                        }
                    }
                }
                if (data.roster.isNotEmpty()) SoftCard(count = data.roster.size) {
                    data.roster.forEach { r ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(r.name, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                            StateChip(D.rosterStatus(r.status), when (r.status) { "answered" -> Zk.colors.ok; "excused" -> Zk.colors.info; "missed" -> Zk.colors.danger; else -> Zk.colors.fgMuted })
                        }
                    }
                }
                val team = data.team
                if (team == null) {
                    if (data.round != null) Text(D.teamLocked, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp))
                } else for (a in team) SoftCard(a.userName) {
                    a.answers.forEachIndexed { qi, ans ->
                        data.round?.questions?.getOrNull(qi)?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
                        Text(ans, fontSize = 14.5.sp, lineHeight = 22.sp, color = Zk.colors.fg, modifier = Modifier.padding(bottom = 6.dp))
                    }
                }
                // ⚠️/🔧 what the site's page still holds alone (history, settings, tasks linked to an answer)
                SiteLine(D.checkinsSiteWarn, D.checkinsSiteFix) { onOpenSite("/checkins") }
            }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
}

// ── «الموافقات» ───────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun approvalTone(s: String): Color = when (s) {
    "APPROVED" -> Zk.colors.ok
    "REJECTED" -> Zk.colors.danger
    "CHANGES_REQUESTED" -> Zk.colors.info
    "PENDING" -> Zk.colors.warn
    else -> Zk.colors.fgMuted
}

/**
 * «الموافقات» (src/app/(app)/approvals/page.tsx): «طلباتي» · «بانتظاري (n)» · «كل الطلبات» (for whom the site allows it), one card per
 * request — the title, the status, who asked, the amount exactly as the server gives it (or «المبلغ مخفي عنك»), who it waits on, the chain.
 */
@Composable
fun ApprovalsScreen(
    spaceId: String?,
    onOpen: (String) -> Unit,
    /** the site's `narrowTo`: the space the person is in, or null inside «الشركة» */
    narrowTo: String? = spaceId,
    initialView: String? = null,
    onOpenSite: (String) -> Unit = {},
    vm: ApprovalsViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val allowAll by vm.allowAll.collectAsStateWithLifecycle()
    val waiting by vm.waiting.collectAsStateWithLifecycle()
    var view by rememberSaveable(initialView) { mutableStateOf(D.viewOf(initialView)) }
    // the site refused «كل الطلبات»: back to «بانتظاري», as the site's page does
    LaunchedEffect(allowAll) { if (allowAll == false && view == "all") view = "waiting" }
    WhileOnScreen(60_000, spaceId, narrowTo, view) { vm.refresh(view, narrowTo) }
    val data = state.data
    Column(Modifier.fillMaxSize()) {
        PillStrip {
            // the site's order: «طلباتي» · «بانتظاري (n)» · «كل الطلبات»
            PillTab(D.viewMine, 0, view == "mine") { view = "mine" }
            PillTab(D.viewWaiting, waiting, view == "waiting") { view = "waiting" }
            if (allowAll == true) PillTab(D.viewAll, 0, view == "all") { view = "all" }
        }
        val site: @Composable () -> Unit = { SiteLine(D.approvalsSiteWarn, D.siteFix) { onOpenSite("/approvals?new=1") } }
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(view, narrowTo) })
            data.approvals.isEmpty() -> Column(Modifier.fillMaxSize()) {
                QuietEmpty(when (view) { "mine" -> D.emptyMine; "all" -> D.emptyAll; else -> D.emptyWaiting }, "")
                site()
            }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                items(data.approvals, key = { it.id }) { a -> ApprovalCard(a, showSpace = view == "all") { onOpen(a.id) } }
                item(key = "site") { site() }
            }
        }
    }
}

@Composable
private fun ApprovalCard(a: ApprovalItem, showSpace: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 5.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).clickable(onClick = onClick).padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(a.title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            StateChip(D.status(a.status), approvalTone(a.status))
        }
        Text(
            listOfNotNull(D.by(a.requester.name), if (showSpace) a.workspaceName else null, if (a.version > 1) D.version(a.version) else null, io.zakiai.workspace.feature.projects.P.dmy(a.createdAt)).joinToString(" · "),
            fontSize = 12.sp,
            color = Zk.colors.fgMuted,
            modifier = Modifier.padding(top = 4.dp),
        )
        a.amount?.let { Text(D.money(it.minor, it.currency), fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = Zk.colors.fg, modifier = Modifier.padding(top = 2.dp)) }
        if (a.amountHidden) Text(D.amountHidden, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 2.dp))
        a.waitingOn?.let { Text(D.waitingOn(it.name), fontSize = 12.sp, color = Zk.colors.warn, modifier = Modifier.padding(top = 2.dp)) }
        if (a.steps.isNotEmpty()) Text(
            a.steps.sortedBy { it.position }.joinToString(" ← ") { it.approver.name },
            fontSize = 12.sp,
            color = Zk.colors.fgMuted,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/**
 * ONE REQUEST (src/components/approvals/detail-view.tsx): the title and status, the amount with the site's ⚠️/🔧 (an approval moves no money),
 * the details, the attachments, the chain with each decision and reason; the decision panel for the approver whose turn it is («وافق»,
 * «اطلب تعديل», «ارفض», a reason required with the last two), «ألغِ الطلب» for the requester.
 */
@Composable
fun ApprovalScreen(onBack: () -> Unit, onOpenSite: (String) -> Unit = {}, vm: ApprovalViewModel = hiltViewModel(), files: OpenerViewModel = hiltViewModel()) {
    LaunchedEffect(vm.id) { vm.refresh() }
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    Notices(notice, vm::consumeNotice, snack)
    var reason by rememberSaveable { mutableStateOf("") }
    var askCancel by remember { mutableStateOf(false) }
    val a = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = D.approvals, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                a == null && state.failure == null -> Loading()
                a == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                a == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(a.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                            StateChip(D.status(a.status), approvalTone(a.status))
                        }
                        Text(listOfNotNull(D.by(a.requester.name), if (a.version > 1) D.version(a.version) else null, io.zakiai.workspace.feature.projects.P.dmy(a.createdAt)).joinToString(" · "), fontSize = 13.sp, color = Zk.colors.fgMuted)
                    }
                    a.amount?.let {
                        SoftCard {
                            Text(D.money(it.minor, it.currency), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                            Spacer(Modifier.height(6.dp))
                            WarnFix(D.moneyNote, D.moneyFix)
                        }
                    }
                    if (a.amountHidden) Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                        Text(D.amountHidden, fontSize = 13.sp, color = Zk.colors.fgMuted)
                        Text(D.amountHiddenFix, fontSize = 12.sp, color = Zk.colors.fgMuted)
                    }
                    if (a.you.oversight) Text(D.oversight, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                    a.details?.takeIf { it.isNotBlank() }?.let { SoftCard { Text(it, fontSize = 15.sp, lineHeight = 23.sp, color = Zk.colors.fg) } }
                    if (a.attachments.isNotEmpty()) SoftCard(D.attachments, count = a.attachments.size) {
                        a.attachments.forEach { f ->
                            Text(f.name, fontSize = 14.sp, color = Zk.colors.accent, modifier = Modifier.fillMaxWidth().clickable { files.opener.open(io.zakiai.workspace.core.net.Attachment(id = "appr-" + f.fileId, name = f.name, mime = f.mimeType, size = f.size, url = "/api/files/" + f.fileId + "/raw")) { msg -> vm.say(msg) } }.padding(vertical = 6.dp))
                        }
                    }
                    if (a.stepsDetail.isNotEmpty()) SoftCard(D.chain) {
                        a.stepsDetail.sortedBy { it.position }.forEach { s ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(s.approver.name, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                StateChip(D.status(s.status), approvalTone(s.status))
                            }
                            s.reason?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(bottom = 4.dp)) }
                        }
                    }
                    if (a.you.canDecide) {
                        val shape = RoundedCornerShape(14.dp)
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.warn.copy(alpha = 0.10f)).border(1.dp, Zk.colors.warn.copy(alpha = 0.4f), shape).padding(14.dp)) {
                            Text(D.decisionTitle, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                            OutlinedTextField(reason, { reason = it.take(1000) }, label = { Text(D.reason) }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                // one decision at a time: the buttons wait while it is on its way
                                Text(D.approve, color = Zk.colors.accentFg, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accent.copy(alpha = if (busy) 0.5f else 1f)).clickable(enabled = !busy) { vm.decide("APPROVE", reason) }.padding(horizontal = 16.dp, vertical = 9.dp))
                                Text(D.changes, color = Zk.colors.info, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.info.copy(alpha = 0.12f)).clickable(enabled = !busy) { vm.decide("CHANGES", reason) }.padding(horizontal = 14.dp, vertical = 9.dp))
                                Text(D.reject, color = Zk.colors.danger, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.danger.copy(alpha = 0.12f)).clickable(enabled = !busy) { vm.decide("REJECT", reason) }.padding(horizontal = 14.dp, vertical = 9.dp))
                            }
                        }
                    }
                    if (a.you.canCancel) TextButton(enabled = !busy, onClick = { askCancel = true }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(D.cancel, color = Zk.colors.danger) }
                    // ⚠️/🔧 resubmitting after «اطلب تعديل» is still the site's page
                    if (a.you.canResubmit) SiteLine(D.resubmitWarn, D.siteFix) { onOpenSite("/approvals/" + a.id) }
                    Spacer(Modifier.height(24.dp))
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (askCancel) AlertDialog(
        onDismissRequest = { askCancel = false },
        containerColor = Zk.colors.surface1,
        text = { Text(D.cancel + "؟") },
        confirmButton = { TextButton(onClick = { askCancel = false; vm.cancel() }) { Text(D.cancel, color = Zk.colors.danger) } },
        dismissButton = { TextButton(onClick = { askCancel = false }) { Text(io.zakiai.workspace.feature.projects.P.cancel) } },
    )
}
