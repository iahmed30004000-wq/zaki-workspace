package io.zakiai.workspace.feature.accounts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.zakiai.workspace.core.Session
import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.core.net.ApiResult
import io.zakiai.workspace.core.net.apiCall
import io.zakiai.workspace.feature.desks.DesksApi
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The company id the accounts' doors carry, read once from the desk facts. */
private suspend fun orgOf(desks: DesksApi): String? = when (val r = apiCall { desks.facts() }) {
    is ApiResult.Ok -> r.value.orgId.ifEmpty { null }
    is ApiResult.Err -> null
}

@HiltViewModel
class AccountsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    private val api = retrofit.create(AccountsApi::class.java)
    private val desks = retrofit.create(DesksApi::class.java)
    private var org: String? = null
    private val _roster = MutableStateFlow<Roster?>(null)
    val roster: StateFlow<Roster?> = _roster.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()

    fun refresh() = viewModelScope.launch {
        val o = org ?: orgOf(desks)?.also { org = it }
        if (o == null) { _failure.value = ApiFailure(w("members.load_failed")); return@launch }
        when (val r = apiCall { api.roster(o) }) {
            is ApiResult.Ok -> { _failure.value = null; _roster.value = r.value }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
    }
}

@HiltViewModel
class AccountViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session, saved: SavedStateHandle) : ViewModel() {
    private val api = retrofit.create(AccountsApi::class.java)
    private val desks = retrofit.create(DesksApi::class.java)
    val id: String = saved.get<String>("id").orEmpty()
    private var org: String? = null
    private val _sheet = MutableStateFlow<MemberSheet?>(null)
    val sheet: StateFlow<MemberSheet?> = _sheet.asStateFlow()
    /** «إشارة التوثيق»: null when it is not the actor's to give or the company's switch is off */
    private val _verified = MutableStateFlow<Boolean?>(null)
    val verified: StateFlow<Boolean?> = _verified.asStateFlow()
    private val _failure = MutableStateFlow<ApiFailure?>(null)
    val failure: StateFlow<ApiFailure?> = _failure.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()
    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy.asStateFlow()
    /** the error of the open confirmation (suspend / offboard), shown inside it */
    private val _confirmError = MutableStateFlow<String?>(null)
    val confirmError: StateFlow<String?> = _confirmError.asStateFlow()

    fun consumeNotice() { _notice.value = null }
    fun clearConfirmError() { _confirmError.value = null }

    fun refresh() = viewModelScope.launch { load() }

    private suspend fun load() {
        val o = org ?: orgOf(desks)?.also { org = it }
        if (o == null) { _failure.value = ApiFailure(w("members.load_failed")); return }
        when (val r = apiCall { api.sheet(o, id) }) {
            is ApiResult.Ok -> {
                _failure.value = null
                _sheet.value = r.value
                val m = r.value.member
                _verified.value = if (r.value.ownerRank && m.role != "GUEST") (apiCall { api.verified(o, id) } as? ApiResult.Ok)?.value?.verified else null
            }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _failure.value = r.failure }
        }
    }

    private fun act(kind: String, call: suspend (String) -> Any, sentence: String?, inConfirm: Boolean = false, then: () -> Unit = {}) = viewModelScope.launch {
        if (_busy.value != null) return@launch
        val o = org ?: return@launch
        _busy.value = kind
        try {
            when (val r = apiCall { call(o) }) {
                is ApiResult.Ok -> { sentence?.let { _notice.value = it }; _confirmError.value = null; then(); load() }
                is ApiResult.Err -> {
                    if (r.failure.signedOut) session.expired(r.failure)
                    val text = A.refusal(r.failure)
                    if (inConfirm) _confirmError.value = text else _notice.value = text
                    // the list was stale: this person has open work now, so a receiver is needed
                    if ((r.failure.detail ?: r.failure.key) == "accounts.transfer_required") load()
                }
            }
        } finally {
            _busy.value = null
        }
    }

    fun save(body: kotlinx.serialization.json.JsonObject) = act("info", { api.patch(it, id, body) }, w("members.saved"))
    fun flip(row: CapRow) = act("caps", { api.lists(it, id, row.next) }, w("members.caps_saved"))
    fun reset(lists: Lists) = act("caps", { api.lists(it, id, lists) }, w("members.caps_reset_done"))
    fun logout() = act("logout", { api.logout(it, id) }, w("members.logged_out"))
    fun suspend(name: String, done: () -> Unit) = act("suspend", { api.status(it, id, StatusBody("suspend")) }, w("members.suspended_done", "name" to name), inConfirm = true, then = done)
    fun offboard(name: String, to: String?, done: () -> Unit) =
        act("offboard", { api.status(it, id, StatusBody("offboard", to)) }, w("members.offboarded_done", "name" to name), inConfirm = true, then = done)
    fun verify(name: String, next: Boolean) = viewModelScope.launch {
        if (_busy.value != null) return@launch
        val o = org ?: return@launch
        _busy.value = "verify"
        try {
            when (val r = apiCall { api.verify(o, id, VerifiedBody(next)) }) {
                is ApiResult.Ok -> { _verified.value = r.value.verified; _notice.value = w(if (r.value.verified) "verified.granted" else "verified.revoked", "name" to name) }
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _notice.value = (r.failure.detail ?: r.failure.key)?.let { AccountWords.all[it] } ?: w("verified.failed") }
            }
        } finally {
            _busy.value = null
        }
    }
}

