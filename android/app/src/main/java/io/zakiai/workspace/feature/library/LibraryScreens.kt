package io.zakiai.workspace.feature.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.core.net.LibFile
import io.zakiai.workspace.core.net.SheetRow
import io.zakiai.workspace.feature.projects.OlderSite
import io.zakiai.workspace.feature.projects.QuietEmpty
import io.zakiai.workspace.feature.projects.StateChip
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.feature.work.missingDoor
import io.zakiai.workspace.ui.components.Ago
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.PillStrip
import io.zakiai.workspace.ui.components.PillTab
import io.zakiai.workspace.ui.components.RoundFab
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.WhileOnScreen
import io.zakiai.workspace.ui.components.cardShadow
import io.zakiai.workspace.ui.theme.Zk

/**
 * «المكتبة», the site's library place on the phone: its tabs (src/lib/nav/places.ts) — «مكتبة مساحة العمل», «المستندات», «المنتجات» — in the
 * chat's folder strip. A tab the server closes to the person (a partner never has the files; the products are the staff's) answers with its
 * own refusal, shown in place.
 */
@Composable
fun LibraryHub(spaceId: String?, onOpenDoc: (String) -> Unit, onOpenSheet: (String) -> Unit, onOpenSite: (String) -> Unit) {
    var tab by rememberSaveable { mutableStateOf("files") }
    // a tab whose company switch is off is not offered, as on the site (`spaceDocs`, `knowledgeCards`: the server answers `features.off`)
    val docs: DocsViewModel = hiltViewModel()
    val sheets: SheetsViewModel = hiltViewModel()
    val docsState by docs.state.collectAsStateWithLifecycle()
    val sheetsState by sheets.state.collectAsStateWithLifecycle()
    LaunchedEffect(spaceId) { docs.refresh(spaceId); sheets.refresh() }
    val docsOff = docsState.failure?.key == "features.off"
    val sheetsOff = sheetsState.failure?.key == "features.off"
    LaunchedEffect(docsOff, sheetsOff) { if ((tab == "docs" && docsOff) || (tab == "knowledge" && sheetsOff)) tab = "files" }
    Column(Modifier.fillMaxSize()) {
        PillStrip {
            PillTab(L.files, 0, tab == "files") { tab = "files" }
            if (!docsOff) PillTab(L.documents, 0, tab == "docs") { tab = "docs" }
            if (!sheetsOff) PillTab(L.knowledge, 0, tab == "knowledge") { tab = "knowledge" }
        }
        Box(Modifier.weight(1f)) {
            when (tab) {
                "docs" -> DocsTab(spaceId, onOpenDoc, onOpenSite)
                "knowledge" -> SheetsTab(onOpenSheet, onOpenSite)
                else -> FilesTab(spaceId, onOpenSite)
            }
        }
    }
}

// ── «مكتبة مساحة العمل» ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun FilesTab(spaceKey: String?, onOpenSite: (String) -> Unit, vm: FilesViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val uploading by vm.uploading.collectAsStateWithLifecycle()
    val busy by vm.opener.busy.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceKey) { vm.refresh() }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris -> if (uris.isNotEmpty()) vm.upload(uris) }
    var query by rememberSaveable { mutableStateOf("") }
    var asking by remember { mutableStateOf<LibFile?>(null) }
    val data = state.data

    Box(Modifier.fillMaxSize()) {
        when {
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/files")
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
            else -> {
                val shown = if (query.isBlank()) data.files else data.files.filter { it.name.contains(query.trim(), ignoreCase = true) }
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 112.dp)) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 10.dp, bottom = 6.dp)) {
                            Text(data.space?.name?.let { L.ofSpace(it) } ?: L.ofCompany, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                            Text(L.hint, fontSize = 12.sp, color = Zk.colors.fgMuted, lineHeight = 18.sp)
                        }
                    }
                    // ⚠️ the server keeps the files while the Drive is not there; 🔧 what the owner does about it
                    if (data.storage.target == "server") data.storage.reason?.let { L.storageWarn(it) }?.let { (warn, fix) ->
                        item { WarnFix(warn, fix, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) }
                    }
                    if (data.files.isNotEmpty()) item { SearchPill(query, { query = it }, L.search) }
                    if (uploading.isNotEmpty()) item {
                        for (name in uploading) Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Zk.colors.accent)
                            Spacer(Modifier.width(10.dp))
                            Text("${L.uploading} $name", fontSize = 13.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    if (shown.isEmpty()) item { QuietEmpty(if (data.files.isEmpty()) L.empty else L.noMatch, "") }
                    else item {
                        // the site's list (not a grid): one rounded surface, hairlines between the rows
                        val shape = RoundedCornerShape(14.dp)
                        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.surface1)) {
                            shown.forEachIndexed { i, f ->
                                if (i > 0) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
                                FileRow(
                                    f,
                                    busy = busy == "lib-" + f.id,
                                    onOpen = { vm.opener.open(vm.asAttachment(f)) { vm.consumeNotice() } },
                                    onShare = { vm.opener.share(vm.asAttachment(f)) { } },
                                    onDelete = { asking = f },
                                )
                            }
                        }
                    }
                }
            }
        }
        if (data != null) RoundFab(Icons.Filled.UploadFile, L.upload, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { pick.launch("*/*") }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }

    asking?.let { f ->
        AlertDialog(
            onDismissRequest = { asking = null },
            containerColor = Zk.colors.surface1,
            text = { Text(L.deleteAsk) },
            confirmButton = { TextButton(onClick = { asking = null; vm.delete(f.id) }) { Text(L.delete, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { asking = null }) { Text(L.cancel) } },
        )
    }
}

