package io.zakiai.workspace.feature.dev

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) = Text(
    label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
    color = if (on) Zk.colors.accentFg else Zk.colors.fg,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
)

@Composable
private fun Title(text: String, hint: String? = null) = Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp)) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
    hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
}

@Composable
private fun Line(text: String, color: Color = Zk.colors.fgMuted, size: Float = 12.5f) = Text(text, fontSize = size.sp, color = color, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))

@Composable
private fun Mark(warn: String, fix: String) = Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
    WarnFix(if (warn.startsWith("⚠️")) warn else "⚠️ $warn", if (fix.startsWith("🔧")) fix else "🔧 $fix")
}

@Composable
private fun Divider() = HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(horizontal = 16.dp))

@Composable
private fun Act(label: String, enabled: Boolean, color: Color = Zk.colors.accent, onClick: () -> Unit) =
    TextButton(enabled = enabled, onClick = onClick) { Text(label, color = if (enabled) color else Zk.colors.fgMuted, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp) }

@Composable
private fun Choice(label: String, current: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Chip(if (label.isEmpty()) current else "$label: $current", true) { open = true }
        DropdownMenu(open, { open = false }, modifier = Modifier.heightIn(max = 420.dp)) { options.forEach { (id, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { onPick(id); open = false }) } }
    }
}

@Composable
private fun lightColor(l: String?): Color? = when (l) {
    "GREEN" -> Zk.colors.ok
    "AMBER" -> Zk.colors.warn
    "RED" -> Zk.colors.danger
    else -> null
}

/** the status light always with its word (a colour alone says nothing); a suggestion is marked «اقتراح» */
@Composable
private fun LightBadge(light: String?, suggested: Boolean = false) {
    val c = lightColor(light)
    if (c == null) { Text("—", fontSize = 12.sp, color = Zk.colors.fgMuted); return }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, c.copy(alpha = 0.45f), RoundedCornerShape(6.dp)).background(c.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(c))
        Spacer(Modifier.width(5.dp))
        Text(D.light(light) + if (suggested) " (" + w("teamdev.light.suggestion") + ")" else "", fontSize = 11.5.sp, color = c)
    }
}

@Composable
private fun BandBadge(band: String?) {
    val c = when (band) { "excellent" -> Zk.colors.ok; "good" -> Zk.colors.info; "support" -> Zk.colors.warn; else -> null }
    if (c == null) { Text("—", fontSize = 12.sp, color = Zk.colors.fgMuted); return }
    Text(D.band(band), fontSize = 11.5.sp, color = c, modifier = Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, c.copy(alpha = 0.45f), RoundedCornerShape(6.dp)).background(c.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 2.dp))
}

/** the frame: bar, loading / refusal / list, notices */
@Composable
private fun Page(title: String, ready: Boolean, failure: io.zakiai.workspace.core.net.ApiFailure?, notice: String?, onSaid: () -> Unit, onRetry: () -> Unit, onBack: () -> Unit, body: LazyListScope.() -> Unit) {
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); onSaid() } }
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = title, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                !ready && failure != null -> if (failure.status == 404) Empty(w("teamdev.not_found")) else Failure(failure.message, onRetry = onRetry)
                !ready -> Loading()
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 80.dp), content = body)
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun Formula(weights: Weights) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).clickable { open = !open }.padding(vertical = 10.dp)) {
        Line(w("teamdev.formula.title") + if (open) "  ▴" else "  ▾", Zk.colors.fg, 13.5f)
        if (open) {
            listOf("intro", "manual", "ontime").forEach { Line((DevWords.all["teamdev.formula.$it"] ?: "")) }
            Line(w("teamdev.formula.completed", "min" to 3))
            Line(w("teamdev.formula.steps"))
            Line(w("teamdev.formula.never_invent"))
            Line(w("teamdev.formula.weights", "manual" to weights.manual, "completed" to weights.completed, "onTime" to weights.onTime, "steps" to weights.steps), Zk.colors.fg)
            Line(w("teamdev.formula.bands", "excellent" to 80, "good" to 60))
            Mark(w("teamdev.formula.light", "green" to 70, "amber" to 50), w("teamdev.formula.light_fix"))
        }
    }
}

