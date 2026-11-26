package io.zakiai.workspace

import io.zakiai.workspace.feature.office.O
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** N6 batch 2: the site's display rules for «التقويم», «الناس», «تقرير الوقت», «التذاكر», and their links opening natively. */
class OfficeTest {
    private val base = "https://workspace.zakiai.io"

    @Test fun `the month grid is Sunday first with blanks before the 1st, as calendar-grid`() {
        // November 2026 starts on a Sunday: no blank; February 2026 starts on a Sunday too; March 2026 on a Sunday; October 2026 on a Thursday (4 blanks)
        val oct = O.monthCells("2026-10")
        assertEquals(4, oct.takeWhile { it == null }.size)
        assertEquals("2026-10-01", oct[4])
        assertEquals(4 + 31, oct.size)
        assertEquals(0, O.monthCells("2026-11").takeWhile { it == null }.size)
        assertEquals(30, O.monthCells("2026-11").size)
        assertEquals(emptyList<String?>(), O.monthCells("bogus"))
    }

    @Test fun `months move across the year, and the title is the site's month name`() {
        assertEquals("2027-01", O.shiftMonth("2026-12", 1))
        assertEquals("2025-12", O.shiftMonth("2026-01", -1))
        assertEquals("تشرين الثاني 2026", O.monthTitle("2026-11"))
    }

    @Test fun `a due instant falls on the company's day, not the phone's`() {
        // 22:30 UTC is already the next day in Damascus (UTC+3)
        assertEquals("2026-11-26", O.dayOf("2026-11-25T22:30:00.000Z", "Asia/Damascus"))
        assertEquals("2026-11-25", O.dayOf("2026-11-25T22:30:00.000Z", "UTC"))
        assertNull(O.dayOf("not a date", "UTC"))
    }

    @Test fun `hours are written as the site's formatHM and formatDecimal`() {
        assertEquals("00:00", O.hm(0))
        assertEquals("00:01", O.hm(30)) // rounded to the nearest minute
        assertEquals("01:30", O.hm(5400))
        assertEquals("1.50", O.decimal(5400))
        assertEquals("0.01", O.decimal(18)) // half up: 18 s = 0.005 h
        assertEquals("00:00", O.hm(-5))
        assertEquals("01:30 · 1.50", O.both(5400))
    }

    @Test fun `this week is Sunday to Saturday and this month its first to last day, as presetRange`() {
        val wed = LocalDate.parse("2026-11-25")
        assertEquals("2026-11-22" to "2026-11-28", O.preset(true, wed))
        assertEquals("2026-11-01" to "2026-11-30", O.preset(false, wed))
        val sunday = LocalDate.parse("2026-11-29")
        assertEquals("2026-11-29" to "2026-12-05", O.preset(true, sunday))
    }

    @Test fun `the directory search matches the name or the title`() {
        assertTrue(O.matches("سارة أحمد", "مصممة", "سارة"))
        assertTrue(O.matches("Sara", null, "sa"))
        assertTrue(O.matches("سارة", "مصممة", "مصم"))
        assertFalse(O.matches("سارة", "مصممة", "محاسب"))
        assertTrue(O.matches("سارة", null, "  "))
    }

    @Test fun `the five pages open natively, and a ticket link opens that ticket`() {
        assertEquals(Destination.Work("calendar"), Links.destinationOf("/calendar", base))
        assertEquals(Destination.Work("time"), Links.destinationOf("/time", base))
        assertEquals(Destination.Work("tickets"), Links.destinationOf("/tickets", base))
        assertEquals(Destination.Ticket("t1"), Links.destinationOf("/tickets?ticket=t1", base))
        assertEquals(Destination.People, Links.destinationOf("/members", base))
        assertEquals(Destination.People, Links.destinationOf("/teams", base))
        assertEquals(Destination.Person("u1"), Links.destinationOf("/u/u1", base))
        assertEquals(Destination.Person("u1"), Links.destinationOf("/go?space=s1&next=%2Fu%2Fu1", base))
    }

    @Test fun `statuses and priorities read as the site's words`() {
        assertEquals("قيد العمل", O.status("IN_PROGRESS"))
        assertEquals("مفتوحة", O.status("OPEN"))
        assertEquals("عاجلة", O.priority("URGENT"))
        assertEquals("مشرف", O.role("ADMIN"))
    }
}
