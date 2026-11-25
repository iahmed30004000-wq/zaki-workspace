package io.zakiai.workspace.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.zakiai.workspace.ui.theme.Zk

/*
 * THE SITE'S «شكل تيليجرام» ON THE PHONE — the pieces every screen shares, measured from the site's own components (src/components/chat/v2,
 * src/components/shell/telegram-tab-bar.tsx; px → dp 1:1). Colours are the theme's tokens only.
 */

/** `shadow-card`: the one soft shadow level of D1 (floating things: the tab bar, the header card, the composer pill, the FAB). */
fun Modifier.cardShadow(shape: Shape, dark: Boolean): Modifier =
    shadow(elevation = 3.dp, shape = shape, ambientColor = Color.Black.copy(alpha = if (dark) 0.5f else 0.08f), spotColor = Color.Black.copy(alpha = if (dark) 0.35f else 0.06f))

/**
 * The bar of a top screen: 56 high on the surface, a hairline under it; the title 18sp semibold (the list's own bar). `start`: ☰ or ←;
 * `actions`: 44-round icon buttons.
 */
@Composable
fun ZkBar(title: String, start: (@Composable () -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Column(Modifier.fillMaxWidth().background(Zk.colors.surface).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (start != null) start() else Spacer(Modifier.size(12.dp))
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Zk.colors.fg, modifier = Modifier.weight(1f).padding(horizontal = 4.dp))
            actions()
        }
        HorizontalDivider(color = Zk.colors.border, thickness = 1.dp)
    }
}

/** A 44-round icon button (the site's bar buttons): hover/press is surface-2. */
@Composable
fun RoundIcon(icon: ImageVector, description: String, tint: Color = Zk.colors.fg, size: Dp = 20.dp, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = description, tint = if (enabled) tint else Zk.colors.fgMuted, modifier = Modifier.size(size)) }
}

