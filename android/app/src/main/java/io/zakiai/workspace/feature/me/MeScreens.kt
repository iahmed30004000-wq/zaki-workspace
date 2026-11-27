package io.zakiai.workspace.feature.me

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.Config
import io.zakiai.workspace.feature.cards.K
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

/** The sections of «إعداداتي» the phone has, in the site's order (sections.ts): key, name, line, icon. */
data class MeSection(val key: String, val title: String, val hint: String, val icon: ImageVector)

val ME_SECTIONS = listOf(
    MeSection("account", M.sAccount, M.hAccount, Icons.Filled.Person),
    MeSection("notifications", M.sNotifications, M.hNotifications, Icons.Filled.Notifications),
    MeSection("privacy", M.sPrivacy, M.hPrivacy, Icons.Filled.Lock),
    MeSection("chat", M.sChat, M.hChat, Icons.AutoMirrored.Filled.Chat),
    MeSection("devices", M.sDevices, M.hDevices, Icons.Filled.Devices),
    MeSection("language", M.sLanguage, M.hLanguage, Icons.Filled.Language),
    MeSection("help", M.sHelp, M.hHelp, Icons.Filled.SupportAgent),
)

/** The tile colours of the site's list, by index (settings-frame.tsx): cat-4, cat-1, cat-6, cat-3, cat-5, cat-2. */
@Composable
private fun tileColor(i: Int): Color = when (i % 6) {
    0 -> Zk.colors.cat4
    1 -> Zk.colors.cat1
    2 -> Zk.colors.cat6
    3 -> Zk.colors.cat3
    4 -> Zk.colors.cat5
    else -> Zk.colors.cat2
}

/** The list of «إعداداتي» as rows (drawn inside «الإدارة»), each opening its section; what stays the site's says so once. */
@Composable
fun MeSectionRows(onOpen: (String) -> Unit, onOpenSite: (String) -> Unit) {
    ME_SECTIONS.forEachIndexed { i, s ->
        Row(Modifier.fillMaxWidth().clickable { onOpen(s.key) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)).background(tileColor(i)), contentAlignment = Alignment.Center) {
                Icon(s.icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(s.title, fontSize = 15.5.sp, color = Zk.colors.fg)
                Text(s.hint, fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        WarnFix(M.siteSectionsWarn, M.siteSectionsFix)
        TextButton(onClick = { onOpenSite("/settings/me") }) { Text(io.zakiai.workspace.feature.desk.D.openSite, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun Group(title: String, hint: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(vertical = 6.dp)) {
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
        hint?.let { Text(it, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp)) }
        Spacer(Modifier.height(4.dp))
        content()
    }
}

@Composable
private fun SwitchRow(title: String, hint: String?, on: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { onChange(!on) }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.5.sp, color = Zk.colors.fg)
            hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
        }
        Switch(on, onChange, enabled = enabled, colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent, checkedThumbColor = Zk.colors.accentFg))
    }
}

@Composable
private fun LinkRow(title: String, hint: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.5.sp, color = Zk.colors.fg)
            hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
        }
        Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

/**
 * One section of «إعداداتي» (src/app/(app)/settings/me/[section]/page.tsx on the phone). Each reads and writes the site's own route; what the
 * phone cannot do the site's way carries its ⚠️ and 🔧.
 */
