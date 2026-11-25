package io.zakiai.workspace.ui.components

import java.time.Duration
import java.time.Instant

/** The site's relative times and sizes (src/lib/format.ts `fmtAgo`, `fmtSize`), with its Arabic plural forms. Pure (unit-tested). */
object Ago {
    private val FORMS = mapOf(
        "minute" to listOf("قبل دقيقة", "قبل دقيقتين", "قبل {n} دقائق", "قبل {n} دقيقة"),
        "hour" to listOf("قبل ساعة", "قبل ساعتين", "قبل {n} ساعات", "قبل {n} ساعة"),
        "day" to listOf("قبل يوم", "قبل يومين", "قبل {n} أيام", "قبل {n} يومًا"),
        "month" to listOf("قبل شهر", "قبل شهرين", "قبل {n} أشهر", "قبل {n} شهرًا"),
        "year" to listOf("قبل سنة", "قبل سنتين", "قبل {n} سنوات", "قبل {n} سنة"),
    )

    /** one · two · few (3–10) · many (11 and up), as the site's `arabicPlural` */
    private fun form(n: Long): Int = when { n == 1L -> 0; n == 2L -> 1; n in 3..10 -> 2; else -> 3 }

    fun of(iso: String?, now: Instant = Instant.now()): String {
        val at = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        val s = Duration.between(at, now).seconds
        if (s < 45) return "الآن"
        val (unit, n) = when {
            s < 3600 -> "minute" to maxOf(1, s / 60)
            s < 86_400 -> "hour" to s / 3600
            else -> {
                val days = s / 86_400
                when {
                    days < 30 -> "day" to days
                    days < 365 -> "month" to days / 30
                    else -> "year" to days / 365
                }
            }
        }
        return FORMS.getValue(unit)[form(n)].replace("{n}", n.toString())
    }

    fun size(bytes: Long?): String = when {
        bytes == null || bytes < 0 -> ""
        bytes < 1024 -> "$bytes بايت"
        bytes < 1024 * 1024 -> "${Math.round(bytes / 1024.0)} كيلوبايت"
        else -> "%.1f ميغابايت".format(java.util.Locale.ROOT, bytes / 1024.0 / 1024.0)
    }
}
