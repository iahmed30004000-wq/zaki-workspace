package io.zakiai.workspace

import io.zakiai.workspace.feature.work.TaskViewModel
import io.zakiai.workspace.feature.work.W
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

class WorkTextTest {
    private val utc = ZoneId.of("UTC")
    private val today = LocalDate.of(2026, 11, 25)

    @Test fun `a due day in the site's words`() {
        assertEquals("اليوم", W.dueLabel("2026-11-25T09:00:00Z", today, utc))
        assertEquals("بكرا", W.dueLabel("2026-11-26T09:00:00Z", today, utc))
        assertEquals("مبارح", W.dueLabel("2026-11-24T09:00:00Z", today, utc))
        assertTrue(W.dueLabel("2026-11-20T09:00:00Z", today, utc)!!.startsWith("متأخرة"))
        assertNull(W.dueLabel(null, today, utc))
        assertNull(W.dueLabel("not a date", today, utc))
        assertTrue(W.isLate("2026-11-24T09:00:00Z", today, utc))
        assertFalse(W.isLate("2026-11-25T23:00:00Z", today, utc))
    }

    @Test fun `priorities and the default columns read in Arabic, any other column as typed`() {
        assertEquals("عاجلة", W.priorityLabel("URGENT"))
        assertEquals("غير معروف", W.priorityLabel("WHAT"))
        assertEquals("منتهي", W.columnLabel("done"))
        assertEquals("قيد التنفيذ", W.columnLabel("In Progress"))
        assertEquals("تصميم", W.columnLabel("تصميم"))
    }

    @Test fun `«مهامي»'s six tabs are the site's`() {
        assertEquals(listOf("today", "overdue", "upcoming", "mine", "created", "completed"), W.TABS.map { it.first })
    }
}

class RemindMomentsTest {
    @Test fun `in an hour, this evening at six, tomorrow at nine`() {
        val m = TaskViewModel.quickMoments(LocalDateTime.of(2026, 11, 25, 10, 30))
        assertEquals(LocalDateTime.of(2026, 11, 25, 11, 30), m[0].second)
        assertEquals(LocalDateTime.of(2026, 11, 25, 18, 0), m[1].second)
        assertEquals(LocalDateTime.of(2026, 11, 26, 9, 0), m[2].second)
    }

    @Test fun `after six the evening is tomorrow's, never in the past`() {
        val m = TaskViewModel.quickMoments(LocalDateTime.of(2026, 11, 25, 19, 0))
        assertEquals(LocalDateTime.of(2026, 11, 26, 18, 0), m[1].second)
    }
}