/** The site's type circle: 40, surface-2, the icon by kind in its colour (image ok, video info, audio cat-2, text info, the rest warn). */
@Composable
private fun TypeGlyph(mime: String) {
    val (icon, tint) = glyphOf(mime)
    Box(Modifier.size(40.dp).clip(CircleShape).background(Zk.colors.surface2), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun glyphOf(mime: String): Pair<ImageVector, Color> = when {
    mime.startsWith("image/") -> Icons.Filled.Image to Zk.colors.ok
    mime.startsWith("video/") -> Icons.Filled.VideoFile to Zk.colors.info
    mime.startsWith("audio/") -> Icons.Filled.AudioFile to Zk.colors.cat2
    mime == "application/pdf" || mime.startsWith("text/") -> Icons.Filled.Description to Zk.colors.info
    mime == "application/zip" -> Icons.Filled.FolderZip to Zk.colors.warn
    else -> Icons.AutoMirrored.Filled.InsertDriveFile to Zk.colors.warn
}

@Composable
private fun FileRow(f: LibFile, busy: Boolean, onOpen: () -> Unit, onShare: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp).clickable(onClick = onOpen).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        TypeGlyph(f.mimeType)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(f.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(if (f.versions > 1) L.versionOf(f.version, f.versions) else L.version(f.version), Ago.size(f.size), L.by(f.uploader)).filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 13.sp,
                color = Zk.colors.fgMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Zk.colors.accent)
        Box {
            Box(Modifier.size(40.dp).clip(CircleShape).clickable { menu = true }, contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.MoreVert, null, tint = Zk.colors.fgMuted)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Zk.colors.surface1) {
                DropdownMenuItem(text = { Text(L.download) }, onClick = { menu = false; onOpen() })
                DropdownMenuItem(text = { Text(L.share) }, onClick = { menu = false; onShare() })
                DropdownMenuItem(text = { Text(L.delete, color = Zk.colors.danger) }, onClick = { menu = false; onDelete() })
            }
        }
    }
}

@Composable
private fun SearchPill(value: String, onChange: (String) -> Unit, hint: String) {
    val shape = RoundedCornerShape(50)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.surface2).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Zk.colors.fgMuted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 15.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
            cursorBrush = SolidColor(Zk.colors.accent),
            modifier = Modifier.weight(1f),
            decorationBox = { inner -> Box { if (value.isEmpty()) Text(hint, fontSize = 15.sp, color = Zk.colors.fgMuted); inner() } },
        )
    }
}

// ── «المستندات» ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DocsTab(spaceId: String?, onOpenDoc: (String) -> Unit, onOpenSite: (String) -> Unit, vm: DocsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    WhileOnScreen(60_000, spaceId) { vm.refresh(spaceId) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snack.showSnackbar(it); vm.consumeNotice() } }
    var creating by remember { mutableStateOf(false) }
    val data = state.data
    Box(Modifier.fillMaxSize()) {
        when {
            spaceId == null -> QuietEmpty(L.noSpace, "")
            data == null && state.failure == null -> Loading()
            data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/documents")
            data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh(spaceId) })
            data.documents.isEmpty() -> QuietEmpty(L.docsEmpty, if (data.canCreate) L.docsEmptyHint else "")
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 6.dp, bottom = 112.dp)) {
                item {
                    val shape = RoundedCornerShape(14.dp)
                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(shape).background(Zk.colors.surface1)) {
                        data.documents.forEachIndexed { i, d ->
                            if (i > 0) HorizontalDivider(color = Zk.colors.border.copy(alpha = 0.6f))
                            Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 64.dp).clickable { onOpenDoc(d.id) }.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(40.dp).clip(CircleShape).background(Zk.colors.info.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Filled.Description, null, tint = Zk.colors.info, modifier = Modifier.size(18.dp))
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(d.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                        if (d.sharedWithPartners) {
                                            Spacer(Modifier.width(6.dp))
                                            Row(Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.info.copy(alpha = 0.10f)).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                                Icon(Icons.Filled.Groups, null, tint = Zk.colors.info, modifier = Modifier.size(12.dp))
                                                Spacer(Modifier.width(3.dp))
                                                Text(L.sharedBadge, fontSize = 11.sp, color = Zk.colors.info, maxLines = 1)
                                            }
                                        }
                                    }
                                    if (d.excerpt.isNotBlank()) Text(d.excerpt, fontSize = 12.5.sp, color = Zk.colors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(listOfNotNull(L.updated(Ago.of(d.updatedAt)), d.authorName?.let { L.wroteBy(it) }).joinToString(" · "), fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
        }
        if (data?.canCreate == true) RoundFab(Icons.Filled.Add, L.newDoc, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) { creating = true }
        SnackbarHost(snack, Modifier.align(Alignment.BottomCenter))
    }
    if (creating) io.zakiai.workspace.feature.projects.NameDialog(L.newDoc, L.newDocTitle, L.newDoc, onDismiss = { creating = false }) { creating = false; vm.create(it) { id -> onOpenDoc(id) } }
}

