package io.zakiai.workspace.feature.cards

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.filled.TaskAlt
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.feature.chat.absolute
import io.zakiai.workspace.feature.desk.OpenerViewModel
import io.zakiai.workspace.feature.desk.SiteLine
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

// ── the look of a card ───────────────────────────────────────────────────────────────────────────────────────

/** A card's colour is a theme token, never a hex: every theme restyles every card (shared.ts). */
@Composable
internal fun tone(c: String): Color? = when (c) {
    "accent" -> Zk.colors.accent
    "ok" -> Zk.colors.ok
    "warn" -> Zk.colors.warn
    "danger" -> Zk.colors.danger
    "info" -> Zk.colors.info
    "cat-1" -> Zk.colors.cat1
    "cat-2" -> Zk.colors.cat2
    "cat-3" -> Zk.colors.cat3
    "cat-4" -> Zk.colors.cat4
    "cat-5" -> Zk.colors.cat5
    "cat-6" -> Zk.colors.cat6
    else -> null
}

internal fun kindIcon(k: String): ImageVector = when (k) {
    "PROMPT" -> Icons.Filled.AutoAwesome
    "LIST" -> Icons.Filled.Checklist
    "LINK" -> Icons.Filled.Link
    "FILE" -> Icons.Filled.AttachFile
    "TABLE" -> Icons.Filled.TableChart
    else -> Icons.Filled.Description
}

@Composable
private fun StatusPill(s: String) {
    val (bg, fg) = when (s) {
        "REVIEW" -> Zk.colors.warn.copy(alpha = 0.16f) to Zk.colors.warn
        "APPROVED" -> Zk.colors.ok.copy(alpha = 0.16f) to Zk.colors.ok
        else -> Zk.colors.surface2 to Zk.colors.fgMuted
    }
    Text(K.status(s), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = fg, modifier = Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        color = if (on) Zk.colors.accentFg else Zk.colors.fg,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun SectionTitle(text: String, hint: String? = null) {
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 6.dp)) {
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Zk.colors.accent)
        hint?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted) }
    }
}

// ── «اللوحات»: the list ───────────────────────────────────────────────────────────────────────────────────────

/**
 * «اللوحات» of the space the person is in (src/components/cards/cards-view.tsx): search, the kinds, the categories, «المثبّتة فقط», the
 * site's four orders, pinned first in every one; «لوحة جديدة» for who may write; the owner's «المحذوفات». A list with thin dividers (D1),
 * each row its colour, its kind, its title and one line of what it holds.
 */
@Composable
fun CardsScreen(
    spaceId: String?,
    onBack: (() -> Unit)?,
    onOpenCard: (String) -> Unit,
    onOpenSite: (String) -> Unit,
    vm: CardsViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var archive by rememberSaveable { mutableStateOf(false) }
    var q by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var pinnedOnly by rememberSaveable { mutableStateOf(false) }
    var sort by rememberSaveable { mutableStateOf("manual") }
    var sortOpen by remember { mutableStateOf(false) }
    var creating by rememberSaveable { mutableStateOf(false) }
    if (spaceId != null) WhileOnScreen(60_000, spaceId, archive) { vm.refresh(spaceId, archive) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val data = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface)) {
        // a tab of the bar (a space of cards) has the shell's own bar above it: this one only when it was opened from somewhere
        if (onBack != null) ZkBar(title = K.title, start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        Box(Modifier.weight(1f)) {
            when {
                spaceId == null -> Empty(K.noSpace)
                data == null && state.failure == null -> Loading()
                data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(spaceId, archive) })
                else -> {
                    val shown = K.visible(data.cards, q, kind, category, pinnedOnly, sort)
                    val categories = K.categoriesOf(data.cards)
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 120.dp)) {
                        item(key = "head") {
                            OutlinedTextField(q, { q = it.take(100) }, placeholder = { Text(K.search) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp))
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Pill(K.all, kind == null) { kind = null }
                                K.KINDS.filter { k -> data.cards.any { it.kind == k } }.forEach { k -> Pill(K.kind(k), kind == k) { kind = if (kind == k) null else k } }
                                Pill(K.pinnedOnly, pinnedOnly) { pinnedOnly = !pinnedOnly }
                                // the owner alone reads «المحذوفات» (the server decides again)
                                if (data.owner) Pill(K.archiveTitle, archive) { archive = !archive }
                                Box {
                                    Pill(K.sort(sort), sort != "manual") { sortOpen = true }
                                    DropdownMenu(sortOpen, { sortOpen = false }) {
                                        K.SORTS.forEach { s -> DropdownMenuItem(text = { Text(K.sort(s)) }, onClick = { sort = s; sortOpen = false }) }
                                    }
                                }
                            }
                            if (categories.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Pill(K.all, category == null) { category = null }
                                categories.forEach { c -> Pill(c, category == c) { category = if (category == c) null else c } }
                                if (data.cards.any { it.category == null }) Pill(K.noCategory, category == "") { category = if (category == "") null else "" }
                            }
                            if (!data.canWrite && !archive) Text(K.readOnly, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                        }
                        when {
                            data.cards.isEmpty() -> item(key = "empty") { QuietEmpty(if (archive) K.archiveEmpty else K.empty, if (archive) "" else K.emptyHint) }
                            shown.isEmpty() -> item(key = "none") { QuietEmpty(K.noResults, "") }
                        }
                        items(shown, key = { it.id }) { c ->
                            CardRow(c, archive, busy, onOpen = { onOpenCard(c.id) }, onRestore = { vm.restore(c) })
                        }
                        if (data.canWrite && !archive && data.cards.size > 1) item(key = "order") {
                            SiteLine(K.orderWarn, K.orderFix) { onOpenSite("/cards") }
                        }
                    }
                }
            }
            if (data?.canWrite == true && !archive) RoundFab(Icons.Filled.Add, K.new, Modifier.align(Alignment.BottomEnd).padding(18.dp)) { creating = true }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (creating) CardEditor(
        start = CardDraft(),
        isNew = true,
        busy = busy,
        onFileKind = { creating = false; onOpenSite("/cards") },
        onCancel = { creating = false },
        onSave = { d -> vm.create(d) { id -> creating = false; onOpenCard(id) } },
    )
}

