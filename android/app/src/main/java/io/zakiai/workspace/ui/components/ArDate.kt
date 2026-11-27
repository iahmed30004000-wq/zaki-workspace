package io.zakiai.workspace.ui.components

import java.time.LocalDate

/**
 * The site's dates (src/lib/format.ts): the Gregorian months under the names used in Jordan, Syria, Lebanon and Palestine, Western digits.
 * ONE list for the whole app — the phone's own Arabic («نوفمبر») is never used. Pure (PolishTest).
 */
object ArDate {
    val MONTHS = listOf("كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول")

    fun month(m: Int): String = MONTHS[Math.floorMod(m - 1, 12)]

    /** «25 تشرين الثاني 2026» (`fmtDate`) */
    fun dmy(d: LocalDate): String = "${d.dayOfMonth} ${month(d.monthValue)} ${d.year}"

    /** «25 تشرين الثاني» (`fmtDayMonth`) */
    fun dm(d: LocalDate): String = "${d.dayOfMonth} ${month(d.monthValue)}"
}
