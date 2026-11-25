package io.zakiai.workspace.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Runs [action] now and every [periodMs] while the screen is in front (never in the background: no battery spent on a hidden screen). */
@Composable
fun WhileOnScreen(periodMs: Long, vararg keys: Any?, action: () -> Unit) {
    val owner = LocalLifecycleOwner.current
    val current = rememberUpdatedState(action)
    LaunchedEffect(owner, *keys) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                current.value()
                delay(periodMs)
            }
        }
    }
}

private val CLOCK = DateTimeFormatter.ofPattern("HH:mm")
private val DAY = DateTimeFormatter.ofPattern("d/M")

/** «14:05» today, «24/11» before — in the phone's own time zone, Western digits as the site writes them ("" when unreadable). */
fun shortTime(iso: String?, today: LocalDate = LocalDate.now()): String = try {
    if (iso.isNullOrBlank()) "" else {
        val at = OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault())
        if (at.toLocalDate() == today) at.format(CLOCK) else at.format(DAY)
    }
} catch (e: Exception) {
    ""
}

/** «14:05» (a message's own time). */
fun clock(iso: String?): String = try {
    if (iso.isNullOrBlank()) "" else OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(CLOCK)
} catch (e: Exception) {
    ""
}