@Composable
private fun CardRow(c: CardItem, archived: Boolean, busy: Boolean, onOpen: () -> Unit, onRestore: () -> Unit) {
    val stripe = tone(c.color)
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).height(48.dp).background(stripe ?: Color.Transparent))
        Box(Modifier.padding(start = 10.dp).size(38.dp).clip(CircleShape).background((stripe ?: Zk.colors.accent).copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(kindIcon(c.kind), contentDescription = K.kind(c.kind), tint = stripe ?: Zk.colors.accent, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (c.pinned) Icon(Icons.Filled.PushPin, K.pinned, tint = Zk.colors.accent, modifier = Modifier.size(14.dp).padding(end = 2.dp))
                Text(c.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (c.status != "DRAFT") { Spacer(Modifier.width(6.dp)); StatusPill(c.status) }
            }
            val line = listOfNotNull(K.preview(c).takeIf { it.isNotBlank() }, c.category).joinToString(" · ")
            if (line.isNotBlank()) Text(line, fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (c.tags.isNotEmpty()) Text(c.tags.joinToString("  ") { "#$it" }, fontSize = 11.5.sp, color = Zk.colors.info, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (archived) TextButton(enabled = !busy, onClick = onRestore) { Text(K.restore, color = Zk.colors.accent) }
    }
    HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f), modifier = Modifier.padding(start = 62.dp))
}

// ── the editor ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The card editor (card-editor.tsx): the kind (a new card), the title, the words, the list, the link (https only), the table (with the
 * site's ⚠️ that it holds no stock and no money), the colour, the category, the tags, the pin. A FILE card needs a library file: ⚠️ the site.
 */
@Composable
private fun CardEditor(start: CardDraft, isNew: Boolean, busy: Boolean, onFileKind: () -> Unit, onCancel: () -> Unit, onSave: (CardDraft) -> Unit) {
    var d by remember { mutableStateOf(start) }
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxSize().background(Zk.colors.surface).imePadding()) {
            ZkBar(
                title = if (isNew) K.new else K.edit,
                start = { RoundIcon(Icons.Filled.Close, K.cancel, onClick = onCancel) },
                actions = { TextButton(enabled = !busy, onClick = { onSave(d) }) { Text(K.save, color = Zk.colors.accent, fontWeight = FontWeight.Bold) } },
            )
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (isNew) {
                    Text(K.fKind, fontSize = 13.sp, color = Zk.colors.fgMuted)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        K.KINDS.forEach { k -> Pill(K.kind(k), d.kind == k) { d = d.copy(kind = k) } }
                    }
                }
                if (d.kind == "FILE") {
                    WarnFix(K.fileWarn, K.fileFix)
                    TextButton(onClick = onFileKind) { Text(io.zakiai.workspace.feature.desk.D.openSite, color = Zk.colors.accent, fontWeight = FontWeight.SemiBold) }
                    return@Column
                }
                OutlinedTextField(d.title, { d = d.copy(title = it.take(K.MAX_TITLE)) }, label = { Text(K.fTitle) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    d.body,
                    { d = d.copy(body = it.take(20_000)) },
                    label = { Text(when (d.kind) { "PROMPT" -> K.fPrompt; "NOTE" -> K.fNote; else -> K.fNoteOptional }) },
                    minLines = if (d.kind == "NOTE" || d.kind == "PROMPT") 4 else 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                when (d.kind) {
                    "LINK" -> {
                        OutlinedTextField(d.url, { d = d.copy(url = it.take(2000)) }, label = { Text(K.fUrl) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        Text(K.fUrlHint, fontSize = 12.sp, color = if (d.url.isBlank() || K.isSafeHttps(d.url)) Zk.colors.fgMuted else Zk.colors.danger)
                    }
                    "LIST" -> {
                        Text(K.fItems, fontSize = 13.sp, color = Zk.colors.fgMuted)
                        d.items.forEachIndexed { i, (text, done) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(done, { on -> d = d.copy(items = d.items.mapIndexed { j, it -> if (j == i) it.first to on else it }) }, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                                OutlinedTextField(text, { v -> d = d.copy(items = d.items.mapIndexed { j, it -> if (j == i) v.take(300) to it.second else it }) }, singleLine = true, modifier = Modifier.weight(1f))
                                RoundIcon(Icons.Filled.Close, K.fItemRemove) { d = d.copy(items = d.items.filterIndexed { j, _ -> j != i }) }
                            }
                        }
                        if (d.items.size < 200) TextButton(onClick = { d = d.copy(items = d.items + ("" to false)) }) { Text("+ " + K.fItemAdd, color = Zk.colors.accent) }
                    }
                    "TABLE" -> TableEditor(d) { d = it }
                }
                Text(K.fColor, fontSize = 13.sp, color = Zk.colors.fgMuted)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    K.COLORS.forEach { c ->
                        val col = tone(c)
                        Box(
                            Modifier.size(34.dp).clip(CircleShape).background(col ?: Zk.colors.surface2)
                                .border(if (d.color == c) 3.dp else 1.dp, if (d.color == c) Zk.colors.fg else Zk.colors.border, CircleShape)
                                .clickable { d = d.copy(color = c) },
                            contentAlignment = Alignment.Center,
                        ) { if (col == null) Icon(Icons.Filled.Close, K.color(c), tint = Zk.colors.fgMuted, modifier = Modifier.size(16.dp)) }
                    }
                }
                Text(K.color(d.color), fontSize = 12.sp, color = Zk.colors.fgMuted)
                OutlinedTextField(d.category, { d = d.copy(category = it.take(40)) }, label = { Text(K.fCategory) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(d.tags, { d = d.copy(tags = it.take(400)) }, label = { Text(K.fTags) }, supportingText = { Text(K.fTagsHint) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(K.fPinned, fontSize = 14.sp, color = Zk.colors.fg, modifier = Modifier.weight(1f))
                    Switch(d.pinned, { d = d.copy(pinned = it) }, colors = SwitchDefaults.colors(checkedTrackColor = Zk.colors.accent))
                }
                Spacer(Modifier.height(40.dp))
            }
        }
    }
}

@Composable
private fun TableEditor(d: CardDraft, change: (CardDraft) -> Unit) {
    Text(K.fTable, fontSize = 13.sp, color = Zk.colors.fgMuted)
    WarnFix(K.tableNotice.substringBefore(" 🔧"), "🔧" + K.tableNotice.substringAfter("🔧"))
    Column(Modifier.horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            d.columns.forEachIndexed { i, col ->
                Column(Modifier.width(140.dp)) {
                    HeadCell(col) { v -> change(d.copy(columns = d.columns.mapIndexed { j, c -> if (j == i) v.take(300) else c })) }
                    if (d.columns.size > 1) TextButton(onClick = {
                        change(d.copy(columns = d.columns.filterIndexed { j, _ -> j != i }, rows = d.rows.map { r -> r.filterIndexed { j, _ -> j != i } }))
                    }) { Text(K.fColumnRemove, fontSize = 11.sp, color = Zk.colors.danger) }
                }
            }
            if (d.columns.size < 8) TextButton(onClick = { change(d.copy(columns = d.columns + "", rows = d.rows.map { it + "" })) }) { Text("+ " + K.fColumnAdd, color = Zk.colors.accent) }
        }
        d.rows.forEachIndexed { r, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                d.columns.indices.forEach { i ->
                    OutlinedTextField(row.getOrElse(i) { "" }, { v ->
                        change(d.copy(rows = d.rows.mapIndexed { rr, cells -> if (rr == r) List(d.columns.size) { j -> if (j == i) v.take(300) else cells.getOrElse(j) { "" } } else cells }))
                    }, singleLine = true, modifier = Modifier.width(140.dp))
                }
                RoundIcon(Icons.Filled.Close, K.fRowRemove) { change(d.copy(rows = d.rows.filterIndexed { rr, _ -> rr != r })) }
            }
        }
    }
    if (d.rows.size < 100) TextButton(onClick = { change(d.copy(rows = d.rows + listOf(List(d.columns.size) { "" }))) }) { Text("+ " + K.fRowAdd, color = Zk.colors.accent) }
}

/** A heading cell of the table: the field in bold. */
@Composable
private fun HeadCell(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value, onValueChange, singleLine = true,
        textStyle = androidx.compose.ui.text.TextStyle(fontWeight = FontWeight.Bold, color = Zk.colors.fg),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── one card's page ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The page inside a card (src/components/cards/card-page.tsx): its words, its list (ticked in place), its link, its table, its file; the
 * approval status for a moderator; the stars; the team's notes and the person's private ones; the gallery; the versions; the log; where it
 * went. Every action goes through the site's own route, which decides again who may.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CardScreen(
    onBack: () -> Unit,
    onOpenCard: (String) -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenChat: (String, String?) -> Unit,
    onOpenSite: (String) -> Unit,
    meId: String?,
    vm: CardViewModel = hiltViewModel(),
    files: OpenerViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val notes by vm.notes.collectAsStateWithLifecycle()
    val log by vm.log.collectAsStateWithLifecycle()
    val links by vm.links.collectAsStateWithLifecycle()
    val revisions by vm.revisions.collectAsStateWithLifecycle()
    val conflict by vm.conflict.collectAsStateWithLifecycle()
    val gone by vm.gone.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("notes") }
    var menu by remember { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    var sending by rememberSaveable { mutableStateOf(false) }
    var tasking by rememberSaveable { mutableStateOf(false) }
    WhileOnScreen(60_000) { if (!editing) vm.refresh() }
    LaunchedEffect(gone) { if (gone) onBack() }
    LaunchedEffect(tab) { if (tab == "log") vm.loadLog(); if (tab == "versions") vm.loadRevisions() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val clip = LocalClipboardManager.current
    val uri = LocalUriHandler.current
    val data = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(
            title = data?.spaceName?.ifBlank { null } ?: K.title,
            start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) },
            actions = {
                val a = data?.abilities
                if (a?.write == true) {
                    RoundIcon(Icons.Filled.Edit, K.edit) { editing = true }
                    Box {
                        RoundIcon(Icons.Filled.MoreVert, K.edit) { menu = true }
                        DropdownMenu(menu, { menu = false }) {
                            val c = data.card
                            DropdownMenuItem(text = { Text(if (c.pinned) K.unpin else K.pin) }, leadingIcon = { Icon(Icons.Filled.PushPin, null) }, onClick = { menu = false; vm.pin(c) })
                            DropdownMenuItem(text = { Text(K.duplicate) }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) }, onClick = { menu = false; vm.duplicate(onOpenCard) })
                            DropdownMenuItem(text = { Text(K.send) }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Send, null) }, onClick = { menu = false; sending = true; vm.loadTopics(data.spaceId) })
                            DropdownMenuItem(text = { Text(K.toTask) }, leadingIcon = { Icon(Icons.Filled.TaskAlt, null) }, onClick = { menu = false; tasking = true; vm.loadProjects(data.spaceId) })
                            DropdownMenuItem(text = { Text(K.delete, color = Zk.colors.danger) }, leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Zk.colors.danger) }, onClick = { menu = false; deleting = true })
                        }
                    }
                } else if (a?.restore == true) RoundIcon(Icons.Filled.Restore, K.restore, enabled = !busy) { vm.restore() }
            },
        )
        Box(Modifier.weight(1f)) {
            when {
                data == null && state.failure == null -> Loading()
                data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
                data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
                else -> {
                    val c = data.card
                    val a = data.abilities
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 100.dp)) {
                        item(key = "head") {
                            val stripe = tone(c.color)
                            Column(Modifier.fillMaxWidth().background((stripe ?: Zk.colors.surface1).copy(alpha = if (stripe != null) 0.10f else 1f)).padding(16.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(kindIcon(c.kind), null, tint = stripe ?: Zk.colors.accent, modifier = Modifier.size(18.dp))
                                    Text(" " + K.kind(c.kind), fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                                    Spacer(Modifier.weight(1f))
                                    if (c.pinned) Icon(Icons.Filled.PushPin, K.pinned, tint = Zk.colors.accent, modifier = Modifier.size(16.dp).padding(end = 4.dp))
                                    StatusPill(c.status)
                                }
                                Spacer(Modifier.height(6.dp))
                                SelectionContainer { Text(c.title, fontSize = 21.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg) }
                                if (c.category != null || c.tags.isNotEmpty()) Text(
                                    listOfNotNull(c.category, c.tags.takeIf { it.isNotEmpty() }?.joinToString("  ") { "#$it" }).joinToString(" · "),
                                    fontSize = 12.5.sp, color = Zk.colors.info, modifier = Modifier.padding(top = 4.dp),
                                )
                                Text(
                                    listOf(K.createdBy(c.createdByName), K.stamp(c.updatedAt), K.version(c.version)).filter { it.isNotBlank() }.joinToString(" · "),
                                    fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                            if (c.archivedAt != null) Text(K.deletedBanner, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.danger, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                            if (a.oversight) Text(K.oversight, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                            else if (!a.write && c.archivedAt == null) Text(K.pageReadOnly, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                            c.coverFileId?.let { cover ->
                                AsyncImage(model = absolute("/api/files/$cover/raw"), contentDescription = K.coverOn, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).padding(12.dp).clip(RoundedCornerShape(12.dp)))
                            }
                        }
                        item(key = "content") { CardContent(c, a.write, onToggle = { i -> vm.toggleItem(c, i) }, onCopy = { clip.setText(AnnotatedString(it)); vm.say(K.copied) }, onLink = { runCatching { uri.openUri(it) } }, onFile = {
                            val f = c.file ?: return@CardContent
                            files.opener.open(Attachment(id = "card-" + (c.fileId ?: ""), name = f.name, mime = f.mimeType, size = f.size, url = "/api/files/" + c.fileId + "/raw")) { msg -> vm.say(msg) }
                        }) }
                        if (a.moderate && a.statusMoves.isNotEmpty()) item(key = "status") {
                            SectionTitle(K.status, K.statusHint)
                            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                a.statusMoves.forEach { s -> Pill(K.statusTo(s), false) { if (!busy) vm.status(s) } }
                            }
                        }
                        data.rating?.let { r -> item(key = "stars") { Stars(r, a.participate, busy) { vm.rate(it) } } }
                        if (a.internal && c.archivedAt == null) item(key = "approvals") { SiteLine(K.approvalsWarn, K.approvalsFix) { onOpenSite("/cards/" + c.id) } }
                        val shown = if (!a.internal) "gallery" else tab
                        item(key = "tabs") {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (a.internal) Pill(K.tabNotes, tab == "notes") { tab = "notes" }
                                Pill(K.tabGallery, shown == "gallery") { tab = "gallery" }
                                if (a.internal) { Pill(K.tabVersions, tab == "versions") { tab = "versions" }; Pill(K.tabLog, tab == "log") { tab = "log" } }
                            }
                        }
                        when (shown) {
                            "notes" -> {
                                item(key = "notes") { NotesPart(notes, a.participate, meId, busy, vm) }
                                item(key = "links") { LinksPart(links, onOpenTask, onOpenChat) }
                            }
                            "gallery" -> item(key = "gallery") {
                                if (data.gallery.isEmpty()) Text(K.galleryEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    data.gallery.forEach { g ->
                                        Column(Modifier.width(150.dp).clickable {
                                            files.opener.open(Attachment(id = "card-g-" + g.id, kind = if (g.file.mimeType.startsWith("image/")) "IMAGE" else "FILE", name = g.file.name, mime = g.file.mimeType, size = g.file.size, url = "/api/files/" + g.fileId + "/raw")) { msg -> vm.say(msg) }
                                        }) {
                                            if (g.file.mimeType.startsWith("image/")) AsyncImage(model = absolute("/api/files/${g.fileId}/raw"), contentDescription = g.caption ?: g.file.name, contentScale = ContentScale.Crop, modifier = Modifier.size(150.dp).clip(RoundedCornerShape(10.dp)))
                                            else Box(Modifier.size(150.dp).clip(RoundedCornerShape(10.dp)).background(Zk.colors.surface2), contentAlignment = Alignment.Center) { Icon(Icons.Filled.AttachFile, null, tint = Zk.colors.fgMuted) }
                                            Text(g.caption ?: g.file.name, fontSize = 12.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            if (g.isCover) Text(K.coverOn, fontSize = 11.sp, color = Zk.colors.accent)
                                        }
                                    }
                                }
                                if (a.gallery) SiteLine(K.galleryWarn, K.galleryFix) { onOpenSite("/cards/" + c.id) }
                            }
                            "versions" -> item(key = "versions") {
                                val v = revisions
                                when {
                                    v == null -> Loading(Modifier.fillMaxWidth().height(80.dp))
                                    v.revisions.isEmpty() -> Text(K.versionsEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                                    else -> Column {
                                        Text(K.versionCurrent(v.currentVersion) + (if (a.write) " · " + K.restoreHint else ""), fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
                                        v.revisions.forEach { r ->
                                            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                                                Text(K.version(r.version) + " · " + K.stamp(r.createdAt), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                                                Text(K.versionBy(r.editorName), fontSize = 12.sp, color = Zk.colors.fgMuted)
                                                Text(r.title, fontSize = 13.sp, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                r.body?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                                                if (a.write) TextButton(enabled = !busy, onClick = { vm.restoreRevision(r.version, c.version) }) { Text(K.versionRestore, color = Zk.colors.accent) }
                                            }
                                            HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f))
                                        }
                                        SiteLine(K.diffWarn, K.diffFix) { onOpenSite("/cards/" + c.id) }
                                    }
                                }
                            }
                            "log" -> item(key = "log") {
                                val l = log
                                when {
                                    l == null -> Loading(Modifier.fillMaxWidth().height(80.dp))
                                    l.isEmpty() -> Text(K.logEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(16.dp))
                                    else -> Column {
                                        l.forEach { e ->
                                            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                                                Text(K.logLine(e), fontSize = 13.5.sp, color = Zk.colors.fg)
                                                Text(K.stamp(e.at), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                                            }
                                            HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.4f))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
        }
    }

    val d = data
    if (editing && d != null) CardEditor(
        start = CardDraft.of(d.card),
        isNew = false,
        busy = busy,
        onFileKind = { editing = false; onOpenSite("/cards/" + d.card.id) },
        onCancel = { editing = false },
        onSave = { draft -> vm.save(draft, d.card.version) { editing = false } },
    )
    if (conflict != null) {
        AlertDialog(
            onDismissRequest = {},
            containerColor = Zk.colors.surface1,
            title = { Text(K.conflictTitle) },
            text = { Text(K.conflictHint, fontSize = 14.sp, color = Zk.colors.fg) },
            confirmButton = { TextButton(enabled = !busy, onClick = { vm.keepMine { editing = false } }) { Text(K.conflictKeep) } },
            dismissButton = { TextButton(onClick = { vm.takeTheirs { editing = false } }) { Text(K.conflictTakeTheirs) } },
        )
    }
    if (deleting) AlertDialog(
        onDismissRequest = { deleting = false },
        containerColor = Zk.colors.surface1,
        text = { Text(K.confirmDelete, fontSize = 14.sp, color = Zk.colors.fg) },
        confirmButton = { TextButton(enabled = !busy, onClick = { deleting = false; vm.archive() }) { Text(K.delete, color = Zk.colors.danger) } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text(K.cancel) } },
    )
    if (sending) SendDialog(vm, busy, onClose = { sending = false })
    if (tasking) TaskDialog(vm, busy, onClose = { tasking = false }, onOpenTask = onOpenTask)
}

@Composable
private fun CardContent(c: CardItem, write: Boolean, onToggle: (Int) -> Unit, onCopy: (String) -> Unit, onLink: (String) -> Unit, onFile: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        c.body?.takeIf { it.isNotBlank() }?.let { body ->
            Box(Modifier.fillMaxWidth().then(if (c.kind == "PROMPT") Modifier.clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).padding(12.dp) else Modifier)) {
                SelectionContainer { Text(body, fontSize = 15.sp, color = Zk.colors.fg, lineHeight = 24.sp) }
            }
            if (c.kind == "PROMPT") TextButton(onClick = { onCopy(body) }) {
                Icon(Icons.Filled.ContentCopy, null, tint = Zk.colors.accent, modifier = Modifier.size(16.dp)); Text(" " + K.copy, color = Zk.colors.accent)
            }
        }
        when (c.kind) {
            "LIST" -> {
                val items = K.listItems(c.data)
                if (items.isEmpty()) Text(K.listEmpty, fontSize = 13.sp, color = Zk.colors.fgMuted)
                else Text(K.listProgress(items.count { it.second }, items.size), fontSize = 12.sp, color = Zk.colors.fgMuted)
                items.forEachIndexed { i, (text, done) ->
                    Row(Modifier.fillMaxWidth().then(if (write) Modifier.clickable { onToggle(i) } else Modifier), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(done, if (write) ({ onToggle(i) }) else null, colors = CheckboxDefaults.colors(checkedColor = Zk.colors.accent))
                        Text(text, fontSize = 14.5.sp, color = if (done) Zk.colors.fgMuted else Zk.colors.fg, textDecoration = if (done) TextDecoration.LineThrough else null)
                    }
                }
            }
            "LINK" -> {
                val url = K.linkUrl(c.data)
                if (url == null) Text(K.linkInvalid, fontSize = 13.sp, color = Zk.colors.danger)
                else Text(url, fontSize = 14.sp, color = Zk.colors.accent, textDecoration = TextDecoration.Underline, modifier = Modifier.clickable { onLink(url) })
            }
            "TABLE" -> {
                val (cols, rows) = K.table(c.data)
                Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).border(1.dp, Zk.colors.border, RoundedCornerShape(8.dp))) {
                    Row(Modifier.background(Zk.colors.surface2)) { cols.forEach { Text(it, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, modifier = Modifier.widthIn(min = 110.dp, max = 220.dp).padding(8.dp)) } }
                    rows.forEach { r ->
                        HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.5f))
                        Row { r.forEach { Text(it, fontSize = 13.sp, color = Zk.colors.fg, modifier = Modifier.widthIn(min = 110.dp, max = 220.dp).padding(8.dp)) } }
                    }
                }
                Text(K.tableNotice, fontSize = 11.5.sp, color = Zk.colors.fgMuted)
            }
            "FILE" -> {
                val f = c.file
                if (f == null) Text(K.fileGone, fontSize = 13.sp, color = Zk.colors.fgMuted)
                else Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Zk.colors.surface1).clickable(onClick = onFile).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AttachFile, null, tint = Zk.colors.accent)
                    Text(" " + f.name, fontSize = 14.sp, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(K.open, fontSize = 13.sp, color = Zk.colors.accent)
                }
            }
        }
    }
}

