package io.zakiai.workspace.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import io.zakiai.workspace.Config
import io.zakiai.workspace.core.net.Attachment
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.core.net.Reader
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.components.Avatar
import io.zakiai.workspace.ui.components.clock
import io.zakiai.workspace.ui.theme.Zk
import kotlinx.serialization.json.contentOrNull

/** What a bubble can ask of the screen. */
class BubbleActions(
    val onLong: (Message) -> Unit,
    val onReplyTap: (String) -> Unit,
    val onReact: (Message, String) -> Unit,
    val onMedia: (List<Attachment>, Int) -> Unit,
    val onFile: (Attachment) -> Unit,
    val onVote: (Message, List<String>) -> Unit,
    val onTick: (Message, String, Boolean) -> Unit,
    val onRetry: (String) -> Unit,
    val onDiscard: (String) -> Unit,
)

fun absolute(url: String): String = if (url.startsWith("/")) Config.BASE + url else url

/** A system line: the site's sentence in a surface-2 pill, centred, 12sp. */
@Composable
fun SystemLine(m: Message) {
    val p = m.system?.p.orEmpty().mapValues { it.value.contentOrNull.orEmpty() }
    io.zakiai.workspace.ui.components.CenterPill(C.systemLine(m.system?.k, p, m.authorName))
}

/** The day between two messages of different days: a surface-1 pill, 12sp semibold, the quiet colour. */
@Composable
fun DayLine(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fgMuted, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.surface1).padding(horizontal = 12.dp, vertical = 4.dp))
    }
}

/** «رسائل جديدة»: the accent's words in the middle, a thin accent line on both sides (not a band). */
@Composable
fun UnreadLine() {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp, horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.weight(1f).height(1.dp).background(Zk.colors.accent.copy(alpha = 0.3f)))
        Text(C.newMessages, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.accent)
        Box(Modifier.weight(1f).height(1.dp).background(Zk.colors.accent.copy(alpha = 0.3f)))
    }
}