// ── «الأداء والتطوير» ────────────────────────────────────────────────────────────────────────────────────────

/**
 * «الأداء والتطوير» (src/components/control-panel/sections/development-body.tsx): the people the viewer reads with the score band and the
 * light of a period, sorted by NAME (by score only when asked). A person who reads nobody but themselves lands on their own file.
 */
@Composable
fun DevHomeScreen(onBack: () -> Unit, onOpenPerson: (String, String?) -> Unit, onSelf: (String) -> Unit, onOpenStructure: () -> Unit, onOpenSite: (String) -> Unit, vm: DevHomeViewModel = hiltViewModel()) {
    val home by vm.home.collectAsStateWithLifecycle()
    val table by vm.table.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(120_000) { vm.refresh() }
    val h = home
    // somebody who reads nobody but themselves: their own file, as the site does (it REPLACES this screen, so آ«backآ» does not bounce)
    LaunchedEffect(h?.home?.mode) { if (h?.home?.mode == "self") onSelf(h.home.viewerId) }
    Page(w("teamdev.title"), h != null && (h.home.mode == "self" || table != null), failure, notice, vm::consumeNotice, vm::refresh, onBack) {
        val a = h ?: return@Page
        val t = table ?: return@Page
        item(key = "head") {
            Line(w(if (a.home.mode == "owner") "teamdev.subtitle_owner" else "teamdev.subtitle_supervisor"))
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip(w("nav.tab.myFile"), false) { onOpenPerson(a.home.viewerId, null) }
                Chip(w("teamdev.structure.title"), false, onOpenStructure)
                Chip(w("teamdev.skills.page"), false) { onOpenSite("/development/skills") }
                if (a.home.mode == "owner") Chip(w("teamdev.settings.title"), false) { onOpenSite("/development/settings") }
            }
            Mark(D.moreWarn, D.moreFix)
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Choice(w("teamdev.col.period"), D.period(t.period.key, a.periods), a.periods.map { it.key to it.label }) { vm.pick(it) }
                Chip(w("teamdev.col.score"), t.sort == "score") { vm.sortBy(t.sort != "score") }
            }
            if (t.period.partial) Line("⚠️ " + w("teamdev.score.partial"), Zk.colors.warn)
            Title(w("teamdev.table.title"), w("teamdev.table.note"))
            if (t.rows.isEmpty()) Line(w("teamdev.people.empty"))
        }
        items(t.rows, key = { it.userId }) { r ->
            Column(Modifier.fillMaxWidth().clickable { onOpenPerson(r.userId, "score") }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(r.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                        r.jobTitle?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
                    }
                    Text(r.score?.let { D.n(it) } ?: "—", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                }
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    BandBadge(r.band)
                    LightBadge(r.light)
                    LightBadge(r.suggestedLight, suggested = true)
                }
            }
            Divider()
        }
        item(key = "formula") {
            Formula(t.weights)
            Mark(D.csvWarn, D.csvFix)
        }
    }
}

// ── one person's file ────────────────────────────────────────────────────────────────────────────────────────

/**
 * «ملف الأداء والتطوير» of one person (src/components/team-development/person-file.tsx): the skills, the score with how every number is
 * computed, the reviews, the plan, the 1:1 notes. What the person may not read (a private note, an unshared review) never arrives.
 */
