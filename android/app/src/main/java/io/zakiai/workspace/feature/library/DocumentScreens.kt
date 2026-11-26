package io.zakiai.workspace.feature.library

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.zakiai.workspace.feature.projects.StateChip
import io.zakiai.workspace.feature.work.W
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Ago
import io.zakiai.workspace.ui.components.Empty
import io.zakiai.workspace.ui.components.Failure
import io.zakiai.workspace.ui.components.Loading
import io.zakiai.workspace.ui.components.RoundIcon
import io.zakiai.workspace.ui.components.SoftCard
import io.zakiai.workspace.ui.components.WarnFix
import io.zakiai.workspace.ui.components.ZkBar
import io.zakiai.workspace.ui.theme.Zk

/**
 * ONE DOCUMENT, as the site's document page: for whom may write, «كتابة» / «عرض» (on a phone one or the other, as the site does), the title
 * and the text written with the site's markup and saved by itself; for whom may only read, the text drawn. The save line says where it
 * stands; another person's newer save is ⚠️ with the two ways out (🔧 «خلّي نسختي» / «خذ نسختهم»).
 */
@Composable
fun DocumentScreen(onBack: () -> Unit, vm: DocumentViewModel = hiltViewModel()) {
    LaunchedEffect(vm.id) { vm.loadOnce() }
    val state by vm.state.collectAsStateWithLifecycle()
    val title = vm.title
    val content = vm.content
    val save by vm.save.collectAsStateWithLifecycle()
    var writing by rememberSaveable { mutableStateOf(false) }
    var askTake by remember { mutableStateOf(false) }
    val doc = state.data
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding().imePadding()) {
        ZkBar(
            title = L.documents,
            start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) },
        ) {
            if (doc?.canWrite == true) {
                Text(
                    if (writing) L.modeRead else L.modeWrite,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Zk.colors.accent,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.accent.copy(alpha = 0.12f)).clickable { writing = !writing }.padding(horizontal = 14.dp, vertical = 7.dp),
                )
                Spacer(Modifier.width(8.dp))
            }
        }
        when {
            doc == null && state.failure == null -> Loading()
            doc == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            doc == null -> Failure(state.failure!!.message, onRetry = { vm.load() })
            else -> {
                val shownTitle = title ?: doc.title
                val shownContent = content ?: doc.content
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp)) {
                    // where the save stands
                    val line = when {
                        !doc.canWrite -> L.readOnly
                        save == DocumentViewModel.Save.Saving -> L.saving
                        save == DocumentViewModel.Save.Saved -> L.saved
                        save == DocumentViewModel.Save.Unsaved -> L.unsaved
                        save == DocumentViewModel.Save.Error -> L.saveError
                        else -> null
                    }
                    line?.let { Text(it, fontSize = 12.sp, color = if (save == DocumentViewModel.Save.Error) Zk.colors.danger else Zk.colors.fgMuted) }
                    if (save == DocumentViewModel.Save.Conflict) {
                        WarnFix("⚠️ " + L.conflict, "🔧 " + L.keepMine + " · " + L.takeTheirs)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { vm.keepMine() }) { Text(L.keepMine, color = Zk.colors.accent) }
                            TextButton(onClick = { askTake = true }) { Text(L.takeTheirs, color = Zk.colors.fg) }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    if (writing && doc.canWrite) {
                        Field(shownTitle, { vm.type(title = it) }, L.titleHint, TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex), single = true)
                        Spacer(Modifier.height(10.dp))
                        Field(shownContent, { vm.type(content = it) }, L.bodyHint, TextStyle(fontSize = 16.sp, lineHeight = 28.sp, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex), single = false)
                    } else {
                        Text(shownTitle, fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold, color = Zk.colors.fg)
                        Text(
                            listOfNotNull(doc.authorName?.let { L.wroteBy(it) }, L.updated(Ago.of(doc.updatedAt))).joinToString(" · "),
                            fontSize = 12.sp,
                            color = Zk.colors.fgMuted,
                        )
                        if (doc.sharedWithPartners) { Spacer(Modifier.height(6.dp)); StateChip(L.sharedBadge, Zk.colors.info) }
                        Spacer(Modifier.height(12.dp))
                        DocBody(shownContent, doc.people.map { it.name })
                    }
                    Spacer(Modifier.height(32.dp))
                }
            }
        }
    }
    // the site asks before the person's words leave the screen (docs.conflict.take_confirm)
    if (askTake) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { askTake = false },
            containerColor = Zk.colors.surface1,
            text = { Text(L.takeConfirm) },
            confirmButton = { TextButton(onClick = { askTake = false; vm.takeTheirs() }) { Text(L.takeTheirs, color = Zk.colors.danger) } },
            dismissButton = { TextButton(onClick = { askTake = false }) { Text(L.cancel) } },
        )
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, hint: String, style: TextStyle, single: Boolean) {
    val shape = RoundedCornerShape(12.dp)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = single,
        textStyle = style,
        cursorBrush = SolidColor(Zk.colors.accent),
        modifier = Modifier.fillMaxWidth().then(if (single) Modifier else Modifier.heightIn(min = 320.dp)).clip(shape).background(Zk.colors.surface1).padding(12.dp),
        decorationBox = { inner -> Box { if (value.isEmpty()) Text(hint, style = style.copy(color = Zk.colors.fgMuted)); inner() } },
    )
}