/**
 * ONE BUBBLE, as the site's «شكل تيليجرام» draws it (bubble-model.ts, bubble-parts.tsx): radius 17 everywhere except the LAST bubble of a run,
 * whose bottom corner on its own side is 2 (mine: the bottom end — the left; the others': the bottom start — the right); padding 12/6; at most
 * 85% of the width; 14sp text; the time (and my ticks) on their own line at the end; in a shared chat the sender's name (its category colour)
 * on the FIRST bubble of a run and their 32 picture beside the LAST.
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun Bubble(line: Line, firstOfRun: Boolean, lastOfRun: Boolean, group: Boolean, readers: List<Reader>, act: BubbleActions, playing: String? = null) {
    val m = line.message
    val c = Zk.colors
    val mine = m.mine
    val maxWidth = (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.85f).dp
    val big = 17.dp
    val tail = 2.dp
    val shape = RoundedCornerShape(
        topStart = big,
        topEnd = big,
        // the tail sits on the outer edge: mine hug the start (right, in Arabic), the others the end (left)
        bottomStart = if (mine && lastOfRun) tail else big,
        bottomEnd = if (!mine && lastOfRun) tail else big,
    )
    val fg = if (mine) c.bubbleOutFg else c.bubbleInFg
    val quiet = fg.copy(alpha = 0.62f)
    val showSender = group && !mine
    Column(
        Modifier.fillMaxWidth().padding(top = 2.dp, bottom = if (lastOfRun) 8.dp else 2.dp),
        horizontalAlignment = if (mine) Alignment.Start else Alignment.End,
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            if (showSender) {
                if (lastOfRun) Avatar(m.authorName, url = m.authorAvatar, size = 32.dp) else Spacer(Modifier.width(32.dp))
                Spacer(Modifier.width(6.dp))
            }
            Column(
                Modifier.widthIn(max = maxWidth)
                    .shadow(1.dp, shape, ambientColor = Color.Black.copy(alpha = 0.05f), spotColor = Color.Black.copy(alpha = 0.05f))
                    .clip(shape)
                    .background(if (line.outbox == "refused") c.danger.copy(alpha = 0.10f) else if (mine) c.bubbleOut else c.bubbleIn)
                    .combinedClickable(onClick = {}, onLongClick = { if (line.outbox == null && !m.id.startsWith("outbox-")) act.onLong(m) })
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                if (showSender && firstOfRun && m.authorName.isNotBlank()) {
                    Text(m.authorName, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = io.zakiai.workspace.ui.components.nameColor(m.authorName), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 2.dp))
                }
                m.forwardedFrom?.let { Text("${C.forwardedFrom} ${it.name}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.accent, modifier = Modifier.padding(bottom = 4.dp)) }
                m.replyTo?.let { r ->
                    // the site's reply block: a 3px accent bar at the start, surface-2 at 60%, the end corners rounded 6
                    Row(
                        Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(topEnd = 6.dp, bottomEnd = 6.dp)).background(c.surface2.copy(alpha = 0.6f)).clickable { act.onReplyTap(r.id) },
                    ) {
                        Box(Modifier.width(3.dp).height(40.dp).background(c.accent))
                        Column(Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
                            Text(r.authorName, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.accent, maxLines = 1)
                            Text(if (r.deleted) C.deletedPreview else (r.quote ?: r.preview).orEmpty(), fontSize = 12.sp, color = c.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                when {
                    m.deleted -> Text(T.deletedMessage, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = quiet)
                    else -> {
                        val media = m.media()
                        if (media.isNotEmpty()) Album(media) { i -> act.onMedia(media, i) }
                        for (a in m.files()) FileRow(a, fg, if (mine) fg else c.accent, voice = m.kind == "VOICE", playing = playing == a.id) { act.onFile(a) }
                        m.poll?.let { PollCard(m, it, fg, if (mine) fg else c.accent) { ids -> act.onVote(m, ids) } }
                        m.checklist?.let { ChecklistCard(m, it, fg, if (mine) fg else c.accent) { item, done -> act.onTick(m, item, done) } }
                        val title = m.kind == "POLL" || m.kind == "CHECKLIST"
                        if (!m.body.isNullOrBlank() && !title) {
                            val emojiOnly = m.body.length <= 8 && m.body.none { it.isLetterOrDigit() }
                            Text(m.body, color = fg, fontSize = if (emojiOnly) 36.sp else 14.sp, lineHeight = if (emojiOnly) 44.sp else 22.sp)
                        }
                        m.preview?.let { p ->
                            Row(Modifier.padding(top = 4.dp)) {
                                Box(Modifier.width(3.dp).height(48.dp).background(c.accent))
                                Column(Modifier.padding(start = 8.dp)) {
                                    p.siteName?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.accent) }
                                    p.title?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 2) }
                                    p.description?.let { Text(it, fontSize = 12.sp, color = quiet, maxLines = 3) }
                                }
                            }
                        }
                    }
                }
                if (m.reactions.isNotEmpty() && !m.deleted) {
                    // the chips inside the bubble: the accent at 15%, 28 high, the count 13sp bold; mine ringed by the accent
                    FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (r in m.reactions) {
                            Row(
                                Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(50)).background(c.accent.copy(alpha = 0.15f))
                                    .then(if (r.mine) Modifier.border(1.5.dp, c.accent, RoundedCornerShape(50)) else Modifier)
                                    .clickable { act.onReact(m, r.emoji) }.padding(horizontal = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(r.emoji.takeIf { !it.startsWith(":") } ?: "⭐", fontSize = 16.sp)
                                Text("${r.count}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.accent)
                            }
                        }
                    }
                }
                // the footer on its own line at the end: «معدّلة», the pin, the time, my ticks
                Row(Modifier.align(Alignment.End).padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (m.edited && !m.deleted) Text(C.edited, fontSize = 12.sp, color = quiet)
                    if (m.pinned) Icon(Icons.Filled.PushPin, contentDescription = C.pinned, tint = quiet, modifier = Modifier.size(12.dp))
                    Text(clock(m.createdAt), fontSize = 12.sp, color = quiet)
                    if (mine) when {
                        line.outbox == "waiting" -> Icon(Icons.Filled.Schedule, contentDescription = T.waitingToSend, tint = quiet, modifier = Modifier.size(13.dp))
                        line.outbox == "refused" -> Icon(Icons.Filled.ErrorOutline, contentDescription = T.refusedToSend, tint = c.danger, modifier = Modifier.size(14.dp))
                        m.status == "read" -> Text("✓✓", fontSize = 12.sp, color = c.info, fontWeight = FontWeight.Bold)
                        m.status == "delivered" -> Text("✓✓", fontSize = 12.sp, color = quiet)
                        else -> Text("✓", fontSize = 12.sp, color = quiet)
                    }
                }
                if (line.outbox == "refused") {
                    Row {
                        TextButton(onClick = { act.onRetry(line.id.removePrefix("outbox-")) }) { Text(T.retrySend, color = c.danger) }
                        TextButton(onClick = { act.onDiscard(line.id.removePrefix("outbox-")) }) { Text(T.deleteUnsent, color = fg) }
                    }
                }
            }
        }
        // a topic or a group: the faces of who read up to here, 24 each, under the bubble at its end
        if (readers.isNotEmpty()) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
                for (r in readers.take(5)) Avatar(r.name, url = r.avatarUrl, size = 20.dp)
                if (readers.size > 5) Text(" +${readers.size - 5}", fontSize = 11.sp, color = c.fgMuted)
            }
        }
    }
}

/** The pictures and videos of one message, as one mosaic (up to 10): one big, or a grid of two per row. */
@Composable
private fun Album(media: List<Attachment>, onOpen: (Int) -> Unit) {
    if (media.size == 1) {
        val a = media[0]
        val ratio = if ((a.width ?: 0) > 0 && (a.height ?: 0) > 0) (a.width!!.toFloat() / a.height!!).coerceIn(0.75f, 2f) else 1.3f
        MediaCell(a, Modifier.width(260.dp).aspectRatio(ratio)) { onOpen(0) }
        return
    }
    Column(Modifier.width(260.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        media.chunked(2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                pair.forEachIndexed { i, a -> MediaCell(a, Modifier.weight(1f).aspectRatio(1f)) { onOpen(row * 2 + i) } }
            }
        }
    }
}