@Composable
fun DevPersonScreen(onBack: () -> Unit, onOpenPerson: (String) -> Unit, vm: DevPersonViewModel = hiltViewModel()) {
    val answer by vm.person.collectAsStateWithLifecycle()
    val tab by vm.tab.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    WhileOnScreen(120_000) { vm.refresh() }
    val a = answer
    Page(if (a?.person?.isSelf == true) w("nav.tab.myFile") else a?.person?.name ?: w("teamdev.title"), a != null, failure, notice, vm::consumeNotice, { vm.refresh() }, onBack) {
        val p = a?.person ?: return@Page
        item(key = "head") {
            Line(listOfNotNull(if (p.isSelf) p.name else null, p.jobTitle, p.supervisor?.let { w("teamdev.col.supervisor") + ": " + it.name } ?: w("teamdev.structure.no_supervisor")).joinToString(" · "))
            if (p.inactive) Line("⚠️ " + w("teamdev.person.inactive"), Zk.colors.warn)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                D.tabsOf(p.role).forEach { k -> Chip((DevWords.all["teamdev.tab.$k"] ?: ""), tab == k) { if (tab != k) vm.open(k) } }
            }
        }
        when (tab) {
            "skills" -> skillsTab(vm, p, busy)
            "score" -> scoreTab(vm, a)
            "reviews" -> reviewsTab(vm, a, busy)
            "plan" -> planTab(vm, p, busy)
            "notes" -> notesTab(vm, p, busy)
        }
    }
}