@Composable
fun MeSectionScreen(
    section: String,
    onBack: () -> Unit,
    onOpenSection: (String) -> Unit,
    onOpenGuide: () -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    vm: MeViewModel = hiltViewModel(),
) {
    val notice by vm.notice.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    LaunchedEffect(section) {
        when (section) {
            "account" -> vm.loadAccount()
            "notifications", "chat" -> vm.loadPrefs()
            "privacy" -> vm.loadPrivacy()
            "devices" -> vm.loadDevices()
            else -> vm.loadFacts()
        }
    }
    val title = ME_SECTIONS.firstOrNull { it.key == section }?.title ?: M.title
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding().imePadding()) {
        ZkBar(title = title, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                when (section) {
                    "account" -> Account(vm)
                    "notifications" -> Notifications(vm)
                    "privacy" -> Privacy(vm, onOpenSection)
                    "chat" -> ChatPart(vm, onOpenSite)
                    "devices" -> DevicesPart(vm)
                    "language" -> Language(vm)
                    "help" -> Help(vm, onOpenGuide, onOpenChat)
                }
                failure?.let { Failure(it, onRetry = null, modifier = Modifier.fillMaxWidth()) }
                Spacer(Modifier.height(32.dp))
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}

// ── حسابي ──

@Composable
private fun Account(vm: MeViewModel) {
    val p by vm.profile.collectAsStateWithLifecycle()
    val facts by vm.facts.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val automation by vm.automation.collectAsStateWithLifecycle()
    val me = p ?: return Loading(Modifier.fillMaxWidth().height(120.dp))
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::uploadPicture) }
    Group(M.photo, M.photoHint) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(me.name, url = me.avatarUrl, size = 72.dp, hue = me.hue)
            Spacer(Modifier.width(12.dp))
            if (facts?.features?.avatars == true) Column {
                TextButton(enabled = !busy, onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Text(if (me.avatarUrl == null) M.photoAdd else M.photoChange, color = Zk.colors.accent)
                }
                if (me.avatarUrl != null) TextButton(enabled = !busy, onClick = { vm.removePicture() }) { Text(M.photoRemove, color = Zk.colors.danger) }
            }
        }
    }
    var name by rememberSaveable(me.id) { mutableStateOf(me.name) }
    var job by rememberSaveable(me.id) { mutableStateOf(me.jobTitle.orEmpty()) }
    var bio by rememberSaveable(me.id) { mutableStateOf(me.bio.orEmpty()) }
    Group(M.sAccount) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(name, { name = it.take(100) }, label = { Text(M.name) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(job, { job = it.take(60) }, label = { Text(M.jobTitle) }, placeholder = { Text(M.jobTitlePh) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(bio, { bio = it.take(500) }, label = { Text(M.bio) }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth())
            TextButton(enabled = name.isNotBlank() && !busy, onClick = { vm.saveProfile(name, job, bio) }) { Text(M.save, color = Zk.colors.accent, fontWeight = FontWeight.Bold) }
            me.username?.let {
                // «@sara» is left-to-right inside an Arabic line: isolated, or the «@» lands on the wrong side
                Text(M.username + ": ⁦@" + it + "⁩", fontSize = 13.sp, color = Zk.colors.fg)
                Text(if (facts?.usernameManaged == true) M.usernameManager else M.usernameMember, fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
            me.email?.let {
                Text(M.email + ": " + it, fontSize = 13.sp, color = Zk.colors.fg)
                Text(M.readonly, fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
        }
    }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    Group(M.changePassword, M.passwordOthersOut) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(current, { current = it.take(200) }, label = { Text(M.currentPassword) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(next, { next = it.take(200) }, label = { Text(M.newPassword) }, supportingText = { Text(M.passwordRule) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            TextButton(enabled = current.isNotEmpty() && next.length >= 8 && !busy, onClick = { vm.changePassword(current, next) { current = ""; next = "" } }) {
                Text(M.changePassword, color = Zk.colors.accent, fontWeight = FontWeight.Bold)
            }
        }
    }
    if (facts?.features?.chatAutomation == true) automation?.let { WorkHoursPart(it, busy, vm) }
}

@Composable
private fun WorkHoursPart(a: Automation, busy: Boolean, vm: MeViewModel) {
    var hours by remember(a) { mutableStateOf(a.workHours) }
    var on by remember(a) { mutableStateOf(a.chatAutomation.on) }
    var text by remember(a) { mutableStateOf(a.chatAutomation.text) }
    Group(M.whTitle, M.whHint) {
        Column(Modifier.padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val h = hours
            if (h == null) TextButton(onClick = { hours = WorkHours(tz = a.workHours?.tz.orEmpty()) }) { Text(M.whSetHours, color = Zk.colors.accent) }
            else {
                Text(M.whDays, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    M.DAYS.forEachIndexed { i, d ->
                        Chip(d, i in h.days) {
                            val days = if (i in h.days) h.days - i else (h.days + i).sorted()
                            // one day at least stays picked (the site's own rule)
                            if (days.isNotEmpty()) hours = h.copy(days = days)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(h.from, { hours = h.copy(from = it.take(5)) }, label = { Text(M.whFrom) }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(h.to, { hours = h.copy(to = it.take(5)) }, label = { Text(M.whTo) }, singleLine = true, modifier = Modifier.weight(1f))
                }
                TextButton(onClick = { hours = null; on = false }) { Text(M.whClear, color = Zk.colors.danger) }
            }
            SwitchRow(M.whOn, null, on) { on = it }
            if (on) {
                OutlinedTextField(text, { text = it.take(300) }, label = { Text(M.whText) }, placeholder = { Text(M.whTextPh) }, minLines = 2, modifier = Modifier.fillMaxWidth())
                if (hours == null) Text(M.whNeedsHours, fontSize = 12.5.sp, color = Zk.colors.warn)
            }
            WarnFix(M.whWarn, M.whFix)
            TextButton(enabled = !busy && !(on && (hours == null || text.isBlank())), onClick = { vm.saveAutomation(hours, AutoReply(on, text)) }) {
                Text(M.save, color = Zk.colors.accent, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ── الإشعارات ──

@Composable
private fun Notifications(vm: MeViewModel) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return Loading(Modifier.fillMaxWidth().height(120.dp))
    val rules = M.rules(p)
    Text(M.nIntro, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
    M.KINDS.forEach { k ->
        val r = rules.getValue(k)
        val (title, hint) = M.kind(k)
        Group(title) {
            SwitchRow(title, hint, r.on) { vm.setRule(k, r.copy(on = it)) }
            if (r.on && k != "calls") SwitchRow(M.nPreview, M.nPreviewHint, r.preview) { vm.setRule(k, r.copy(preview = it)) }
            if (!r.on && k == "mentions") WarnFix(M.nWarnMentions, M.nFixMentions, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
            if (!r.on && k == "calls") WarnFix(M.nWarnCalls, M.nFixCalls, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
        }
    }
    Group(M.nReset, M.nResetHint) { TextButton(onClick = { vm.resetNotifications() }, modifier = Modifier.padding(horizontal = 6.dp)) { Text(M.nReset, color = Zk.colors.accent) } }
    Text(M.accountWide + " " + M.nMuteNote, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

// ── الخصوصية ──

@Composable
private fun Privacy(vm: MeViewModel, onOpenSection: (String) -> Unit) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val hide by vm.lastSeen.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    Group(M.lsTitle) {
        when {
            facts == null -> Loading(Modifier.fillMaxWidth().height(60.dp))
            facts?.features?.lastSeen != true -> Text(M.lsOff, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            else -> {
                SwitchRow(M.lsHide, M.lsHint, hide == true, enabled = hide != null && !busy) { vm.setLastSeen(it) }
                WarnFix(M.lsWarn, M.lsFix, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
            }
        }
    }
    Group(M.sPrivacy) {
        LinkRow(M.pDevices, M.pDevicesHint) { onOpenSection("devices") }
        LinkRow(M.pPassword, M.pPasswordHint) { onOpenSection("account") }
    }
}

// ── الدردشة ──

@Composable
private fun ChatPart(vm: MeViewModel, onOpenSite: (String) -> Unit) {
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val p = prefs ?: return Loading(Modifier.fillMaxWidth().height(120.dp))
    val six = M.quickOf(p)
    var slot by remember { mutableStateOf<Int?>(null) }
    Group(M.quick, M.quickHint) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            six.forEachIndexed { i, e ->
                Box(
                    Modifier.size(44.dp).clip(CircleShape).background(Zk.colors.surface2)
                        .border(if (slot == i) 2.dp else 0.dp, if (slot == i) Zk.colors.accent else Color.Transparent, CircleShape)
                        .clickable { slot = if (slot == i) null else i },
                    contentAlignment = Alignment.Center,
                ) { Text(e, fontSize = 22.sp) }
            }
        }
        slot?.let { s ->
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 4.dp)) {
                M.QUICK_PALETTE.forEach { e ->
                    Text(e, fontSize = 24.sp, modifier = Modifier.clip(CircleShape).clickable {
                        if (e in six && six[s] != e) vm.say(M.quickTaken) else { vm.setQuick(six.toMutableList().apply { set(s, e) }); slot = null }
                    }.padding(6.dp))
                }
            }
        }
        if (six != M.QUICK_DEFAULT) TextButton(onClick = { vm.setQuick(M.QUICK_DEFAULT) }, modifier = Modifier.padding(horizontal = 6.dp)) { Text(M.quickReset, color = Zk.colors.accent) }
        Text(M.accountWide, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        WarnFix(M.chatSiteWarn, M.chatSiteFix)
        TextButton(onClick = { onOpenSite("/settings/me/chat") }) { Text(io.zakiai.workspace.feature.desk.D.openSite, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
    }
}

// ── الأجهزة ──

@Composable
private fun DevicesPart(vm: MeViewModel) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    val phones by vm.phones.collectAsStateWithLifecycle()
    val browsers by vm.browsers.collectAsStateWithLifecycle()
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val thisPhone = remember { Config.deviceId(context) }
    var ending by remember { mutableStateOf<SessionRow?>(null) }
    var everywhere by remember { mutableStateOf(false) }
    Group(M.vApps, M.vAppsHint) {
        when {
            facts?.features?.appConnection == false -> Text(M.vAppsOff, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            phones == null -> Loading(Modifier.fillMaxWidth().height(50.dp))
            phones!!.isEmpty() -> Text(M.noPhones, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            else -> phones!!.forEach { d ->
                val mine = d.id == thisPhone
                DeviceRow(d.name + if (mine) " · " + M.thisPhone else "", d.lastSeenAt?.let { M.lastConnect(K.stamp(it)) } ?: M.never, M.unlink, busy) { vm.unlinkPhone(d.id, mine) }
            }
        }
    }
    Group(M.vBrowsers, M.vBrowsersHint) {
        val b = browsers
        when {
            b == null -> Loading(Modifier.fillMaxWidth().height(50.dp))
            b.isEmpty() -> Text(M.noBrowsers, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            else -> b.forEach { r -> DeviceRow(M.uaLabel(r.userAgent), r.lastUsedAt?.let { M.lastPush(K.stamp(it)) } ?: M.noPushYet, M.disconnect, busy) { vm.disconnectBrowser(r.id) } }
        }
    }
    Group(M.vSessions, M.vSessionsHint) {
        val s = sessions
        when {
            s == null -> Loading(Modifier.fillMaxWidth().height(50.dp))
            s.isEmpty() -> Text(M.noSessions, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
            else -> s.forEach { r ->
                DeviceRow(
                    M.uaLabel(r.userAgent) + if (r.current) " · " + M.thisDevice else "",
                    listOfNotNull(r.lastSeenAt?.let { M.lastActive(K.stamp(it)) }, M.signedIn(K.stamp(r.createdAt))).joinToString(" · "),
                    M.endSession, busy,
                ) { if (r.current) ending = r else vm.endSession(r) }
            }
        }
    }
    Group(M.vEverywhere, M.vEverywhereHint) {
        WarnFix(M.everywhereWarn, M.everywhereFix, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
        OutlinedButton(onClick = { everywhere = true }, enabled = !busy, border = androidx.compose.foundation.BorderStroke(1.dp, Zk.colors.danger), modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp)) {
            Text(M.vEverywhere, color = Zk.colors.danger)
        }
    }
    ending?.let { r ->
        AlertDialog(
            onDismissRequest = { ending = null },
            containerColor = Zk.colors.surface1,
            text = { Text(M.endCurrentConfirm, fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(onClick = { ending = null; vm.endSession(r) }) { Text(M.yesOut, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { ending = null }) { Text(M.cancel) } },
        )
    }
    if (everywhere) AlertDialog(
        onDismissRequest = { everywhere = false },
        containerColor = Zk.colors.surface1,
        text = { Text(M.everywhereConfirm, fontSize = 14.sp, color = Zk.colors.fg) },
        confirmButton = { TextButton(onClick = { everywhere = false; vm.logoutEverywhere() }) { Text(M.yesOut, color = Zk.colors.danger) } },
        dismissButton = { TextButton(onClick = { everywhere = false }) { Text(M.cancel) } },
    )
}

@Composable
private fun DeviceRow(title: String, line: String, action: String, busy: Boolean, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(line, fontSize = 12.sp, color = Zk.colors.fgMuted)
        }
        TextButton(enabled = !busy, onClick = onAction) { Text(action, color = Zk.colors.danger, fontSize = 13.sp) }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = 14.dp))
}

// ── اللغة والأرقام ──

@Composable
private fun Language(vm: MeViewModel) {
    val digits by vm.digits.collectAsStateWithLifecycle()
    Group(M.arabic, M.arabicHint) { Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) { Chip(M.arabic, true) {} } }
    Group(M.digits, M.digitsHint) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip(M.digitsLatin, digits == "latin") { if (digits != "latin") vm.setDigits("latin") }
            Chip(M.digitsArabic, digits == "arabic") { if (digits != "arabic") vm.setDigits("arabic") }
        }
        Text(M.accountWide, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 14.dp))
        WarnFix(M.digitsWarn, M.digitsFix, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp))
    }
}

// ── المساعدة ──

@Composable
private fun Help(vm: MeViewModel, onOpenGuide: () -> Unit, onOpenChat: (String) -> Unit) {
    val facts by vm.facts.collectAsStateWithLifecycle()
    Group(M.sHelp) {
        LinkRow(M.guide, M.guideHint, onOpenGuide)
        if (facts?.contactOwnerId != null) LinkRow(M.contact, M.contactHint) { vm.contactOwner(onOpenChat) }
    }
}

// ── «دليل زاكي» ──

/** The guide's index (src/app/(app)/guide/page.tsx): the articles this person may read, a search that reads one shape of alef. */
@Composable
fun GuideScreen(onBack: () -> Unit, onOpen: (String) -> Unit, vm: GuideViewModel = hiltViewModel()) {
    val list by vm.list.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    var q by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { vm.loadList() }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = M.gTitle, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        val l = list
        when {
            l == null && failure != null -> Failure(failure!!, onRetry = { vm.loadList() })
            l == null -> Loading()
            else -> {
                val needle = K.searchKey(q.trim())
                val shown = if (needle.isEmpty()) l else l.filter { e -> K.searchKey(listOf(e.title, e.summary, e.text, e.keywords.joinToString(" ")).joinToString("\n")).contains(needle) }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                    item(key = "head") {
                        Text(M.gSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                        OutlinedTextField(q, { q = it.take(80) }, placeholder = { Text(M.gSearch) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp))
                        if (shown.isEmpty()) Text(M.gNone, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                    }
                    items(shown, key = { it.slug }) { e ->
                        Column(Modifier.fillMaxWidth().clickable { onOpen(e.slug) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.AutoMirrored.Filled.MenuBook, null, tint = Zk.colors.accent, modifier = Modifier.size(18.dp))
                                Text(" " + e.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                                if (e.badge) Text(M.gManagers, fontSize = 11.sp, color = Zk.colors.info)
                            }
                            Text(e.summary, fontSize = 13.sp, color = Zk.colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))
                    }
                }
            }
        }
    }
}

/**
 * One article (src/app/(app)/guide/[slug]/page.tsx): its blocks as the site draws them — headings, paragraphs, numbered steps, lists, a
 * tip, a ⚠️ with its 🔧, keys — and the articles on either side. Its button opens the page it names, natively when the app has it.
 */
@Composable
fun GuideArticleScreen(slug: String, onBack: () -> Unit, onOpen: (String) -> Unit, onOpenPath: (String) -> Unit, vm: GuideViewModel = hiltViewModel()) {
    val answer by vm.article.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    LaunchedEffect(slug) { vm.open(slug) }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = M.gTitle, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        val a = answer
        when {
            a == null && failure != null -> Failure(failure!!, onRetry = { vm.open(slug) })
            a == null -> Loading()
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(a.article.title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                Text(a.article.summary, fontSize = 15.sp, color = Zk.colors.fgMuted, lineHeight = 26.sp)
                a.article.blocks.forEach { b -> Block(b) }
                a.article.cta?.let { c ->
                    TextButton(onClick = { onOpenPath(c.href) }) { Text(c.label, color = Zk.colors.accent, fontWeight = FontWeight.Bold) }
                }
                HorizontalDivider(color = Zk.colors.border)
                Row(Modifier.fillMaxWidth()) {
                    a.prev?.let { p -> Column(Modifier.weight(1f).clickable { onOpen(p.slug) }.padding(6.dp)) { Text(M.gPrev, fontSize = 11.5.sp, color = Zk.colors.fgMuted); Text(p.title, fontSize = 14.sp, color = Zk.colors.accent) } } ?: Spacer(Modifier.weight(1f))
                    a.next?.let { n -> Column(Modifier.weight(1f).clickable { onOpen(n.slug) }.padding(6.dp), horizontalAlignment = Alignment.End) { Text(M.gNext, fontSize = 11.5.sp, color = Zk.colors.fgMuted); Text(n.title, fontSize = 14.sp, color = Zk.colors.accent) } }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun Block(b: GuideBlock) {
    when (b.type) {
        "h" -> Text(b.text, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.padding(top = 6.dp))
        "p" -> Text(b.text, fontSize = 15.sp, color = Zk.colors.fg, lineHeight = 26.sp)
        "tip" -> Text(M.gTip + " " + b.text, fontSize = 14.sp, color = Zk.colors.fg, lineHeight = 24.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Zk.colors.info.copy(alpha = 0.12f)).padding(12.dp))
        "warn" -> WarnFix("⚠️ " + b.text, "🔧 " + b.fix)
        "keys" -> Row(verticalAlignment = Alignment.CenterVertically) {
            b.keys.forEach { k -> Text(k, fontSize = 12.sp, color = Zk.colors.fg, modifier = Modifier.padding(end = 4.dp).clip(RoundedCornerShape(6.dp)).background(Zk.colors.surface2).padding(horizontal = 6.dp, vertical = 2.dp)) }
            Text(" " + b.text, fontSize = 14.sp, color = Zk.colors.fg)
        }
        "steps", "list" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            b.title?.let { Text(it, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg) }
            b.items.forEachIndexed { i, item ->
                Row {
                    Text(if (b.type == "steps") "${i + 1}." else "•", fontSize = 15.sp, color = Zk.colors.accent, modifier = Modifier.width(24.dp))
                    Text(item, fontSize = 15.sp, color = Zk.colors.fg, lineHeight = 25.sp)
                }
            }
        }
    }
}
