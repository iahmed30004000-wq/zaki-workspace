package io.zakiai.workspace

import io.zakiai.workspace.core.net.Sentences
import io.zakiai.workspace.feature.requests.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 13 (the design and errors pass): what the walk over the whole app found, pinned. */
class PolishTest {
    @Test fun `a lost connection is told apart from a refusal, so it is drawn calm and not as an error`() {
        assertTrue(Sentences.isConnection(Sentences.OFFLINE))
        assertTrue(Sentences.isConnection(Sentences.SLOW))
        assertTrue(Sentences.isConnection(Sentences.NO_SERVER))
        assertFalse(Sentences.isConnection(Sentences.UNREADABLE))
        assertFalse(Sentences.isConnection("لا يمكنك منح هذا الدور أو تعديل هذا العضو"))
    }

    @Test fun `every date in the app uses the site's Levantine month names, never the phone's`() {
        val d = java.time.LocalDate.of(2026, 11, 25)
        assertEquals("25 تشرين الثاني 2026", io.zakiai.workspace.ui.components.ArDate.dmy(d))
        assertEquals("25 تشرين الثاني", io.zakiai.workspace.ui.components.ArDate.dm(d))
        val longAgo = java.time.LocalDate.now().minusDays(40)
        val label = io.zakiai.workspace.feature.chat.dayLabel(longAgo.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toString())
        assertEquals(io.zakiai.workspace.ui.components.ArDate.dmy(longAgo), label)
        assertEquals(io.zakiai.workspace.ui.components.ArDate.MONTHS[10], io.zakiai.workspace.feature.office.O.monthTitle("2026-11").substringBefore(" 2026"))
    }

    @Test fun `a requests section a newer site adds is named in Arabic, never by its key`() {
        assertEquals("طلبات", R.section("someday_new", mine = false))
        assertEquals("طلباتي", R.section("someday_new", mine = true))
    }
}
