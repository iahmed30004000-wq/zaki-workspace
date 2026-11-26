package io.zakiai.workspace.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.Goal
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.feature.work.missingDoor
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk
import java.time.LocalDate

/**
 * «الأهداف» (src/components/goals-view.tsx): the period switch (أسبوعي · شهري · ربعي while the OKR switch is on), then one card per goal of the
 * period that holds today — its title, its owner, the progress bar (the accent, the ok once achieved) and the slider for whom may move it,
 * the key results with their own bars.
 */
@Composable
fun GoalsScreen(onBack: () -> Unit, onOpenSite: (String) -> Unit, vm: GoalsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    var period by rememberSaveable { mutableStateOf("WEEKLY") }
    val data = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = P.goals, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                data == null && state.failure == null -> Loading()
                data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/goals")
                data == null && state.closed -> Empty(W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> {
                    // the site's `inPeriod`: today at noon in the phone's zone, against the period's instants (a stored start's UTC date may be the day before)
                    val noon = LocalDate.now().atTime(12, 0).atZone(java.time.ZoneId.systemDefault()).toInstant()
                    val shown = data.goals.filter { g ->
                        val from = runCatching { java.time.Instant.parse(g.periodStart) }.getOrNull()
                        val to = runCatching { java.time.Instant.parse(g.periodEnd) }.getOrNull()
                        g.period == period && from != null && to != null && !noon.isBefore(from) && !noon.isAfter(to)
                    }
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                        item {
                            Text(P.goalsSubtitle, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp))
                            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                val periods = listOf("WEEKLY" to P.weekly, "MONTHLY" to P.monthly) + if (data.okr) listOf("QUARTERLY" to P.quarterly) else emptyList()
                                for ((k, label) in periods) {
                                    val on = k == period
                                    Text(
                                        label,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (on) Zk.colors.accentFg else Zk.colors.fgMuted,
                                        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable { period = k }.padding(horizontal = 16.dp, vertical = 8.dp),
                                    )
                                }
                            }
                        }
                        if (shown.isEmpty()) item { QuietEmpty(P.noGoals, "") }
                        items(shown, key = { it.id }) { g -> GoalCard(g) { vm.setProgress(g.id, it) } }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun GoalCard(g: Goal, onProgress: (Int) -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val pct = g.progress.toFloat().coerceIn(0f, 100f)
    val achieved = pct >= 100f
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(g.title, fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.weight(1f))
            if (achieved) StateChip(P.achieved, Zk.colors.ok)
            g.light?.let { l ->
                Spacer(Modifier.width(6.dp))
                Box(Modifier.size(12.dp).clip(CircleShape).background(when (l) { "ON_TRACK" -> Zk.colors.ok; "BEHIND" -> Zk.colors.warn; else -> Zk.colors.danger }))
            }
        }
        g.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp)) }
        g.ownerName?.let { Text(P.ownerLine(it), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp)) }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(50)).background(Zk.colors.surface2)) {
                Box(Modifier.fillMaxWidth(pct / 100f).height(10.dp).clip(RoundedCornerShape(50)).background(if (achieved) Zk.colors.ok else Zk.colors.accent))
            }
            Spacer(Modifier.width(10.dp))
            Text("${pct.toInt()}%", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
        }
        if (g.fromKeyResults) Text(P.fromResults(g.keyResults.size), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp))
        // the hand slider: only for a goal its person may move, and only while the progress is not computed from the key results
        if (g.canEdit && !g.fromKeyResults) {
            var value by remember(g.id, g.progress) { mutableFloatStateOf(pct) }
            Slider(
                value = value,
                onValueChange = { value = it },
                onValueChangeFinished = { onProgress(value.toInt()) },
                valueRange = 0f..100f,
                colors = SliderDefaults.colors(thumbColor = Zk.colors.accent, activeTrackColor = Zk.colors.accent, inactiveTrackColor = Zk.colors.surface2),
            )
        }
        for (k in g.keyResults) {
            Spacer(Modifier.height(8.dp))
            Text(k.title, fontSize = 13.5.sp, color = Zk.colors.fg)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.surface2)) {
                    Box(Modifier.fillMaxWidth((k.percent / 100.0).toFloat().coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.info))
                }
                Spacer(Modifier.width(8.dp))
                Text("${k.currentValue.fmt()}/${k.targetValue.fmt()}${k.unit?.let { " $it" } ?: ""}", fontSize = 12.sp, color = Zk.colors.fgMuted)
            }
        }
    }
}

private fun Double.fmt(): String = if (this % 1.0 == 0.0) toLong().toString() else "%.1f".format(java.util.Locale.ROOT, this)