// ── small pieces ──

@Composable
private fun Title(text: String, hint: String? = null) = Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 4.dp)) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
    hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, lineHeight = 18.sp) }
}

@Composable
private fun Small(text: String, color: Color = Zk.colors.fgMuted) = Text(text, fontSize = 12.5.sp, color = color, lineHeight = 18.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))

@Composable
private fun Divider() = HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))

@Composable
private fun Pill(text: String, bg: Color = Zk.colors.surface2, fg: Color = Zk.colors.fg) =
    Text(text, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1, modifier = Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp))

@Composable
private fun statusColor(s: String): Color = when (s) {
    "SUSPENDED" -> Zk.colors.warn
    "OFFBOARDED" -> Zk.colors.danger
    else -> Zk.colors.ok
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) = Text(
    label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
    color = if (on) Zk.colors.accentFg else Zk.colors.fg,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
)

@Composable
private fun Badges(m: Member, self: Boolean) = Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
    Pill(A.role(m.role, m.primaryOwner))
    Pill(A.status(m.status), statusColor(m.status).copy(alpha = 0.12f), statusColor(m.status))
    if (self) Pill(w("members.you"), Zk.colors.accent.copy(alpha = 0.12f), Zk.colors.accent)
    if (m.mustChangePassword) Pill(w("members.pw_pending"), Zk.colors.warn.copy(alpha = 0.12f), Zk.colors.warn)
    if (m.spaceOnly == true) Pill(w("members.space_only_badge"))
    if (m.verified == true) Pill("✓", Zk.colors.info.copy(alpha = 0.12f), Zk.colors.info)
}

/** A picker drawn as one line: the chosen value, a menu of the options. */
@Composable
private fun Picker(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, fontSize = 12.sp, color = Zk.colors.fgMuted)
        Box {
            Text(
                options.firstOrNull { it.first == value }?.second ?: value, fontSize = 14.sp, color = Zk.colors.fg,
                modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, Zk.colors.border, RoundedCornerShape(10.dp))
                    .clickable(enabled = enabled) { open = true }.padding(horizontal = 12.dp, vertical = 12.dp),
            )
            DropdownMenu(open, { open = false }) {
                options.forEach { (k, v) -> DropdownMenuItem(text = { Text(v) }, onClick = { open = false; onPick(k) }) }
            }
        }
    }
}

// ── the list ──

/**
 * «الحسابات والصلاحيات» (the site's `OrgMembersView`): every person of the company, every status, with the search and the status filter; a tap opens
 * the person's sheet. A new account is the site's form (it shows a temporary password once): marked, with its button.
 */
