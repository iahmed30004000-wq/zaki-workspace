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

/** A system line: the site's sentence, centred, small. */
@Composable
fun SystemLine(m: Message) {
    val p = m.system?.p.orEmpty().mapValues { it.value.contentOrNull.orEmpty() }
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
        Text(
            C.systemLine(m.system?.k, p, m.authorName),
            color = Zk.colors.fgMuted,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.surface1.copy(alpha = 0.8f)).padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}

/** The day between two messages of different days: «اليوم», «مبارح», or the date. */
@Composable
fun DayLine(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, color = Zk.colors.fg, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clip(RoundedCornerShape(50)).background(Zk.colors.surface1.copy(alpha = 0.85f)).padding(horizontal = 12.dp, vertical = 4.dp))
    }
}

/** «رسائل جديدة»: where the unread part of the conversation begins. */
@Composable
fun UnreadLine() {
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp).background(Zk.colors.surface1.copy(alpha = 0.7f)).padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text(C.newMessages, color = Zk.colors.accent, style = MaterialTheme.typography.labelLarge)
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun Bubble(line: Line, showAuthor: Boolean, readers: List<Reader>, act: BubbleActions, playing: String? = null) {
    val m = line.message
    val c = Zk.colors
    val mine = m.mine
    // right to left: my bubbles sit at the start (the right), the others' at the end — as on the site
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), horizontalAlignment = if (mine) Alignment.Start else Alignment.End) {
        Row(verticalAlignment = Alignment.Bottom) {
            if (!mine && showAuthor) {
                Avatar(m.authorName, url = m.authorAvatar, size = 30.dp)
                Spacer(Modifier.width(6.dp))
            } else if (!mine) Spacer(Modifier.width(36.dp))
            val fg = if (mine) c.bubbleOutFg else c.bubbleInFg
            Column(
                Modifier.widthIn(max = 300.dp)
                    .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = if (mine) 4.dp else 16.dp, bottomEnd = if (mine) 16.dp else 4.dp))
                    .background(if (mine) c.bubbleOut else c.bubbleIn)
                    .combinedClickable(onClick = {}, onLongClick = { if (line.outbox == null && !m.id.startsWith("outbox-")) act.onLong(m) })
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                if (showAuthor && !mine && m.authorName.isNotBlank()) Text(m.authorName, color = c.accent, style = MaterialTheme.typography.labelLarge)
                m.forwardedFrom?.let { Text("${C.forwardedFrom} ${it.name}", color = fg.copy(alpha = 0.75f), style = MaterialTheme.typography.labelMedium, fontStyle = FontStyle.Italic) }
                m.replyTo?.let { r ->
                    Row(
                        Modifier.padding(vertical = 3.dp).clip(RoundedCornerShape(6.dp)).background(fg.copy(alpha = 0.08f)).clickable { act.onReplyTap(r.id) }.padding(end = 8.dp),
                    ) {
                        // on my own bubble (the accent's colour) the quote takes the bubble's text colour, or it would not be seen
                        val mark = if (mine) fg else c.accent
                        Box(Modifier.width(3.dp).height(36.dp).background(mark))
                        Column(Modifier.padding(start = 6.dp, top = 2.dp, bottom = 2.dp)) {
                            Text(r.authorName, color = mark, style = MaterialTheme.typography.labelMedium, maxLines = 1)
                            Text(if (r.deleted) C.deletedPreview else (r.quote ?: r.preview).orEmpty(), color = fg.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                when {
                    m.deleted -> Text(T.deletedMessage, color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.bodyMedium, fontStyle = FontStyle.Italic)
                    else -> {
                        val media = m.media()
                        if (media.isNotEmpty()) Album(media) { i -> act.onMedia(media, i) }
                        for (a in m.files()) FileRow(a, fg, if (mine) fg else c.accent, voice = m.kind == "VOICE", playing = playing == a.id) { act.onFile(a) }
                        m.poll?.let { PollCard(m, it, fg, if (mine) fg else c.accent) { ids -> act.onVote(m, ids) } }
                        m.checklist?.let { ChecklistCard(m, it, fg, if (mine) fg else c.accent) { item, done -> act.onTick(m, item, done) } }
                        if (!m.body.isNullOrBlank()) {
                            val title = m.kind == "POLL" || m.kind == "CHECKLIST"
                            if (!title) Text(m.body, color = fg, style = MaterialTheme.typography.bodyLarge)
                        }
                        m.preview?.let { p ->
                            Column(Modifier.padding(top = 4.dp).clip(RoundedCornerShape(6.dp)).background(fg.copy(alpha = 0.07f)).padding(6.dp)) {
                                p.siteName?.let { Text(it, color = c.accent, style = MaterialTheme.typography.labelMedium) }
                                p.title?.let { Text(it, color = fg, style = MaterialTheme.typography.titleSmall, maxLines = 2) }
                                p.description?.let { Text(it, color = fg.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, maxLines = 3) }
                            }
                        }
                    }
                }
                Row(Modifier.align(Alignment.End).padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (m.pinned) Icon(Icons.Filled.PushPin, contentDescription = C.pinned, tint = fg.copy(alpha = 0.6f), modifier = Modifier.size(11.dp))
                    if (m.edited && !m.deleted) Text(C.edited + " ", color = fg.copy(alpha = 0.6f), style = MaterialTheme.typography.labelSmall)
                    Text(clock(m.createdAt), color = fg.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
                    if (mine) {
                        Spacer(Modifier.width(3.dp))
                        when {
                            line.outbox == "waiting" -> Icon(Icons.Filled.Schedule, contentDescription = T.waitingToSend, tint = fg.copy(alpha = 0.7f), modifier = Modifier.size(13.dp))
                            line.outbox == "refused" -> Icon(Icons.Filled.ErrorOutline, contentDescription = T.refusedToSend, tint = c.danger, modifier = Modifier.size(13.dp))
                            m.status == "read" -> Icon(Icons.Filled.DoneAll, contentDescription = null, tint = c.accent2, modifier = Modifier.size(14.dp))
                            m.status == "delivered" -> Icon(Icons.Filled.DoneAll, contentDescription = null, tint = fg.copy(alpha = 0.7f), modifier = Modifier.size(14.dp))
                            m.status == "sent" || m.status == null -> Icon(Icons.Filled.Done, contentDescription = null, tint = fg.copy(alpha = 0.7f), modifier = Modifier.size(14.dp))
                        }
                    }
                }
                if (line.outbox == "refused") {
                    Row {
                        TextButton(onClick = { act.onRetry(line.id.removePrefix("outbox-")) }) { Text(T.retrySend, color = fg) }
                        TextButton(onClick = { act.onDiscard(line.id.removePrefix("outbox-")) }) { Text(T.deleteUnsent, color = fg) }
                    }
                }
            }
        }
        if (m.reactions.isNotEmpty() && !m.deleted) {
            FlowRow(Modifier.padding(top = 2.dp, start = if (mine) 0.dp else 36.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (r in m.reactions) {
                    Row(
                        Modifier.clip(RoundedCornerShape(50))
                            .background(if (r.mine) c.accent.copy(alpha = 0.25f) else c.surface1)
                            .border(1.dp, if (r.mine) c.accent else c.border, RoundedCornerShape(50))
                            .clickable { act.onReact(m, r.emoji) }
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(r.emoji.takeIf { !it.startsWith(":") } ?: "⭐", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.width(4.dp))
                        Text("${r.count}", style = MaterialTheme.typography.labelMedium, color = c.fg)
                    }
                }
            }
        }
        // a topic or a group: the faces of who read up to here
        if (readers.isNotEmpty()) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy((-6).dp)) {
                for (r in readers.take(5)) Avatar(r.name, url = r.avatarUrl, size = 16.dp)
                if (readers.size > 5) Text(" +${readers.size - 5}", style = MaterialTheme.typography.labelSmall, color = c.fgMuted)
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
