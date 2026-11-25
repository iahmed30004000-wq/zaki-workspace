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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Inbox
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
import io.zakiai.workspace.core.net.ProjectRow
import io.zakiai.workspace.feature.work.missingDoor
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk

/**
 * «المشاريع» as the site's phone page draws it (src/app/(app)/projects/page.tsx): the title with the space's name, «صندوق المهام» pinned on top
 * (the accent at 10%), then one card per project — the name 15.5sp bold, its status chip, two lines of description, the counts and the date.
 * «مشروع جديد» is the round button at the end.
 */
@Composable
fun ProjectsScreen(onOpenProject: (String) -> Unit, onOpenSite: (String) -> Unit, spaceKey: String? = null, vm: ProjectsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    var creating by remember { mutableStateOf(false) }
    val data = state.data

    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/projects")
            data == null && state.closed -> Empty(io.zakiai.workspace.feature.work.W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 112.dp)) {
                item {
                    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
                        Text(P.projects, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                        data.space?.name?.let { Text(" · $it", fontSize = 14.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
                if (data.space == null && data.projects.isEmpty() && data.inboxes.isEmpty()) {
                    item { QuietEmpty(P.noSpaces, P.noSpacesHint) }
                }
                items(data.inboxes, key = { "inbox-${it.id}" }) { p -> InboxCard(p, many = data.inboxes.size > 1) { onOpenProject(p.id) } }
                if (data.space != null && data.projects.isEmpty()) item { QuietEmpty(P.emptyTitle, P.emptyHint) }
                items(data.projects, key = { it.id }) { p -> ProjectCard(p) { onOpenProject(p.id) } }
            }
        }
        if (data?.canCreate == true && data.space != null) {
            RoundFab(Icons.Filled.Add, P.newProject, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { creating = true }
        }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }

    if (creating) {
        NameDialog(P.newProject, P.projectName, P.create, onDismiss = { creating = false }) { name ->
            creating = false
            vm.create(name) { onOpenProject(it) }
        }
    }
}

/** «صندوق المهام»: the accent at 10%, the inbox in a 40 circle, the hint, «مثبّت» and the count. */
@Composable
private fun InboxCard(p: ProjectRow, many: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.accent.copy(alpha = 0.10f)).clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(Zk.colors.surface1), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Inbox, null, tint = Zk.colors.accent, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(if (p.name == P.instantProject) P.inboxName else p.name, fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
            Text(P.inboxHint + if (many) " · ${p.workspaceName}" else "", fontSize = 13.sp, color = Zk.colors.fgMuted, lineHeight = 18.sp)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            StateChip(P.pinned, Zk.colors.accent)
            Spacer(Modifier.height(4.dp))
            Text(P.tasksLine(p.tasks), fontSize = 13.sp, color = Zk.colors.fgMuted)
        }
    }
}

/** One project: the site's card (radius 16, surface-1, the card shadow, padding 14/12). */
@Composable
private fun ProjectCard(p: ProjectRow, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p.name, fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(8.dp))
            StateChip(P.status(p.status), projectTone(p.status))
        }
        p.description?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, fontSize = 13.sp, lineHeight = 19.sp, color = Zk.colors.fgMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            P.cardLine(p.tasks, p.boards) + (P.dmy(p.targetDate)?.let { " · " + P.dueLine(it) } ?: ""),
            fontSize = 13.sp,
            color = Zk.colors.fgMuted,
        )
    }
}

/** The site's `StateChip`: the tone at 12%, its text in the tone, 13sp semibold, a full pill. */
@Composable
fun StateChip(label: String, tone: Color) {
    Text(
        label,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = tone,
        maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(tone.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/** The site's `QuietEmpty`: a centred title and its hint. */
@Composable
fun QuietEmpty(title: String, hint: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
        Spacer(Modifier.height(6.dp))
        Text(hint, fontSize = 14.sp, color = Zk.colors.fgMuted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** A name to create something with (a project, a board): one field, the site's create word, «إلغاء». */
@Composable
fun NameDialog(title: String, label: String, confirm: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Zk.colors.surface1,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it.take(120) }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(enabled = name.isNotBlank(), onClick = { onSave(name) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(P.cancel) } },
    )
}

/** An older site without the phone's door: ⚠️ marked, 🔧 the site's page meanwhile. */
@Composable
fun OlderSite(onOpenSite: (String) -> Unit, path: String) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        WarnFix(io.zakiai.workspace.feature.work.WorkWarn.oldSite, io.zakiai.workspace.feature.work.WorkWarn.oldSiteFix)
        TextButton(onClick = { onOpenSite(path) }) { Text(io.zakiai.workspace.feature.work.WorkWarn.openSite, color = Zk.colors.accent) }
    }
}
