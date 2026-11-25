package io.zakiai.workspace.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import io.zakiai.workspace.Config
import io.zakiai.workspace.ui.T
import io.zakiai.workspace.ui.theme.Zk

/** The site's avatar colour: one of the six categories, picked from the name (the site sends `hue` for the signed-in person). */
@Composable
fun avatarColor(name: String, hue: Int? = null): Color {
    val c = Zk.colors
    val cats = listOf(c.cat1, c.cat2, c.cat3, c.cat4, c.cat5, c.cat6)
    val i = hue ?: name.fold(0) { acc, ch -> (acc * 31 + ch.code) and 0x7fffffff }
    return cats[Math.floorMod(i, cats.size)]
}

/** A round picture, or the first letter (or the emoji) on the person's colour. */
@Composable
fun Avatar(name: String, url: String? = null, emoji: String? = null, size: Dp = 48.dp, hue: Int? = null) {
    Box(Modifier.size(size).clip(CircleShape).background(avatarColor(name, hue)), contentAlignment = Alignment.Center) {
        val label = emoji?.takeIf { it.isNotBlank() } ?: name.trim().take(1)
        Text(label, color = Zk.colors.scrim, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold)
        if (!url.isNullOrBlank()) {
            AsyncImage(model = if (url.startsWith("/")) Config.BASE + url else url, contentDescription = null, modifier = Modifier.size(size).clip(CircleShape))
        }
    }
}

/** «@username», kept left-to-right inside the right-to-left screen (otherwise it is drawn «username@»). Pure (unit-tested). */
fun handleOf(username: String): String = "⁦@$username⁩"

/** The unread number: the accent, «99+» above 99, nothing at 0. */
@Composable
fun CountBadge(count: Int, muted: Boolean = false) {
    if (count <= 0) return
    Box(
        Modifier.clip(RoundedCornerShape(50)).background(if (muted) Zk.colors.badgeMuted else Zk.colors.accent).padding(horizontal = 7.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = if (muted) Zk.colors.surface1 else Zk.colors.accentFg, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier.fillMaxSize()) {
    Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Zk.colors.accent) }
}

@Composable
fun Empty(text: String, modifier: Modifier = Modifier.fillMaxSize()) {
    Box(modifier.padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
    }
}

/** A failure with what to do about it: the sentence, and «جرّب كمان مرة» when there is something to retry. */
@Composable
fun Failure(message: String, onRetry: (() -> Unit)?, modifier: Modifier = Modifier.fillMaxSize()) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(message, color = Zk.colors.danger, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        if (onRetry != null) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onRetry) { Text(T.retry, color = Zk.colors.accent) }
        }
    }
}

/** The house rule for a risk: the warning (⚠️) and its fix (🔧) shown together, never one without the other. */
@Composable
fun WarnFix(warn: String, fix: String, modifier: Modifier = Modifier.fillMaxWidth()) {
    Column(modifier.background(Zk.colors.warn.copy(alpha = 0.10f)).padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text(warn, color = Zk.colors.warn, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
        Text(fix, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodySmall)
    }
}

/** «بدون اتصال»: a thin bar under the top bar while the phone has no network. */
@Composable
fun OfflineBar(visible: Boolean) {
    AnimatedVisibility(visible) {
        Text(
            T.offlineBar,
            color = Zk.colors.warnFg,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.fillMaxWidth().background(Zk.colors.warn).padding(horizontal = 16.dp, vertical = 6.dp),
        )
    }
}

/** The small accent title above a group of rows. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Zk.colors.accent,
        style = MaterialTheme.typography.titleSmall,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 6.dp),
    )
}