// ── «المنتجات» ──────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SheetsTab(onOpenSheet: (String) -> Unit, onOpenSite: (String) -> Unit, vm: SheetsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    WhileOnScreen(120_000) { vm.refresh() }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }
    val data = state.data
    when {
        data == null && state.failure == null -> Loading()
        data == null && state.failure!!.missingDoor() -> OlderSite(onOpenSite, "/knowledge")
        data == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
        data == null -> Failure(state.failure!!.message, onRetry = { vm.refresh() })
        !data.configured -> QuietEmpty(L.sheetsNoSpace, L.sheetsAskOwner)
        else -> {
            val q = query.trim()
            val shown = data.sheets.filter { s ->
                (q.isEmpty() || s.name.contains(q, true) || (s.category ?: "").contains(q, true)) &&
                    when (filter) { "out" -> stockWord(s.stockStatus) == "out"; "test" -> "test" in s.badges; else -> true }
            }
            Column(Modifier.fillMaxSize()) {
                SearchPill(query, { query = it }, L.sheetsSearch)
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((k, label) in listOf("all" to L.filterAll, "out" to L.filterOut, "test" to L.filterTest)) {
                        val on = k == filter
                        Text(
                            label,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (on) Zk.colors.accentFg else Zk.colors.fgMuted,
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Zk.colors.accent else Zk.colors.surface2).clickable { filter = k }.padding(horizontal = 12.dp, vertical = 5.dp),
                        )
                    }
                }
                if (shown.isEmpty()) QuietEmpty(if (data.sheets.isEmpty()) L.sheetsEmpty else L.sheetsNoMatch, "")
                else LazyVerticalGrid(
                    GridCells.Fixed(2),
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) { items(shown, key = { it.id }) { s -> SheetCard(s) { onOpenSheet(s.id) } } }
            }
        }
    }
}

/** A product card (the site's grid of two): the name 15.5sp bold with its stock chip, the category, the tagline, the price (⚠️ when stale). */
@Composable
private fun SheetCard(s: SheetRow, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1).border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape)
            .clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(s.name, fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
        stockWord(s.stockStatus)?.let { st ->
            val out = st == "out"
            StateChip(if (out) L.outOfStock else L.inStock, if (out) Zk.colors.danger else Zk.colors.ok)
        }
        s.category?.let { Text(it, fontSize = 12.sp, color = Zk.colors.fgMuted, maxLines = 1) }
        if (s.tagline.isNotBlank()) Text(s.tagline, fontSize = 13.sp, color = Zk.colors.fg, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Text(
            s.price?.let { priceOf(it, s.currency) + if (s.stale) " ⚠️" else "" } ?: L.noPriceShort,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (s.stale) Zk.colors.warn else Zk.colors.fg,
        )
        if ("test" in s.badges) StateChip(L.badgeTest, Zk.colors.warn)
        if (s.missing) StateChip(L.missing, Zk.colors.danger)
    }
}

/** The site's currency words (src/lib/cards/copy-text.ts `CURRENCY_WORD`). */
private val CURRENCY_WORD = mapOf("USD" to "$", "JOD" to "دينار", "SYP" to "ليرة", "EUR" to "€", "SAR" to "ريال", "AED" to "درهم", "TRY" to "ليرة تركية")

/** A price as the site writes it (`fmtMoney` + `withCurrency`): 20 → «20», 12.5 → «12.5», the cents never rounded away; «$» and «€» stuck to it. */
fun priceOf(value: Double, currency: String?): String {
    val rounded = Math.round(value * 100) / 100.0
    val n = if (rounded % 1.0 == 0.0) rounded.toLong().toString() else java.math.BigDecimal(rounded.toString()).stripTrailingZeros().toPlainString()
    val word = currency?.let { CURRENCY_WORD[it] ?: it }
    return when {
        word == null || word.isEmpty() -> n
        word == "$" || word == "€" -> "$n$word"
        else -> "$n $word"
    }
}

/** The site's `stockWord`: «out» for out / sold / none / نفد, «in» for in_stock / available / متوفر, else nothing. */
fun stockWord(state: String?): String? = when {
    state.isNullOrEmpty() -> null
    Regex("out|sold|none|نفد", RegexOption.IGNORE_CASE).containsMatchIn(state) -> "out"
    Regex("in_stock|available|متوفر", RegexOption.IGNORE_CASE).containsMatchIn(state) -> "in"
    else -> null
}