@Composable
fun AccountsScreen(onBack: () -> Unit, onOpen: (String) -> Unit, onOpenSite: (String) -> Unit, meId: String?, vm: AccountsViewModel = hiltViewModel()) {
    val roster by vm.roster.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("ALL") }
    WhileOnScreen(60_000) { vm.refresh() }
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = w("orgm.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) }, actions = {
            // the ranks below one's own (`creatableRoles`): everybody but a partner has one
            if (roster?.actorRole.let { it != null && it != "GUEST" }) RoundIcon(Icons.Filled.Add, w("members.add"), tint = Zk.colors.accent) { onOpenSite(A.addPath) }
        })
        val r = roster
        val f = failure
        when {
            r == null && f != null -> Failure(A.refusal(f), onRetry = { vm.refresh() })
            r == null -> Loading()
            else -> {
                val counts = A.counts(r.members)
                val shown = A.filter(r.members, query, status)
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                    item(key = "head") {
                        Small(w("members.subtitle"))
                        WarnFix(A.addWarn, A.addFix, Modifier.fillMaxWidth().padding(top = 8.dp))
                        OutlinedTextField(query, { query = it.take(80) }, placeholder = { Text(w("members.search_ph")) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp))
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            A.STATUSES.forEach { s -> Chip(A.status(s) + " " + (counts[s] ?: 0), status == s) { status = s } }
                        }
                        Small(A.count(shown.size))
                    }
                    if (shown.isEmpty()) item(key = "empty") { Empty(if (r.members.isEmpty()) w("members.empty") else w("members.no_match"), Modifier.fillMaxWidth().padding(32.dp)) }
                    items(shown, key = { it.id }) { m ->
                        PersonRow(m, m.id == meId, now) { onOpen(m.id) }
                        Divider()
                    }
                }
            }
        }
    }
}

@Composable
private fun PersonRow(m: Member, self: Boolean, now: Long, onClick: () -> Unit) {
    val dim = if (m.status != "ACTIVE") 0.7f else 1f
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(m.name, m.avatarUrl, size = 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(m.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg.copy(alpha = dim))
            val line = listOfNotNull(A.identity(m)?.let { "⁦$it⁩" }, m.jobTitle).joinToString(" · ")
            if (line.isNotEmpty()) Text(line, fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 1)
            Badges(m, self)
            Text(A.lastLogin(m.lastLoginAt, now), fontSize = 12.sp, color = Zk.colors.muted)
            m.managerName?.let { Text(w("members.manager_line", "name" to it), fontSize = 12.sp, color = Zk.colors.muted) }
            Text(w("members.spaces_line", "names" to A.spaces(m)), fontSize = 12.sp, color = Zk.colors.muted, maxLines = 2)
        }
    }
}

// ── one person ──

/**
 * One person's sheet (the site's `MemberSheet`): the details, «إشارة التوثيق» for the owner, the permissions by area with «شو بيقدر يعمل؟», signing out
 * everywhere, suspending and offboarding (one confirmation each, with the receiver of the open work), and the open tasks of somebody who is not active.
 * Everything offered is what the server's sheet offers; every change is the site's own route. A reset password and a reactivation (a temporary password,
 * once) and the templates are the site's page, marked.
 */
