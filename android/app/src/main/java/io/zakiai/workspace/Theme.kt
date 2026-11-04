package io.zakiai.workspace

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The site's default look: deep navy paper, a cyan accent. */
object Zk {
    val Surface = Color(0xFF050F1F)
    val Surface2 = Color(0xFF0B1B33)
    val Surface3 = Color(0xFF12284A)
    val Accent = Color(0xFF35B6CF)
    val OnAccent = Color(0xFF04202A)
    val Text = Color(0xFFFFFFFF)
    val Muted = Color(0xFF9FB1C9)
    val Danger = Color(0xFFE5736A)
    val Mine = Color(0xFF1E6F80)
}

@Composable
fun ZakiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Zk.Accent,
            onPrimary = Zk.OnAccent,
            background = Zk.Surface,
            onBackground = Zk.Text,
            surface = Zk.Surface2,
            onSurface = Zk.Text,
            surfaceVariant = Zk.Surface3,
            onSurfaceVariant = Zk.Muted,
            error = Zk.Danger,
        ),
        content = content,
    )
}
