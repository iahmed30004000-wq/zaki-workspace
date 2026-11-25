package io.zakiai.workspace

import io.zakiai.workspace.feature.desk.D
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import org.junit.Assert.assertEquals
import org.junit.Test

/** N6 batch 1: amounts are written as the site writes them, and the sections' links open natively. */
class DeskTest {
    @Test fun `an amount is the site's fmtReward - minor units over 100, commas, cents only when there are some`() {
        assertEquals("150 دينار", D.money(15000, "JOD"))
        assertEquals("1,250.50 دولار", D.money(125050, "USD"))
        assertEquals("0.05 يورو", D.money(5, "EUR"))
        assertEquals("1,000,000 ليرة سورية", D.money(100000000, "SYP"))
        assertEquals("12 SAR", D.money(1200, "SAR"))
        assertEquals("", D.money(-1, "JOD"))
    }

    @Test fun `ideas, approvals and check-ins open natively, the forms page stays the site's`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Work("ideas"), Links.destinationOf("/ideas", base))
        assertEquals(Destination.Work("approvals"), Links.destinationOf("/approvals?v=waiting", base))
        assertEquals(Destination.Work("checkins"), Links.destinationOf("/checkins", base))
        assertEquals(Destination.Approval("a1"), Links.destinationOf("/approvals/a1", base))
        assertEquals(Destination.Site("/approvals/forms"), Links.destinationOf("/approvals/forms", base))
    }
}