@Composable
fun AccountScreen(onBack: () -> Unit, onOpenSite: (String) -> Unit, onOpenProfile: () -> Unit, vm: AccountViewModel = hiltViewModel()) {
    val sheet by vm.sheet.collectAsStateWithLifecycle()
    val verified by vm.verified.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val confirmError by vm.confirmError.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<String?>(null) }
    var cards by remember { mutableStateOf<Boolean?>(null) } // true: silent when empty (right after a change), false: asked for
    var open by remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(Unit) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val s = sheet
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = s?.member?.name ?: w("orgm.title"), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            val f = failure
            when {
                s == null && f != null -> if (f.status == 404) Empty(w("orgm.not_member")) else Failure(A.refusal(f), onRetry = { vm.refresh() })
                s == null -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp)) {
                    head(s, onOpenProfile)
                    info(s, busy, vm)
                    if (verified != null && (verified == true || s.member.status == "ACTIVE")) item(key = "verified") {
                        Title(w("verified.section"), w("verified.help"))
                        Small((if (verified == true) "✓ " else "") + w(if (verified == true) "verified.state_on" else "verified.state_off"), Zk.colors.fg)
                        TextButton(enabled = busy == null, onClick = { vm.verify(s.member.name, verified != true) }, modifier = Modifier.padding(horizontal = 8.dp)) {
                            Text(w(if (verified == true) "verified.revoke" else "verified.grant"), color = Zk.colors.accent, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    caps(s, busy, open, { id -> open = if (id in open) open - id else open + id }, vm)
                    actions(s, busy, onOpenSite, vm) { confirm = it }
                    if (s.member.status != "ACTIVE") item(key = "cards") {
                        Title(w("bulk.section"), w("bulk.section_hint"))
                        TextButton(onClick = { cards = false }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(w("bulk.open_button"), color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    val m = s?.member ?: return
    confirm?.let { kind ->
        val off = kind == "offboard"
        var to by remember(kind) { mutableStateOf("") }
        val needs = off && m.openWork > 0 || confirmError != null && off && to.isEmpty()
        AlertDialog(
            onDismissRequest = { if (busy == null) { vm.clearConfirmError(); confirm = null } },
            containerColor = Zk.colors.surface1,
            title = { Text(w(if (off) "members.confirm_offboard_title" else "members.confirm_suspend_title", "name" to m.name)) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(w(if (off) "members.confirm_offboard_body" else "members.confirm_suspend_body"), fontSize = 13.sp, color = Zk.colors.warn)
                    Text(w(if (off) "members.confirm_offboard_fix" else "members.confirm_suspend_fix"), fontSize = 13.sp, color = Zk.colors.fg)
                    if (needs) {
                        Picker(
                            w("members.transfer_label"), to,
                            listOf("" to w("members.transfer_pick")) + s.receivers.map { it.id to A.pickLabel(it) }, busy == null,
                        ) { to = it }
                        Text(if (m.openWork > 0) w("members.transfer_hint", "n" to m.openWork) else w("accounts.transfer_required"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    }
                    confirmError?.let { Text(it, fontSize = 13.sp, color = Zk.colors.danger) }
                }
            },
            confirmButton = {
                TextButton(enabled = busy == null && !(needs && to.isEmpty()), onClick = {
                    val done = { confirm = null; cards = true }
                    if (off) vm.offboard(m.name, to.ifEmpty { null }, done) else vm.suspend(m.name, done)
                }) { Text(w(if (off) "members.confirm_offboard_yes" else "members.confirm_suspend_yes"), color = Zk.colors.danger) }
            },
            dismissButton = { TextButton(enabled = busy == null, onClick = { vm.clearConfirmError(); confirm = null }) { Text(w("members.confirm_cancel")) } },
        )
    }
    cards?.let { silent -> OpenCardsDialog(m.id, m.name, null, silent) { cards = null } }
}

private fun LazyListScope.head(s: MemberSheet, onOpenProfile: () -> Unit) = item(key = "head") {
    val m = s.member
    Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(m.name, m.avatarUrl, size = 56.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val line = listOfNotNull(A.identity(m)?.let { "⁦$it⁩" }, m.jobTitle).joinToString(" · ")
            if (line.isNotEmpty()) Text(line, fontSize = 13.sp, color = Zk.colors.fgMuted)
            Badges(m.copy(mustChangePassword = false), s.acts.isSelf)
            Text(A.lastLogin(m.lastLoginAt, System.currentTimeMillis()), fontSize = 12.sp, color = Zk.colors.muted)
        }
    }
    if (m.status == "SUSPENDED") Small(w("members.suspended_note"))
    if (m.status == "OFFBOARDED") Small(w("members.offboarded_note"))
    if (m.mustChangePassword && m.status == "ACTIVE") WarnFix(w("members.pw_pending_warning"), w("members.pw_pending_fix"))
    if (!s.acts.manageable) {
        Small(if (s.acts.isSelf) w("members.view_only_self") else if (m.role == "OWNER") w("members.view_only_owner") else w("members.view_only"))
        if (s.acts.isSelf) TextButton(onClick = onOpenProfile, modifier = Modifier.padding(horizontal = 8.dp)) { Text(w("members.profile_link"), color = Zk.colors.accent) }
    }
}

private fun LazyListScope.info(s: MemberSheet, busy: String?, vm: AccountViewModel) = item(key = "info-${s.member.id}-${s.member.role}-${s.member.name}-${s.member.managerId}") {
    val m = s.member
    Title(w("members.section_info"))
    if (!s.acts.edit) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            m.managerName?.let { Text(w("members.f_manager") + ": " + it, fontSize = 13.sp, color = Zk.colors.fg) }
            Text(w("members.spaces_label") + ": " + A.spaces(m, max = 50), fontSize = 13.sp, color = Zk.colors.fg)
        }
        return@item
    }
    var name by remember { mutableStateOf(m.name) }
    var title by remember { mutableStateOf(m.jobTitle.orEmpty()) }
    var role by remember { mutableStateOf(m.role) }
    var manager by remember { mutableStateOf(m.managerId.orEmpty()) }
    val body = A.infoBody(m, name, title, role, manager)
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text(w("orgm.name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(title, { title = it.take(80) }, label = { Text(w("auth.jobTitle")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Picker(w("members.f_rank"), role, s.roles.map { it to (if (it == "OWNER" && m.primaryOwner != true) w("role.partner") else A.role(it)) }, busy == null) { role = it }
        AccountWords.all["members.rank_hint_" + role.lowercase()]?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
        if (role != "GUEST") {
            val known = s.managers.any { it.id == m.managerId }
            val options = listOf("" to w("members.manager_owner")) + s.managers.map { it.id to it.name } +
                (if (!known && m.managerId != null) listOf(m.managerId to (m.managerName ?: "—")) else emptyList())
            Picker(w("members.f_manager"), manager, options, busy == null) { manager = it }
        }
        TextButton(enabled = body != null && busy == null && name.trim().length >= 2, onClick = { body?.let { vm.save(it) } }) {
            Text(w("members.save"), color = if (body != null) Zk.colors.accent else Zk.colors.fgMuted, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun LazyListScope.caps(s: MemberSheet, busy: String?, open: Set<String>, toggle: (String) -> Unit, vm: AccountViewModel) {
    item(key = "caps-title") { Title(w("members.section_caps")) }
    when (s.acts.capabilities) {
        "owner" -> { item(key = "caps-owner") { Small(w("members.caps_owner")) }; return }
        "guest" -> { item(key = "caps-guest") { Small(w("members.caps_guest")) }; return }
    }
    val editable = s.acts.capabilities == "editable"
    item(key = "caps-intro") {
        Small(if (editable) w("members.caps_intro") else w("members.caps_readonly"))
        if (editable && s.member.role != "OWNER" && s.member.role != "GUEST") WarnFix(A.templateWarn, A.templateFix, Modifier.fillMaxWidth().padding(top = 6.dp))
    }
    // «شو بيقدر يعمل؟»
    item(key = "explain") {
        val rows = s.explain.flatMap { it.rows }
        AreaHead(w("perm.explain.title"), w("perm.explain.count", "on" to rows.count { it.usable }, "total" to rows.size), "explain" in open) { toggle("explain") }
        if ("explain" in open) {
            Small(w("perm.explain.hint"))
            s.explain.forEach { a ->
                Text(A.area(a.id), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
                a.rows.forEach { r ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (r.usable) "✓" else "✗", color = if (r.usable) Zk.colors.ok else Zk.colors.danger, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Column(Modifier.weight(1f)) {
                            Text(A.capTitle(r.capability) + " — " + w(if (r.usable) "perm.explain.can" else "perm.explain.cannot"), fontSize = 13.5.sp, color = Zk.colors.fg)
                            Text(r.why, fontSize = 12.sp, color = Zk.colors.fgMuted)
                        }
                    }
                }
            }
        }
        Divider()
    }
    s.oversight?.let { row ->
        item(key = "oversight") {
            Text(w("members.group_oversight"), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
            SwitchLine(row, busy) { vm.flip(row) }
            Divider()
        }
    }
    item(key = "areas-hint") { Small(w("perm.areas_hint") + if (s.areas.any { it.grid.isNotEmpty() }) " " + w("members.sections_intro") else "") }
    s.areas.forEach { a ->
        item(key = "area-${a.id}") {
            AreaHead(A.area(a.id), w("perm.area_count", "on" to a.on, "total" to a.total), a.id in open) { toggle(a.id) }
            if (a.id in open) {
                if (a.grid.isNotEmpty()) Grid(a.grid, busy, vm)
                a.rows.forEach { row -> SwitchLine(row, busy) { vm.flip(row) } }
            }
            Divider()
        }
    }
    item(key = "caps-foot") {
        if (s.areas.any { it.grid.isNotEmpty() }) Small("● " + w("members.sections_legend"))
        s.reset?.let { lists ->
            TextButton(enabled = busy == null, onClick = { vm.reset(lists) }, modifier = Modifier.padding(horizontal = 8.dp)) { Text(w("members.caps_reset"), color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
private fun AreaHead(title: String, count: String, expanded: Boolean, onClick: () -> Unit) =
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
        Text(count, fontSize = 12.sp, color = Zk.colors.muted)
        Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Zk.colors.muted, modifier = Modifier.size(20.dp))
    }

@Composable
private fun SwitchLine(row: CapRow, busy: String?, onFlip: () -> Unit) =
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(A.capTitle(row.capability), fontSize = 14.sp, color = Zk.colors.fg)
            A.capHint(row.capability)?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, lineHeight = 17.sp) }
            Text(A.tag(row), fontSize = 11.5.sp, color = if (row.customized) Zk.colors.warn else Zk.colors.muted, fontWeight = if (row.customized) FontWeight.SemiBold else FontWeight.Normal)
            A.note(row)?.let { Text(it, fontSize = 11.5.sp, color = if (row.locked == "actor_lacks") Zk.colors.muted else Zk.colors.warn) }
        }
        Switch(
            checked = row.on, enabled = row.locked == null && busy == null, onCheckedChange = { onFlip() },
            colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent, checkedThumbColor = Zk.colors.accentFg),
        )
    }

/** «يشوف / يضيف ويعدّل / يحذف» per section: a box each, a dot where it differs from the rank's template */
@Composable
private fun Grid(rows: List<GridRow>, busy: String?, vm: AccountViewModel) = Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        Text(w("members.sections_section"), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1.4f))
        A.ACTIONS.forEach { Text(A.action(it), fontSize = 11.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
    }
    rows.forEach { r ->
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(A.section(r.section), fontSize = 13.5.sp, color = Zk.colors.fg, modifier = Modifier.weight(1.4f))
            r.cells.forEach { c ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    if (c == null) Text("—", color = Zk.colors.muted)
                    else Box {
                        Checkbox(
                            checked = c.on, enabled = c.locked == null && busy == null, onCheckedChange = { vm.flip(c) },
                            colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent, checkmarkColor = Zk.colors.accentFg),
                        )
                        if (c.customized && !c.needsView) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.warn))
                    }
                }
            }
        }
    }
    if (rows.any { it.section == "tasks" }) Small(w("perm.tasks_delete_note"))
    if (rows.any { r -> r.cells.any { it?.needsView == true } }) Small(w("members.sections_needs_view"))
}

private fun LazyListScope.actions(s: MemberSheet, busy: String?, onOpenSite: (String) -> Unit, vm: AccountViewModel, onConfirm: (String) -> Unit) {
    val a = s.acts
    if (a.resetPassword || a.logoutEverywhere) item(key = "security") {
        Title(w("members.section_security"))
        if (a.logoutEverywhere) ActionLine(w("members.act_logout"), w("members.act_logout_hint"), busy == null, Zk.colors.fg) { vm.logout() }
        if (a.resetPassword) ActionLine(w("members.act_reset_pw"), w("members.act_reset_pw_hint"), true, Zk.colors.fg) { onOpenSite(A.sitePath) }
    }
    if (a.reactivate || a.suspend || a.offboard) item(key = "status") {
        Title(w("members.section_status"))
        if (a.reactivate) ActionLine(w("members.act_reactivate"), w("members.act_reactivate_hint"), true, Zk.colors.fg) { onOpenSite(A.sitePath) }
        if (a.suspend) ActionLine(w("members.act_suspend"), w("members.act_suspend_hint"), busy == null, Zk.colors.danger) { onConfirm("suspend") }
        if (a.offboard) ActionLine(w("members.act_offboard"), w("members.act_offboard_hint"), busy == null, Zk.colors.danger) { onConfirm("offboard") }
    }
    if (a.resetPassword || a.reactivate) item(key = "secret-mark") { WarnFix(A.secretWarn, A.secretFix, Modifier.fillMaxWidth().padding(top = 8.dp)) }
}

@Composable
private fun ActionLine(title: String, hint: String, enabled: Boolean, color: Color, onClick: () -> Unit) =
    Column(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text(title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = if (enabled) color else Zk.colors.fgMuted)
        Text(hint, fontSize = 12.sp, color = Zk.colors.fgMuted, lineHeight = 17.sp)
    }

// ── «مهامه المفتوحة» ──

@HiltViewModel
class OpenCardsViewModel @Inject constructor(retrofit: retrofit2.Retrofit, private val session: Session) : ViewModel() {
    private val api = retrofit.create(AccountsApi::class.java)
    private val _cards = MutableStateFlow<OpenCards?>(null)
    val cards: StateFlow<OpenCards?> = _cards.asStateFlow()
    private val _people = MutableStateFlow<List<DirPerson>>(emptyList())
    val people: StateFlow<List<DirPerson>> = _people.asStateFlow()
    private val _result = MutableStateFlow<BulkResult?>(null)
    val result: StateFlow<BulkResult?> = _result.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private var loaded: String? = null

    fun load(from: String, space: String?) = viewModelScope.launch {
        val key = from + "|" + space
        if (loaded == key) return@launch
        loaded = key
        when (val r = apiCall { api.openCards(from, space) }) {
            is ApiResult.Ok -> {
                _cards.value = r.value
                if (r.value.count > 0) (apiCall { api.directory() } as? ApiResult.Ok)?.let { d -> _people.value = d.value.people.filter { it.userId != from } }
            }
            is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _error.value = A.refusal(r.failure) }
        }
    }

    fun apply(from: String, to: String?, space: String?) = viewModelScope.launch {
        if (_busy.value) return@launch
        _busy.value = true
        try {
            when (val r = apiCall { api.bulk(BulkBody(from, to, space)) }) {
                is ApiResult.Ok -> _result.value = r.value
                is ApiResult.Err -> { if (r.failure.signedOut) session.expired(r.failure); _error.value = A.refusal(r.failure) }
            }
        } finally {
            _busy.value = false
        }
    }
}

/**
 * «مهامه المفتوحة» (the site's `OpenCardsDialog`, `GET/POST /api/tasks/bulk-assign`): the open cards of a person who left or is leaving, and ONE action —
 * unassign them all, or hand them all to somebody. [space] narrows it to the space they were just taken out of; [silentWhenEmpty] closes it without a
 * word when there is nothing to arrange (right after a change).
 */
@Composable
fun OpenCardsDialog(personId: String, personName: String, space: String?, silentWhenEmpty: Boolean, onClose: () -> Unit) {
    val vm: OpenCardsViewModel = hiltViewModel(key = "open-cards-$personId-$space")
    val cards by vm.cards.collectAsStateWithLifecycle()
    val people by vm.people.collectAsStateWithLifecycle()
    val result by vm.result.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var to by remember { mutableStateOf("") }
    LaunchedEffect(personId, space) { vm.load(personId, space) }
    val c = cards
    val empty = c != null && c.count == 0
    LaunchedEffect(empty) { if (empty && silentWhenEmpty) onClose() }
    if (empty && silentWhenEmpty) return
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = Zk.colors.surface1,
        title = { Text(w("bulk.title", "name" to personName)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val r = result
                when {
                    error != null -> Text(error.orEmpty(), color = Zk.colors.danger, fontSize = 13.sp)
                    c == null -> Text("…", color = Zk.colors.fgMuted)
                    r != null -> {
                        Text(w("bulk.done", "moved" to r.moved.size, "requested" to r.requested.size, "skipped" to r.skipped.size), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                        if (r.requested.isNotEmpty()) Text(w("bulk.requested_note"), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                        if (r.skipped.isNotEmpty()) Text(w("bulk.skipped_note"), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                    }
                    empty -> Text(w("bulk.none", "name" to personName), fontSize = 13.sp, color = Zk.colors.fgMuted)
                    else -> {
                        Text(w("bulk.count", "n" to c.count), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                        Column(Modifier.fillMaxWidth().heightIn(max = 200.dp).verticalScroll(rememberScrollState()).border(1.dp, Zk.colors.border, RoundedCornerShape(10.dp))) {
                            c.tasks.forEach { t ->
                                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp)) {
                                    Text(t.title, fontSize = 13.sp, color = Zk.colors.fg, maxLines = 1, modifier = Modifier.weight(1f))
                                    Text(t.workspaceName, fontSize = 11.5.sp, color = Zk.colors.fgMuted, maxLines = 1, modifier = Modifier.width(110.dp))
                                }
                            }
                        }
                        Picker(w("bulk.pick"), to, listOf("" to w("bulk.pick_none")) + people.map { it.userId to it.user.name }, !busy) { to = it }
                    }
                }
            }
        },
        confirmButton = {
            val r = result
            if (r != null || error != null || empty) TextButton(onClick = onClose) { Text(w("bulk.close")) }
            else if (c != null) TextButton(enabled = !busy, onClick = { vm.apply(personId, to.ifEmpty { null }, space) }) { Text(w(if (to.isNotEmpty()) "bulk.apply_move" else "bulk.apply_unassign")) }
        },
        dismissButton = { if (result == null && error == null && !empty) TextButton(enabled = !busy, onClick = onClose) { Text(w("bulk.later")) } },
    )
}