@Composable
private fun MediaCell(a: Attachment, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.15f)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        if (a.kind == "IMAGE") AsyncImage(model = absolute(a.url), contentDescription = a.name, contentScale = ContentScale.Crop, modifier = Modifier.heightIn(min = 60.dp).fillMaxWidth())
        else Icon(Icons.Filled.PlayArrow, contentDescription = a.name, tint = Color.White, modifier = Modifier.size(42.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.4f)))
    }
}

/** A file or a voice note: its name and size, a tap opens it (a voice note plays). */
@Composable
private fun FileRow(a: Attachment, fg: Color, mark: Color, voice: Boolean, playing: Boolean, onClick: () -> Unit) {
    Row(Modifier.padding(vertical = 3.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(mark), contentAlignment = Alignment.Center) {
            Icon(if (playing) Icons.Filled.Pause else if (voice || a.kind == "AUDIO") Icons.Filled.PlayArrow else Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null, tint = if (mark == fg) Zk.colors.bubbleOut else Zk.colors.accentFg)
        }
        Spacer(Modifier.width(8.dp))
        Column {
            Text(if (voice) "🎤 " + durationOf(a.durationMs) else a.name.ifBlank { T.attachment }, color = fg, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!voice) Text(sizeOf(a.size), color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        }
    }
}

fun durationOf(ms: Long?): String {
    val s = ((ms ?: 0) / 1000).toInt()
    return "%d:%02d".format(s / 60, s % 60)
}

fun sizeOf(bytes: Long): String = when {
    bytes >= 1_048_576 -> "%.1f م.ب".format(bytes / 1_048_576.0)
    bytes >= 1024 -> "${bytes / 1024} ك.ب"
    else -> "$bytes ب"
}

/** A poll: the question, each option with its bar and its share; a tap votes (one choice, or several when it allows). */
@Composable
private fun PollCard(m: Message, p: io.zakiai.workspace.core.net.Poll, fg: Color, mark: Color, vote: (List<String>) -> Unit) {
    var picked by remember(m.id, p) { mutableStateOf(p.options.filter { it.mine }.map { it.id }.toSet()) }
    Column(Modifier.widthIn(min = 220.dp).padding(vertical = 2.dp)) {
        Text("📊 " + m.body.orEmpty(), color = fg, style = MaterialTheme.typography.titleSmall)
        for (o in p.options) {
            val chosen = o.id in picked
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(enabled = p.canVote) {
                    picked = if (p.multiple) (if (chosen) picked - o.id else picked + o.id) else setOf(o.id)
                    vote(picked.toList())
                }.padding(vertical = 5.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (chosen) (if (p.multiple) Icons.Filled.CheckBox else Icons.Filled.RadioButtonChecked) else (if (p.multiple) Icons.Filled.CheckBoxOutlineBlank else Icons.Filled.RadioButtonUnchecked), contentDescription = null, tint = mark, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(o.text, color = fg, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text("${o.percent}%", color = fg.copy(alpha = 0.8f), style = MaterialTheme.typography.labelMedium)
                }
                LinearProgressIndicator(progress = { o.percent / 100f }, color = mark, trackColor = fg.copy(alpha = 0.12f), modifier = Modifier.fillMaxWidth().padding(top = 3.dp).height(4.dp))
            }
        }
        Text(if (p.closed) C.pollClosed else "${p.voters} ${C.votes}", color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
    }
}

/** A checklist: the title, «3 من 5», each item ticked by whoever may. */
@Composable
private fun ChecklistCard(m: Message, l: io.zakiai.workspace.core.net.Checklist, fg: Color, mark: Color, tick: (String, Boolean) -> Unit) {
    Column(Modifier.widthIn(min = 220.dp).padding(vertical = 2.dp)) {
        Text("☑️ " + m.body.orEmpty(), color = fg, style = MaterialTheme.typography.titleSmall)
        Text("${l.done} ${C.of} ${l.total}", color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        for (i in l.items) {
            Row(Modifier.fillMaxWidth().clickable(enabled = l.canTick) { tick(i.id, !i.done) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (i.done) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, contentDescription = null, tint = mark, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Column {
                    Text(i.text, color = if (i.done) fg.copy(alpha = 0.6f) else fg, style = MaterialTheme.typography.bodyMedium)
                    i.doneByName?.takeIf { i.done }?.let { Text(it, color = fg.copy(alpha = 0.6f), style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }
}