/** The text drawn as the site's `DocBody`: headings 22/18/16sp, paragraphs 16sp, bullets and numbers, bold, links in the accent, @names. */
@Composable
fun DocBody(content: String, names: List<String>) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (b in DocMarkup.parse(content, names)) {
            when (b) {
                is DocMarkup.Block.Heading -> InlineText(b.inline, when (b.level) { 1 -> 22; 2 -> 18; else -> 16 }, FontWeight.Bold, context)
                is DocMarkup.Block.Para -> InlineText(b.inline, 16, FontWeight.Normal, context)
                is DocMarkup.Block.Bullets -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (item in b.items) Row { Text("•  ", fontSize = 16.sp, color = Zk.colors.fgMuted); InlineText(item, 16, FontWeight.Normal, context) }
                }
                is DocMarkup.Block.Numbered -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    b.items.forEachIndexed { i, item -> Row { Text("${i + 1}.  ", fontSize = 16.sp, color = Zk.colors.fgMuted); InlineText(item, 16, FontWeight.Normal, context) } }
                }
            }
        }
    }
}

@Composable
private fun InlineText(nodes: List<DocMarkup.Inline>, size: Int, weight: FontWeight, context: Context) {
    val accent = Zk.colors.accent
    val text: AnnotatedString = buildAnnotatedString {
        fun add(list: List<DocMarkup.Inline>) {
            for (n in list) when (n) {
                is DocMarkup.Inline.Text -> append(n.text)
                is DocMarkup.Inline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { add(n.children) }
                is DocMarkup.Inline.Mention -> withStyle(SpanStyle(color = accent, fontWeight = FontWeight.SemiBold)) { append(n.text) }
                is DocMarkup.Inline.Link -> {
                    pushStringAnnotation("url", n.href)
                    withStyle(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)) { append(n.text) }
                    pop()
                }
            }
        }
        add(nodes)
    }
    ClickableText(
        text,
        style = TextStyle(fontSize = size.sp, lineHeight = (size * 1.7).sp, fontWeight = weight, color = Zk.colors.fg, fontFamily = io.zakiai.workspace.ui.theme.Plex),
    ) { at ->
        text.getStringAnnotations("url", at, at).firstOrNull()?.let { a ->
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.item)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/**
 * ONE PRODUCT SHEET (the site's sheet page, read-only on the phone): the category and stock chips, the tagline, the price (⚠️ when it is
 * stale), each section in its card with «انسخي», then «أسئلة الزباين» each answer with «انسخي».
 */
@Composable
fun SheetScreen(onBack: () -> Unit, vm: SheetViewModel = hiltViewModel()) {
    LaunchedEffect(vm.id) { vm.load() }
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var copied by remember { mutableStateOf<String?>(null) }
    fun copy(key: String, text: String) {
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("", text))
        copied = key
    }
    val s = state.data?.sheet
    Column(Modifier.fillMaxSize().background(Zk.colors.surface).navigationBarsPadding()) {
        ZkBar(title = s?.name.orEmpty(), start = { RoundIcon(Icons.AutoMirrored.Filled.ArrowBack, T.back, onClick = onBack) })
        when {
            s == null && state.failure == null -> Loading()
            s == null && state.closed -> Empty(state.failure?.message ?: W.sectionOff)
            s == null -> Failure(state.failure!!.message, onRetry = { vm.load() })
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    s.category?.let { StateChip(it, Zk.colors.fgMuted) }
                    stockWord(s.external?.stockStatus)?.let { st -> StateChip(if (st == "out") L.outOfStock else L.inStock, if (st == "out") Zk.colors.danger else Zk.colors.ok) }
                    if ("test" in s.data?.badges.orEmpty()) StateChip(L.badgeTest, Zk.colors.warn)
                    if ("new" in s.data?.badges.orEmpty()) StateChip(L.badgeNew, Zk.colors.accent)
                }
                s.data?.tagline?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 16.sp, lineHeight = 26.sp, color = Zk.colors.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
                s.data?.testNote?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = Zk.colors.warn, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                if (s.external?.missingSince != null) Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { StateChip(L.missing, Zk.colors.danger) }
                if (s.external?.price == null) WarnFix("⚠️ " + L.noPrice, "🔧 " + L.noPriceFix, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp))
                s.external?.price?.let { p ->
                    Text(
                        priceOf(p, s.external.currency) + if (s.external.stale) "  ${L.priceStale}" else "",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (s.external.stale) Zk.colors.warn else Zk.colors.fg,
                        modifier = Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(50)).background(Zk.colors.surface2).padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
                for (sec in s.data?.sections.orEmpty()) {
                    val body = sec.text ?: sec.items.joinToString("\n") { "• $it" }
                    SoftCard(sec.title) {
                        Text(body, fontSize = 15.sp, lineHeight = 24.sp, color = Zk.colors.fg)
                        CopyChip(copied == "s:" + sec.key) { copy("s:" + sec.key, sec.title + "\n" + body) }
                    }
                }
                val faq = s.data?.faq.orEmpty()
                if (faq.isNotEmpty()) SoftCard(L.faq, count = faq.size) {
                    faq.forEachIndexed { i, f ->
                        if (i > 0) Spacer(Modifier.height(10.dp))
                        Text(f.q, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg)
                        Text(f.a, fontSize = 14.5.sp, lineHeight = 23.sp, color = Zk.colors.fg)
                        CopyChip(copied == "f:$i") { copy("f:$i", f.a) }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun CopyChip(done: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.padding(top = 6.dp).clip(RoundedCornerShape(50)).background(Zk.colors.accent.copy(alpha = 0.12f)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.material3.Icon(Icons.Filled.ContentCopy, null, tint = Zk.colors.accent, modifier = androidx.compose.ui.Modifier.height(14.dp).width(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(if (done) L.copied else L.copy, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent)
    }
}