private fun LazyListScope.skillsTab(vm: DevPersonViewModel, p: PersonHeader, busy: Boolean) {
    item(key = "skills") {
        val rows by vm.skills.collectAsStateWithLifecycle()
        val history by vm.history.collectAsStateWithLifecycle()
        var editing by remember { mutableStateOf<Pair<PersonSkill, String>?>(null) }
        var showHistory by rememberSaveable { mutableStateOf(false) }
        val list = rows
        when {
            list == null -> Loading()
            list.isEmpty() -> Line(w("teamdev.skill.empty"))
            else -> list.forEach { r ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(r.skill.name + (r.skill.category.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "") + if (r.skill.archived) " · " + w("teamdev.skill.archived") else "", fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                    if (r.skill.description.isNotBlank()) Text(r.skill.description, fontSize = 12.sp, color = Zk.colors.fgMuted)
                    r.gap?.takeIf { it != 0 }?.let { g -> Text(w("teamdev.skill.gap", "n" to D.n(kotlin.math.abs(g))) + " — " + w(if (g > 0) "teamdev.skill.gap_up" else "teamdev.skill.gap_down"), fontSize = 12.sp, color = Zk.colors.warn) }
                    Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        listOf("MANUAL" to r.manual, "SELF" to r.self).forEach { (source, lv) ->
                            val may = !r.skill.archived && if (source == "MANUAL") p.canEnter else p.isSelf
                            Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface1).clickable(enabled = may && !busy) { editing = r to source }.padding(8.dp)) {
                                Text(w(if (source == "MANUAL") "teamdev.skill.manual" else "teamdev.skill.self"), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                                Text(D.level(lv?.level), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                                lv?.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 11.5.sp, color = Zk.colors.fgMuted) }
                                lv?.let { Text(listOfNotNull(it.updatedBy.takeIf { source == "MANUAL" }, D.day(it.updatedAt)).joinToString(" · "), fontSize = 11.sp, color = Zk.colors.fgMuted) }
                                if (may) Text(w("teamdev.skill.pick"), fontSize = 12.sp, color = Zk.colors.accent)
                            }
                        }
                    }
                }
                Divider()
            }
        }
        if (list != null) {
            Line(w("teamdev.skill.history") + if (showHistory) "  ▴" else "  ▾", Zk.colors.accent, 13f)
            Box(Modifier.fillMaxWidth().clickable { showHistory = !showHistory }.padding(vertical = 2.dp))
            if (showHistory) {
                val names = list.associate { it.skill.id to it.skill.name }
                if (history.isEmpty()) Line(w("teamdev.skill.history_empty"))
                history.forEach { h ->
                    Line(
                        (names[h.skillId] ?: "") + " · " + w(if (h.source == "MANUAL") "teamdev.skill.manual" else "teamdev.skill.self") + ": " +
                            (h.oldLevel?.let { D.n(it) } ?: w("teamdev.skill.none")) + " ← " + D.n(h.newLevel) + " · " + h.changedBy + " · " + D.day(h.at) +
                            (if (h.reason.isNotBlank()) " · " + w("teamdev.skill.from_goal") else "") + (if (h.note.isNotBlank()) "\n" + h.note else ""),
                    )
                }
            }
        }
        editing?.let { (r, source) ->
            val now = if (source == "MANUAL") r.manual else r.self
            var level by remember(r.skill.id, source) { mutableStateOf(now?.level) }
            var note by remember(r.skill.id, source) { mutableStateOf(now?.note.orEmpty()) }
            AlertDialog(
                onDismissRequest = { editing = null },
                containerColor = Zk.colors.surface1,
                title = { Text(r.skill.name) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(w(if (source == "MANUAL") "teamdev.skill.manual" else "teamdev.skill.self"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                        (0..4).forEach { n -> Chip(D.level(n), level == n) { level = n } }
                        OutlinedTextField(note, { note = it.take(300) }, label = { Text(w("teamdev.skill.note")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    }
                },
                confirmButton = { TextButton(enabled = !busy && level != null, onClick = { vm.setLevel(r.skill.id, source, level ?: 0, note) { editing = null } }) { Text(D.save) } },
                dismissButton = { TextButton(onClick = { editing = null }) { Text(D.cancel) } },
            )
        }
    }
}

private fun LazyListScope.scoreTab(vm: DevPersonViewModel, a: PersonAnswer) {
    item(key = "score") {
        val s by vm.score.collectAsStateWithLifecycle()
        val sc = s ?: run { Loading(); return@item }
        Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
            Choice(w("teamdev.col.period"), D.period(sc.period.key, a.periods), a.periods.map { it.key to it.label }) { vm.pick(it) }
        }
        Line(D.period(sc.period.key, a.periods) + " · " + D.day(sc.period.from) + " ← " + D.day(sc.period.to))
        Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(14.dp)) {
            Text(w("teamdev.col.score"), fontSize = 12.sp, color = Zk.colors.fgMuted)
            Text(sc.score?.let { D.n(it) } ?: "—", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(w("teamdev.col.band") + ":", fontSize = 12.sp, color = Zk.colors.fgMuted); BandBadge(sc.band)
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(w("teamdev.col.light") + ":", fontSize = 12.sp, color = Zk.colors.fgMuted); LightBadge(sc.light)
            }
            if (sc.suggestedLight != null) Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(w("teamdev.light.system") + ":", fontSize = 12.sp, color = Zk.colors.fgMuted); LightBadge(sc.suggestedLight, suggested = true)
            }
            if (sc.score == null) Text(w("teamdev.score.nothing"), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
            if (sc.period.partial) Text("⚠️ " + w("teamdev.score.partial"), fontSize = 12.sp, color = Zk.colors.warn)
            if (sc.sharedOnly) Text(w("teamdev.score.shared_only"), fontSize = 12.sp, color = Zk.colors.fgMuted)
        }
        Title(w("teamdev.score.indicator"))
        val count = { i: Indicator -> i.baseline?.let { b -> w("teamdev.score.how.count", "n" to D.n(i.count), "base" to D.num(b.value), "src" to (DevWords.all["teamdev.score.baseline.${b.source}"] ?: "")) } ?: w("teamdev.score.how.count_none", "n" to D.n(i.count)) }
        listOf(
            Triple("manual", sc.manual, sc.manual.average?.let { w("teamdev.score.how.manual", "avg" to D.one(it), "n" to D.n(sc.manual.reviews)) } ?: w("teamdev.score.how.manual_none")),
            Triple("completed", sc.completed, count(sc.completed)),
            Triple("onTime", sc.onTime, if (sc.onTime.withDue == 0) w("teamdev.score.how.ontime_none") else w("teamdev.score.how.ontime", "a" to D.n(sc.onTime.onTime), "b" to D.n(sc.onTime.withDue))),
            Triple("steps", sc.steps, count(sc.steps)),
        ).forEach { (key, ind, how) ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text((DevWords.all["teamdev.score.ind.$key"] ?: ""), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Text(D.num(ind.value), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                }
                Text(how, fontSize = 12.sp, color = Zk.colors.fgMuted)
                Text(w("teamdev.score.weight") + ": " + (ind.share?.let { D.num(it) + "%" } ?: w("teamdev.score.left_out")) + " (" + D.n(ind.weight) + ")", fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
            Divider()
        }
        Title(w("teamdev.score.extras"))
        val e = sc.extras
        listOfNotNull(
            w("teamdev.score.open_now") to D.n(e.openNow),
            w("teamdev.score.overdue_now") to D.n(e.overdueNow),
            w("teamdev.score.messages") to D.n(e.messages),
            w("teamdev.score.time") to D.minutes(e.trackedMinutes),
            e.checkins?.let { w("teamdev.score.checkins") to D.n(it.answered) },
            e.checkins?.let { w("teamdev.score.checkins_streak") to D.n(it.streak) },
        ).forEach { (label, value) ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 3.dp)) {
                Text(label, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.weight(1f))
                Text(value, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
            }
        }
        Line(w("teamdev.score.extras_note"))
        if (e.checkins != null) Line(w("teamdev.score.checkins_note"))
        Formula(sc.weights)
    }
}

private fun LazyListScope.reviewsTab(vm: DevPersonViewModel, a: PersonAnswer, busy: Boolean) {
    item(key = "reviews") {
        val reviews by vm.reviews.collectAsStateWithLifecycle()
        val criteria by vm.criteria.collectAsStateWithLifecycle()
        var writing by rememberSaveable { mutableStateOf(false) }
        val list = reviews ?: run { Loading(); return@item }
        val p = a.person
        if (p.canEnter) Act("+ " + w("teamdev.review.form"), !busy) { writing = true }
        if (list.isEmpty()) Line(w(if (p.isSelf) "teamdev.review.none_self" else "teamdev.review.none"))
        val names = criteria.associate { it.id to it.name }
        list.groupBy { it.period }.forEach { (key, rs) ->
            Title(D.period(key, a.periods))
            rs.forEach { r ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(r.reviewerName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (r.live) Zk.colors.fg else Zk.colors.fgMuted)
                        if (r.light != null) LightBadge(r.light)
                    }
                    Text(w("teamdev.review.version", "n" to D.n(r.version)) + " · " + (DevWords.all["teamdev.review.status.${r.status}"] ?: r.status) + " · " + D.day(r.updatedAt), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    r.ratings.forEach { (cid, v) -> Text((names[cid] ?: "") + ": ⁦" + D.n(v) + " / 5⁩", fontSize = 13.sp, color = Zk.colors.fg) }
                    if (r.strengths.isNotBlank()) Text(w("teamdev.review.strengths") + ": " + r.strengths, fontSize = 13.sp, color = Zk.colors.fg)
                    if (r.improvement.isNotBlank()) Text(w("teamdev.review.improvement") + ": " + r.improvement, fontSize = 13.sp, color = Zk.colors.fg)
                    r.privateNote?.takeIf { it.isNotBlank() }?.let { Text("🔒 " + w("teamdev.review.private") + ": " + it, fontSize = 13.sp, color = Zk.colors.fg, modifier = Modifier.padding(top = 2.dp).clip(RoundedCornerShape(8.dp)).background(Zk.colors.surface2).padding(6.dp)) }
                    if (p.canEnter && (r.mine || r.editable) && r.live) Row {
                        if (r.status == "DRAFT") Act(w("teamdev.review.submit"), !busy) { vm.advance(r, "SUBMITTED") }
                        if (r.status == "SUBMITTED") Act(w("teamdev.review.share"), !busy) { vm.advance(r, "SHARED") }
                    }
                }
                Divider()
            }
        }
        if (writing) ReviewDialog(a, list, criteria.filter { !it.archived }, busy, { writing = false }) { body -> vm.saveReview(body) { writing = false } }
    }
}