/** The folder strip of «شكل تيليجرام»: one pill (surface-1, the card shadow) holding the tabs. */
@Composable
fun PillStrip(content: @Composable RowScope.() -> Unit) {
    val shape = RoundedCornerShape(50)
    Row(
        Modifier.padding(horizontal = 12.dp, vertical = 8.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .horizontalScroll(rememberScrollState()).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** One tab of the strip: 44 high, 14sp; the chosen one is the accent at 15% with the accent's text, semibold; a 20-high count. */
@Composable
fun PillTab(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.defaultMinSize(minHeight = 44.dp).clip(RoundedCornerShape(50)).background(if (selected) Zk.colors.accent.copy(alpha = 0.15f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, fontSize = 14.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, color = if (selected) Zk.colors.accent else Zk.colors.fgMuted, maxLines = 1)
        if (count > 0) CountPill(count, background = if (selected) Zk.colors.accent else Zk.colors.surface2, foreground = if (selected) Zk.colors.accentFg else Zk.colors.fgMuted)
    }
}

/** A count: 20 high, at least 20 wide, 12sp semibold, «99+» past 99. */
@Composable
fun CountPill(count: Int, background: Color = Zk.colors.accent, foreground: Color = Zk.colors.accentFg, cap: Int = 99) {
    Box(Modifier.height(20.dp).widthIn(min = 20.dp).clip(RoundedCornerShape(50)).background(background).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
        Text(if (count > cap) "$cap+" else "$count", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = foreground, maxLines = 1)
    }
}

/** The unread number of a chat row: the accent, or surface-2 with the muted text when the chat is muted (the site's own row). */
@Composable
fun UnreadPill(count: Int, muted: Boolean) {
    if (count <= 0) return
    CountPill(count, background = if (muted) Zk.colors.surface2 else Zk.colors.accent, foreground = if (muted) Zk.colors.fgMuted else Zk.colors.accentFg)
}

/** One tab of the floating bar. */
data class BarTab(val label: String, val icon: ImageVector, val selected: Boolean, val badge: Int, val onClick: () -> Unit)

/**
 * The floating tab bar of «شكل تيليجرام»: a pill (radius 24, surface-1 at 85%, a hairline, the card shadow) above the system bar; each tab 48
 * high, radius 16, the icon 20 over a 12sp label; the chosen tab is the accent at 15%; a press shrinks it a little (150ms).
 */
@Composable
fun FloatingTabBar(tabs: List<BarTab>) {
    val shape = RoundedCornerShape(24.dp)
    Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(start = 12.dp, end = 12.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier.widthIn(max = 448.dp).fillMaxWidth().cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1.copy(alpha = 0.95f))
                .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            for (t in tabs) {
                val source = remember { MutableInteractionSource() }
                val pressed by source.collectIsPressedAsState()
                Column(
                    Modifier.weight(1f).height(48.dp).scale(if (pressed) 0.95f else 1f).clip(RoundedCornerShape(16.dp))
                        .background(if (t.selected) Zk.colors.accent.copy(alpha = 0.15f) else Color.Transparent)
                        .clickable(interactionSource = source, indication = null, onClick = t.onClick).padding(horizontal = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(Modifier.size(width = 40.dp, height = 24.dp), contentAlignment = Alignment.Center) {
                        Icon(t.icon, contentDescription = t.label, tint = if (t.selected) Zk.colors.accent else Zk.colors.fgMuted, modifier = Modifier.size(22.dp))
                        if (t.badge > 0) Box(Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-4).dp)) {
                            CountPill(t.badge, cap = 9)
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(t.label, fontSize = 12.sp, fontWeight = if (t.selected) FontWeight.SemiBold else FontWeight.Normal, color = if (t.selected) Zk.colors.accent else Zk.colors.fgMuted, maxLines = 1)
                }
            }
        }
    }
}

/**
 * The chat's wallpaper: the theme's `chat-wallpaper` with the site's default pattern «boxes» (two isometric boxes in line strokes on a 96 tile,
 * recoloured to `chat-pattern`, src/components/settings-me/appearance.ts) — low contrast by the token's own choice.
 */
fun Modifier.chatWallpaper(base: Color, pattern: Color): Modifier = drawBehind {
    drawRect(base)
    val tile = 96.dp.toPx()
    val u = tile / 96f
    val stroke = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun box(x0: Float, y0: Float, w: Float, h: Float): Path = Path().apply {
        // an isometric box: the top face, then the two sides
        val cx = x0 + w / 2f
        val q = h / 4f
        moveTo(cx, y0); lineTo(x0 + w, y0 + q); lineTo(cx, y0 + 2 * q); lineTo(x0, y0 + q); close()
        moveTo(x0, y0 + q); lineTo(x0, y0 + 3 * q); lineTo(cx, y0 + h); lineTo(x0 + w, y0 + 3 * q); lineTo(x0 + w, y0 + q)
        moveTo(cx, y0 + 2 * q); lineTo(cx, y0 + h)
    }
    val a = box(12 * u, 14 * u, 36 * u, 36 * u)
    val b = box(60 * u, 58 * u, 28 * u, 26 * u)
    var y = 0f
    while (y < size.height) {
        var x = 0f
        while (x < size.width) {
            translate(x, y) { drawPath(a, pattern, style = stroke); drawPath(b, pattern, style = stroke) }
            x += tile
        }
        y += tile
    }
}

/** The conversation's header of «شكل تيليجرام»: a floating card (radius 16, surface-1, a hairline, the card shadow), 56 high, margin 8. */
@Composable
fun GlassHeader(content: @Composable RowScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Box(Modifier.fillMaxWidth().background(Zk.colors.surface).windowInsetsPadding(WindowInsets.statusBars).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)) {
        Row(
            Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
                .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

/** The site's avatar colour: hsl(avatarHue(name), 45%, 30%), avatarHue = (h·31 + code) mod 360 over the name. Pure. */
fun avatarHue(name: String): Float = name.fold(0) { h, ch -> (h * 31 + ch.code) % 360 }.toFloat()

/** The colour of a sender's name in a group: the six categories, by the same hue (`cat-(hue mod 6 + 1)`). */
@Composable
fun nameColor(name: String): Color {
    val c = Zk.colors
    val cats = listOf(c.cat1, c.cat2, c.cat3, c.cat4, c.cat5, c.cat6)
    return cats[(avatarHue(name).toInt()) % 6]
}

/** A fixed-size gap used by rows. */
@Composable
fun Gap(width: Dp) = Spacer(Modifier.size(width = width, height = 1.dp))

/** A quiet note line. */
@Composable
fun Muted(text: String, modifier: Modifier = Modifier) = Text(text, color = Zk.colors.fgMuted, style = MaterialTheme.typography.bodySmall, modifier = modifier)

/** Centres a small surface-2 pill of text (a system line, a day). */
@Composable
fun CenterPill(text: String, background: Color = Zk.colors.surface2, bold: Boolean = false) {
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
        Text(
            text,
            fontSize = 12.sp,
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
            color = Zk.colors.fgMuted,
            modifier = Modifier.widthIn(max = 340.dp).clip(RoundedCornerShape(50)).background(background).padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}

/**
 * A dashboard card (D1: cards are for dashboards and empty states only): radius 16, surface-1, a hairline at 60%, the card shadow, padding 14;
 * its head is the icon in a 30 circle of the accent at 12%, the title 15sp semibold and the count as a quiet pill.
 */
@Composable
fun SoftCard(
    title: String? = null,
    icon: ImageVector? = null,
    count: Int? = null,
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).cardShadow(shape, Zk.theme.dark).clip(shape).background(Zk.colors.surface1)
            .border(1.dp, Zk.colors.border.copy(alpha = 0.6f), shape).padding(14.dp),
    ) {
        if (title != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Box(Modifier.size(30.dp).clip(CircleShape).background(Zk.colors.accent.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                        Icon(icon, null, tint = Zk.colors.accent, modifier = Modifier.size(17.dp))
                    }
                    Spacer(Modifier.size(10.dp))
                }
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Zk.colors.fg, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (count != null && count > 0) CountPill(count, background = Zk.colors.surface2, foreground = Zk.colors.fgMuted, cap = 999)
            }
            Spacer(Modifier.size(8.dp))
        }
        content()
    }
}

/** The 56 round button of the accent (the site's FAB): the card shadow, the icon 24 in the accent's text colour. */
@Composable
fun RoundFab(icon: ImageVector, description: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(56.dp).cardShadow(CircleShape, Zk.theme.dark).clip(CircleShape).background(Zk.colors.accent).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = description, tint = Zk.colors.accentFg, modifier = Modifier.size(24.dp)) }
}

/**
 * The round tick of a task (the site's task row): a 22 ring in the border colour (the danger when late), filled with the accent and a ✓
 * once done; a 40 touch target. Disabled for a task the person may not edit.
 */
@Composable
fun TaskTick(done: Boolean, late: Boolean, enabled: Boolean, description: String, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(CircleShape).clickable(enabled = enabled, onClick = onClick), contentAlignment = Alignment.Center) {
        val ring = when { done -> Zk.colors.accent; late -> Zk.colors.danger; else -> Zk.colors.fgMuted.copy(alpha = if (enabled) 0.7f else 0.35f) }
        Box(
            Modifier.size(22.dp).clip(CircleShape).background(if (done) Zk.colors.accent else Color.Transparent).border(2.dp, ring, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (done) Icon(androidx.compose.material.icons.Icons.Filled.Check, contentDescription = description, tint = Zk.colors.accentFg, modifier = Modifier.size(15.dp))
        }
    }
}

/** [cardShadow] as a plain modifier value (for chains built with `then`). */
fun cardShadowOf(shape: Shape, dark: Boolean): Modifier = Modifier.cardShadow(shape, dark)

@Suppress("unused")
private val ORIGIN = Offset.Zero
