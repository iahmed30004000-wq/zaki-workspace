package io.zakiai.workspace

import io.zakiai.workspace.feature.panel.B
import io.zakiai.workspace.feature.panel.Opportunities
import io.zakiai.workspace.feature.panel.OverviewAnswer
import io.zakiai.workspace.feature.panel.PanelHome
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** N6 batch 7: «العملاء», «التقارير» and the owner's board read the site's answers, keep its words, and their links open natively. */
class PanelTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun `an opportunity's amount is the server's or nothing - a cut amount reads as a dash`() {
        val o = json.decodeFromString<Opportunities>("""{"opportunities":[{"id":"o1","number":3,"title":"T","value":null,"stage":"WON","customer":{"id":"c","name":"س"}},{"id":"o2","number":4,"title":"U","value":12500,"stage":"LEAD","customer":{"id":"c","name":"س"}}]}""")
        assertNull(o.opportunities[0].value)
        assertEquals("—", B.amount(o.opportunities[0].value))
        assertEquals("12,500", B.amount(o.opportunities[1].value))
        assertEquals("12,500.50", B.amount(12500.5))
        assertEquals("تمت الصفقة", B.stage("WON"))
    }

    @Test fun `the panel's home and the board read with decimal rates and finished sentences`() {
        val h = json.decodeFromString<PanelHome>("""{"asOf":"x","timeZone":"Asia/Damascus","kpis":{"doneToday":3,"overdue":1,"open":9,"completedWeek":12,"completedPrev":10,"completedChange":20,"onTimeRate":87.5,"onTimePrev":80,"activeToday":4,"staff":6},"insights":[{"id":"overdue","tone":"warn","params":{"n":1},"people":[],"href":"/my-work","sentence":"في مهمة متأخرة","formula":"مهام مفتوحة"}],"todayStrip":{"done":[],"idle":[{"userId":"u","name":"سارة"}]}}""")
        assertEquals(87.5, h.kpis.onTimeRate!!, 0.0)
        assertEquals("في مهمة متأخرة", h.insights[0].sentence)
        val o = json.decodeFromString<OverviewAnswer>("""{"overview":{"mode":"owner","window":{"from":"2026-11-13","to":"2026-11-26","days":["a","b"],"timeZone":"Asia/Damascus"},"cards":null,"people":[{"userId":"u","name":"س","role":"ADMIN","completed":2,"onTimeRate":66.7,"spark":[0,1,1]}],"today":null}}""")
        assertEquals(66.7, o.overview.people[0].onTimeRate!!, 0.0)
        assertNull(o.overview.cards)
    }

    @Test fun `the week's change and the rates are written as the site writes them`() {
        assertEquals("▲ 20% عن الأسبوع اللي قبله", B.weekChange(20.0))
        assertEquals("▼ 5% عن الأسبوع اللي قبله", B.weekChange(-5.0))
        assertEquals("نفس الأسبوع اللي قبله", B.weekChange(0.0))
        assertEquals("ما في أسبوع قبله نقارن فيه", B.weekChange(null))
        assertEquals(0, B.rate(3, 0))
        assertEquals(33, B.rate(1, 3))
        assertEquals("لوحة التحكم", B.boardTitle("owner", true))
        assertEquals("لوحة الفريق", B.boardTitle("team", false))
    }

    @Test fun `an hour on an Arabic phone is written with 0-9 in the company's zone`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ar"))
            assertEquals("12:05", B.clock("2026-11-26T09:05:00Z", "Asia/Damascus"))
            assertEquals("1.5 يوم", B.avgDaysValue(1.5))
            assertEquals("—", B.clock(null, "Asia/Damascus"))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test fun `the places open natively, the panel's other sections stay the site's`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Crm, Links.destinationOf("/crm", base))
        assertEquals(Destination.Reports, Links.destinationOf("/analytics", base))
        assertEquals(Destination.OwnerBoard, Links.destinationOf("/owner", base))
        assertEquals(Destination.OwnerBoard, Links.destinationOf("/owner?v=people", base))
        assertEquals(Destination.Reports, Links.destinationOf("/owner?s=reports", base))
        assertEquals(Destination.Site("/owner?v=ai"), Links.destinationOf("/owner?v=ai", base))
        assertEquals(Destination.Site("/owner?s=accounts"), Links.destinationOf("/owner?s=accounts", base))
        assertEquals(Destination.OwnerBoardPerson("u1"), Links.destinationOf("/owner/people/u1", base))
        assertTrue(Links.destinationOf("/owner/assistant", base) is Destination.Site)
    }
}
