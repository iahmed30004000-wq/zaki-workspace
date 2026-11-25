package io.zakiai.workspace.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.zakiai.workspace.R

/** IBM Plex Sans Arabic: the body face of every theme (as on the site). */
val Plex = FontFamily(
    Font(R.font.plex_400, FontWeight.Normal),
    Font(R.font.plex_500, FontWeight.Medium),
    Font(R.font.plex_600, FontWeight.SemiBold),
    Font(R.font.plex_700, FontWeight.Bold),
)

/** Reem Kufi: the headings of the themes that use it on the site (night, day, islamic-epic). */
val Kufi = FontFamily(Font(R.font.reem_kufi, FontWeight.Normal), Font(R.font.reem_kufi, FontWeight.Bold))

/** The colours of the current theme, by role: `Zk.colors.accent`, `Zk.colors.surface1`… — never a hex in a screen. */
val LocalZk = staticCompositionLocalOf { themeOf(DEFAULT_THEME_KEY) }

object Zk {
    val colors: ZkColors @Composable get() = LocalZk.current.colors
    val theme: ZkTheme @Composable get() = LocalZk.current
}

private fun schemeOf(t: ZkTheme): ColorScheme {
    val c = t.colors
    return if (t.dark) {
        darkColorScheme(
            primary = c.accent, onPrimary = c.accentFg, secondary = c.accent2, onSecondary = c.scrim,
            background = c.surface, onBackground = c.fg, surface = c.surface1, onSurface = c.fg,
            surfaceVariant = c.surface2, onSurfaceVariant = c.fgMuted, outline = c.border, outlineVariant = c.border,
            error = c.danger, onError = c.dangerFg, surfaceContainer = c.surface1, surfaceContainerHigh = c.surface2,
            surfaceContainerLow = c.surface1, surfaceContainerHighest = c.surface2, scrim = c.scrim,
        )
    } else {
        lightColorScheme(
            primary = c.accent, onPrimary = c.accentFg, secondary = c.accent2, onSecondary = c.onPhoto,
            background = c.surface, onBackground = c.fg, surface = c.surface1, onSurface = c.fg,
            surfaceVariant = c.surface2, onSurfaceVariant = c.fgMuted, outline = c.border, outlineVariant = c.border,
            error = c.danger, onError = c.dangerFg, surfaceContainer = c.surface1, surfaceContainerHigh = c.surface2,
            surfaceContainerLow = c.surface1, surfaceContainerHighest = c.surface2, scrim = c.scrim,
        )
    }
}

private fun typographyOf(t: ZkTheme): Typography {
    val heading = if (t.kufiHeadings) Kufi else Plex
    val base = TextStyle(fontFamily = Plex)
    return Typography(
        headlineLarge = base.copy(fontFamily = heading, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 40.sp),
        headlineMedium = base.copy(fontFamily = heading, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 32.sp),
        headlineSmall = base.copy(fontFamily = heading, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 28.sp),
        titleLarge = base.copy(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 28.sp),
        titleMedium = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 24.sp),
        titleSmall = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
        bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 24.sp),
        bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 21.sp),
        bodySmall = base.copy(fontSize = 12.sp, lineHeight = 18.sp),
        labelLarge = base.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
        labelMedium = base.copy(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
        labelSmall = base.copy(fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp),
    )
}

/** The app's look: the person's theme from the site's palettes, Plex everywhere, and right to left whatever the phone's language. */
@Composable
fun ZakiTheme(themeKey: String, content: @Composable () -> Unit) {
    val t = themeOf(themeKey)
    CompositionLocalProvider(LocalZk provides t, LocalLayoutDirection provides LayoutDirection.Rtl) {
        MaterialTheme(
            colorScheme = schemeOf(t),
            typography = typographyOf(t),
            shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(14.dp), large = RoundedCornerShape(18.dp)),
            content = content,
        )
    }
}