@Composable
private fun ReviewDialog(a: PersonAnswer, reviews: List<Review>, criteria: List<Criterion>, busy: Boolean, onClose: () -> Unit, onSave: (ReviewBody) -> Unit) {
    var period by remember { mutableStateOf(a.periods.firstOrNull()?.key.orEmpty()) }
    val mine = reviews.firstOrNull { it.mine && it.live && it.period == period }
    val base = mine?.takeIf { it.status != "SHARED" }
    var ratings by remember(period) { mutableStateOf(base?.ratings ?: emptyMap()) }
    var light by remember(period) { mutableStateOf(base?.light) }
    var strengths by remember(period) { mutableStateOf(base?.strengths.orEmpty()) }
    var improvement by remember(period) { mutableStateOf(base?.improvement.orEmpty()) }
    var private by remember(period) { mutableStateOf(base?.privateNote.orEmpty()) }
    val locked = mine?.status == "SHARED"
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w("teamdev.review.form")) },
        text = {
            Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Choice(w("teamdev.col.period"), D.period(period, a.periods), a.periods.map { it.key to it.label }) { period = it }
                if (locked) Text(w("teamdev.review.locked_note"), fontSize = 12.sp, color = Zk.colors.warn)
                Text(w("teamdev.review.ratings"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                criteria.forEach { c ->
                    Text(c.name, fontSize = 13.5.sp, color = Zk.colors.fg)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { (1..5).forEach { n -> Chip(D.n(n), ratings[c.id] == n) { ratings = D.rate(ratings, c.id, n) } } }
                }
                Text(w("teamdev.review.light"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("GREEN", "AMBER", "RED").forEach { l -> Chip(D.light(l), light == l) { light = if (light == l) null else l } } }
                Text(w("teamdev.review.light_hint"), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                OutlinedTextField(strengths, { strengths = it.take(1000) }, label = { Text(w("teamdev.review.strengths")) }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(improvement, { improvement = it.take(1000) }, label = { Text(w("teamdev.review.improvement")) }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(private, { private = it.take(1000) }, label = { Text(w("teamdev.review.private")) }, modifier = Modifier.fillMaxWidth())
                Text("🔒 " + w("teamdev.review.private_hint"), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && period.isNotEmpty(), onClick = { onSave(ReviewBody(period, ratings, light, strengths, improvement, private, if (locked) true else null)) }) {
                Text(if (locked) w("teamdev.review.new_version") else D.save)
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(D.cancel) } },
    )
}

private fun LazyListScope.planTab(vm: DevPersonViewModel, p: PersonHeader, busy: Boolean) {
    item(key = "plan") {
        val goals by vm.goals.collectAsStateWithLifecycle()
        val skills by vm.catalogue.collectAsStateWithLifecycle()
        var adding by rememberSaveable { mutableStateOf(false) }
        val list = goals ?: run { Loading(); return@item }
        val proposing = p.isSelf && !p.canEnter
        if (p.canEnter || p.isSelf) Act("+ " + w(if (proposing) "teamdev.plan.propose" else "teamdev.plan.add"), !busy) { adding = true }
        if (list.isEmpty()) Line(w("teamdev.plan.empty"))
        list.forEach { g ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Text(g.title + (if (g.proposal) " · " + w("teamdev.plan.proposal") else ""), fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = if (g.status == "OPEN") Zk.colors.fg else Zk.colors.fgMuted)
                Text(listOfNotNull(DevWords.all["teamdev.plan.status.${g.status}"], g.dueDate?.let { w("teamdev.plan.due") + ": " + D.day(it) }, g.createdBy).joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted)
                g.skillName?.let { Text(w("teamdev.plan.skill") + ": " + it + (g.targetLevel?.let { t -> " — " + w("teamdev.plan.target") + ": " + D.level(t) } ?: ""), fontSize = 12.5.sp, color = Zk.colors.fgMuted) }
                if (g.actions.isNotBlank()) Text(g.actions, fontSize = 13.sp, color = Zk.colors.fg)
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    if (p.canEnter && g.proposal && g.status == "OPEN") Act(w("teamdev.plan.accept"), !busy) { vm.patchGoal(g, GoalPatch(accept = true), w("teamdev.plan.accepted")) }
                    if (p.canEnter && !g.proposal && g.status == "OPEN") Act(w("teamdev.plan.mark_done"), !busy) { vm.patchGoal(g, GoalPatch(status = "DONE"), w("teamdev.plan.done")) }
                    if (g.canApply) Act(w("teamdev.plan.apply"), !busy) { vm.applyGoal(g) }
                    if (g.canEdit && g.status == "OPEN") Act(w("teamdev.plan.cancel"), !busy, Zk.colors.fgMuted) { vm.patchGoal(g, GoalPatch(status = "CANCELLED"), w("teamdev.plan.cancelled")) }
                    if (p.canEnter && g.status != "OPEN" && !g.applied) Act(w("teamdev.plan.reopen"), !busy, Zk.colors.fgMuted) { vm.patchGoal(g, GoalPatch(status = "OPEN"), w("teamdev.plan.reopened")) }
                }
                if (g.applied) Text("✓ " + w("teamdev.plan.applied_mark"), fontSize = 12.sp, color = Zk.colors.ok)
            }
            Divider()
        }
        if (adding) GoalDialog(skills.filter { !it.archived }, proposing, busy, { adding = false }) { body -> vm.addGoal(body, proposing) { adding = false } }
    }
}

@Composable
private fun GoalDialog(skills: List<Skill>, proposing: Boolean, busy: Boolean, onClose: () -> Unit, onSave: (GoalBody) -> Unit) {
    var skill by remember { mutableStateOf<String?>(null) }
    var target by remember { mutableStateOf<Int?>(null) }
    var title by remember { mutableStateOf("") }
    var actions by remember { mutableStateOf("") }
    var due by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(w(if (proposing) "teamdev.plan.propose" else "teamdev.plan.add")) },
        text = {
            Column(Modifier.heightIn(max = 540.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Choice(w("teamdev.plan.skill"), skills.firstOrNull { it.id == skill }?.name ?: w("teamdev.plan.no_skill"), listOf("" to w("teamdev.plan.no_skill")) + skills.map { it.id to it.name }) { skill = it.ifEmpty { null }; if (skill == null) target = null }
                if (skill != null) Choice(w("teamdev.plan.target"), target?.let { D.level(it) } ?: w("teamdev.plan.no_target"), listOf("" to w("teamdev.plan.no_target")) + (0..4).map { it.toString() to D.level(it) }) { target = it.toIntOrNull() }
                OutlinedTextField(title, { title = it.take(120) }, label = { Text(w("teamdev.plan.title")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(actions, { actions = it.take(500) }, label = { Text(w("teamdev.plan.actions")) }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(due, { due = it.take(10) }, label = { Text(w("teamdev.plan.due")) }, placeholder = { Text("2026-12-31") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && (title.isNotBlank() || skill != null), onClick = { onSave(GoalBody(skill, title.trim(), target, actions.trim(), due.trim().ifBlank { null })) }) {
                Text(w(if (proposing) "teamdev.plan.send_proposal" else "teamdev.plan.add_button"))
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(D.cancel) } },
    )
}

private fun LazyListScope.notesTab(vm: DevPersonViewModel, p: PersonHeader, busy: Boolean) {
    item(key = "notes") {
        val notes by vm.notes.collectAsStateWithLifecycle()
        var body by rememberSaveable { mutableStateOf("") }
        var shared by rememberSaveable { mutableStateOf(false) }
        val list = notes ?: run { Loading(); return@item }
        Line(w(if (p.isSelf) "teamdev.notes.hint_self" else "teamdev.notes.hint"))
        if (p.canEnter) Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(10.dp)) {
            OutlinedTextField(body, { body = it.take(1000) }, placeholder = { Text(w("teamdev.notes.placeholder")) }, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(shared, { shared = it }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                Text(w("teamdev.notes.share"), fontSize = 13.sp, color = Zk.colors.fg)
            }
            Act(w("teamdev.notes.add"), !busy && body.isNotBlank()) { vm.addNote(body, shared) { body = ""; shared = false } }
        }
        if (list.isEmpty()) Line(w(if (p.isSelf) "teamdev.notes.none_self" else "teamdev.notes.none"))
        list.forEach { n ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                Text(n.author + " · " + D.day(n.createdAt) + " · " + if (n.shared) w("teamdev.notes.is_shared") else "🔒 " + w("teamdev.notes.is_private"), fontSize = 12.sp, color = if (n.shared) Zk.colors.ok else Zk.colors.fgMuted)
                Text(n.body, fontSize = 13.5.sp, color = Zk.colors.fg)
                if (n.canShare) Act(w(if (n.shared) "teamdev.notes.unshare" else "teamdev.notes.share_now"), !busy, Zk.colors.fgMuted) { vm.share(n) }
            }
            Divider()
        }
    }
}

// ── «الهيكل» ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * «الهيكل» (src/components/structure/structure-tree.tsx): who answers to whom. Names, job titles and counts only — nothing about performance.
 * «غيّر المسؤول» only for the people the viewer may change (`canEdit`), choosing among everybody but the person and those below them.
 */
@Composable
fun StructureScreen(onBack: () -> Unit, onOpenPerson: (String) -> Unit, vm: StructureViewModel = hiltViewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var changing by remember { mutableStateOf<StructureNode?>(null) }
    WhileOnScreen(120_000) { vm.refresh() }
    Page(w("teamdev.structure.title"), data != null, failure, notice, vm::consumeNotice, { vm.refresh() }, onBack) {
        val s = data ?: return@Page
        val lines = D.tree(s)
        item(key = "head") {
            Line((DevWords.all["teamdev.structure.subtitle_${s.mode}"] ?: ""))
            Column(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Zk.colors.surface1).padding(12.dp)) {
                Text(w("teamdev.structure.mine"), fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                Text(w("teamdev.structure.my_supervisor") + ": " + (s.me.supervisor?.name ?: w("teamdev.structure.no_supervisor")), fontSize = 13.sp, color = Zk.colors.fg)
                if (s.me.teamMates.isNotEmpty()) Text(w("teamdev.structure.my_team") + ": " + s.me.teamMates.joinToString("، ") { it.name }, fontSize = 13.sp, color = Zk.colors.fgMuted)
            }
            if (s.mode != "own" && s.roots.isNotEmpty()) Title(w("teamdev.tree.top"))
        }
        if (s.mode != "own") {
            var looseShown = false
            lines.forEach { l ->
                if (l.loose && !looseShown) {
                    looseShown = true
                    item(key = "loose") {
                        Title("⚠️ " + w("teamdev.tree.unassigned") + " (" + D.n(s.unassigned.size) + ")")
                        Line("🔧 " + w("teamdev.tree.unassigned_fix"))
                    }
                }
                item(key = "n" + l.node.userId) {
                    val n = l.node
                    Row(Modifier.fillMaxWidth().clickable { onOpenPerson(n.userId) }.padding(start = (16 + 18 * l.depth).dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text((if (l.depth > 0) "└ " else "") + n.name, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                            Text(listOfNotNull(n.jobTitle, if (n.direct > 0) w("teamdev.tree.reports", "n" to D.n(n.total)) else null).joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted)
                        }
                        if (s.canManage && n.canEdit) Act(w("teamdev.lines.change"), !busy) { changing = n }
                    }
                    Divider()
                }
            }
        }
    }
    val s = data ?: return
    changing?.let { n ->
        var pick by remember(n.userId) { mutableStateOf(n.managerId) }
        val options = D.pickable(s, n.userId)
        AlertDialog(
            onDismissRequest = { changing = null },
            containerColor = Zk.colors.surface1,
            title = { Text(w("teamdev.lines.change") + ": " + n.name) },
            text = {
                Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(w("teamdev.lines.supervisor"), fontSize = 12.sp, color = Zk.colors.fgMuted)
                    Chip(w("teamdev.lines.none"), pick == null) { pick = null }
                    options.forEach { o -> Chip(o.name + (o.jobTitle?.let { " · $it" } ?: ""), pick == o.userId) { pick = o.userId } }
                }
            },
            confirmButton = { TextButton(enabled = !busy && pick != n.managerId, onClick = { vm.setLine(n.userId, pick) { changing = null } }) { Text(D.save) } },
            dismissButton = { TextButton(onClick = { changing = null }) { Text(D.cancel) } },
        )
    }
}