@Composable
private fun Stars(r: RatingView, participate: Boolean, busy: Boolean, onRate: (Int) -> Unit) {
    SectionTitle(K.stars)
    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(r.average?.let { K.starsAvg(it) + " · " + K.starsCount(r.count) } ?: K.starsNone, fontSize = 13.sp, color = Zk.colors.fgMuted)
        if (participate) Row(verticalAlignment = Alignment.CenterVertically) {
            Text(K.starsMine + "  ", fontSize = 13.sp, color = Zk.colors.fg)
            (1..5).forEach { n ->
                RoundIcon(if ((r.mine ?: 0) >= n) Icons.Filled.Star else Icons.Filled.StarBorder, K.starsN(n), tint = Zk.colors.accent2, size = 26.dp, enabled = !busy) { onRate(n) }
            }
        }
        r.raters?.takeIf { it.isNotEmpty() }?.let { list ->
            Text(K.raters, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.padding(top = 6.dp))
            Text(K.ratersHint, fontSize = 11.5.sp, color = Zk.colors.fgMuted)
            list.forEach { Text(it.name + " · " + K.starsN(it.stars), fontSize = 13.sp, color = Zk.colors.fg) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NotesPart(view: NotesView?, participate: Boolean, meId: String?, busy: Boolean, vm: CardViewModel) {
    if (view == null) { Loading(Modifier.fillMaxWidth().height(80.dp)); return }
    var editing by remember { mutableStateOf<NoteItem?>(null) }
    @Composable
    fun Thread(title: String, hint: String, list: List<NoteItem>, empty: String, private: Boolean) {
        SectionTitle(title, hint)
        if (list.isEmpty()) Text(empty, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
        list.forEach { n ->
            var open by remember { mutableStateOf(false) }
            val mine = n.authorId == meId
            Box {
                Column(Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { if (mine && participate) open = true }).padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(n.authorName + " · " + K.stamp(n.createdAt) + (if (n.editedAt != null) " · " + K.noteEdited else ""), fontSize = 11.5.sp, color = Zk.colors.fgMuted)
                    SelectionContainer { Text(n.body, fontSize = 14.sp, color = Zk.colors.fg) }
                }
                DropdownMenu(open, { open = false }) {
                    DropdownMenuItem(text = { Text(K.noteEdit) }, onClick = { open = false; editing = n })
                    DropdownMenuItem(text = { Text(K.noteDelete, color = Zk.colors.danger) }, onClick = { open = false; vm.deleteNote(n.id) })
                }
            }
            HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.35f), modifier = Modifier.padding(horizontal = 16.dp))
        }
        if (participate) {
            var text by rememberSaveable(private) { mutableStateOf("") }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(text, { text = it.take(K.MAX_NOTE) }, placeholder = { Text(K.notePlaceholder) }, maxLines = 4, modifier = Modifier.weight(1f))
                RoundIcon(Icons.AutoMirrored.Filled.Send, if (private) K.notePrivateAdd else K.noteAdd, tint = Zk.colors.accent, enabled = text.isNotBlank() && !busy) {
                    vm.addNote(text, private) { text = "" }
                }
            }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        view.publicNotes?.let { Thread(K.notesPublic, K.notesPublicHint, it, K.notesEmpty, false) }
        Thread(K.notesPrivate, K.notesPrivateHint, view.privateNotes, K.notesPrivateEmpty, true)
    }
    editing?.let { n ->
        var text by remember(n.id) { mutableStateOf(n.body) }
        AlertDialog(
            onDismissRequest = { editing = null },
            containerColor = Zk.colors.surface1,
            title = { Text(K.noteEdit) },
            text = { OutlinedTextField(text, { text = it.take(K.MAX_NOTE) }, minLines = 3, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(enabled = text.isNotBlank() && !busy, onClick = { vm.editNote(n.id, text) { editing = null } }) { Text(K.save) } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(K.cancel) } },
        )
    }
}

@Composable
private fun LinksPart(links: LinksView?, onOpenTask: (String) -> Unit, onOpenChat: (String, String?) -> Unit) {
    val l = links ?: return
    SectionTitle(K.links)
    if (l.tasks.isEmpty() && l.topics.isEmpty()) { Text(K.linksNone, fontSize = 13.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp)); return }
    if (l.tasks.isNotEmpty()) Text(K.linksTasks, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
    l.tasks.forEach { t -> Text("${t.key} ${t.title}", fontSize = 14.sp, color = Zk.colors.accent, modifier = Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(horizontal = 16.dp, vertical = 8.dp)) }
    if (l.topics.isNotEmpty()) Text(K.linksTopics, fontSize = 12.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(horizontal = 16.dp))
    l.topics.forEach { t ->
        Text(listOfNotNull(t.emoji, t.title).joinToString(" ") + "  ·  " + K.linkMessage, fontSize = 14.sp, color = Zk.colors.accent, modifier = Modifier.fillMaxWidth().clickable { onOpenChat(t.conversationId, t.messageId) }.padding(horizontal = 16.dp, vertical = 8.dp))
    }
}

@Composable
private fun SendDialog(vm: CardViewModel, busy: Boolean, onClose: () -> Unit) {
    val topics by vm.topics.collectAsStateWithLifecycle()
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(K.sendTitle) },
        text = {
            Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                Text(K.sendHint, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                val t = topics
                when {
                    t == null -> Loading(Modifier.fillMaxWidth().height(60.dp))
                    t.isEmpty() -> Text(K.sendNone, fontSize = 13.sp, color = Zk.colors.fg, modifier = Modifier.padding(top = 8.dp))
                    else -> t.forEach { topic ->
                        Text(listOfNotNull(topic.emoji, topic.title).joinToString(" "), fontSize = 15.sp, color = Zk.colors.fg, modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { vm.send(topic.id, onClose) }.padding(vertical = 12.dp))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onClose) { Text(K.cancel) } },
    )
}

@Composable
private fun TaskDialog(vm: CardViewModel, busy: Boolean, onClose: () -> Unit, onOpenTask: (String) -> Unit) {
    val projects by vm.projects.collectAsStateWithLifecycle()
    val boards by vm.boards.collectAsStateWithLifecycle()
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var board by rememberSaveable { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Zk.colors.surface1,
        title = { Text(K.toTask) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val p = projects
                when {
                    p == null -> Loading(Modifier.fillMaxWidth().height(60.dp))
                    p.isEmpty() -> Text(K.taskNoProject, fontSize = 13.sp, color = Zk.colors.fg)
                    else -> {
                        Text(K.taskProject, fontSize = 12.5.sp, color = Zk.colors.fgMuted)
                        p.forEach { row -> Pill(row.name, project == row.id) { project = row.id; board = null; vm.loadBoards(row.id) } }
                        if (project != null) {
                            Text(K.taskBoard, fontSize = 12.5.sp, color = Zk.colors.fgMuted, modifier = Modifier.padding(top = 6.dp))
                            val b = boards
                            if (b == null) Loading(Modifier.fillMaxWidth().height(40.dp))
                            else b.forEach { row -> Pill(row.name, board == row.id) { board = row.id } }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = project != null && board != null && !busy, onClick = {
                vm.toTask(project!!, board!!) { id -> onClose(); onOpenTask(id) }
            }) { Text(K.toTask) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(K.cancel) } },
    )
}
