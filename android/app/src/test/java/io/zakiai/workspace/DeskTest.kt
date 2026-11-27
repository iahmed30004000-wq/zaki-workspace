package io.zakiai.workspace

import io.zakiai.workspace.core.net.CheckinAnswerBody
import io.zakiai.workspace.core.net.CheckinToday
import io.zakiai.workspace.feature.desk.D
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 1: amounts are written as the site writes them, the sections' links open natively, and the site's own rules hold. */
class DeskTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val base = "https://workspace.zakiai.io"

    @Test fun `an amount is the site's fmtReward - minor units over 100, commas, cents only when there are some`() {
        assertEquals("150 دينار", D.money(15000, "JOD"))
        assertEquals("1,250.50 دولار", D.money(125050, "USD"))
        assertEquals("0.05 يورو", D.money(5, "EUR"))
        assertEquals("1,000,000 ليرة سورية", D.money(100000000, "SYP"))
        assertEquals("12 SAR", D.money(1200, "SAR"))
        assertEquals("", D.money(-1, "JOD"))
    }

    @Test fun `ideas, approvals and check-ins open natively, the forms page stays the site's`() {
        assertEquals(Destination.Work("ideas"), Links.destinationOf("/ideas", base))
        assertEquals(Destination.Work("checkins"), Links.destinationOf("/checkins", base))
        assertEquals(Destination.Approval("a1"), Links.destinationOf("/approvals/a1", base))
        assertEquals(Destination.Site("/approvals/forms"), Links.destinationOf("/approvals/forms", base))
    }

    @Test fun `an approvals link keeps its tab, and a new request or a form stays the site's page`() {
        assertEquals(Destination.Work("approvals", "mine"), Links.destinationOf("/approvals?v=mine", base))
        assertEquals(Destination.Work("approvals", "waiting"), Links.destinationOf("/approvals?v=waiting", base))
        assertEquals(Destination.Work("approvals", null), Links.destinationOf("/approvals", base))
        assertEquals(Destination.Site("/approvals?new=1"), Links.destinationOf("/approvals?new=1", base))
        assertEquals(Destination.Site("/approvals?fill=f1"), Links.destinationOf("/approvals?fill=f1", base))
        // the site's viewOf: anything unknown is «طلباتي»
        assertEquals("mine", D.viewOf(null))
        assertEquals("mine", D.viewOf("bogus"))
        assertEquals("waiting", D.viewOf("waiting"))
        assertEquals("all", D.viewOf("all"))
    }

    @Test fun `editing a check-in sends back the tasks attached on the site`() {
        val today = json.decodeFromString<CheckinToday>(
            """{"enabled":true,"day":"2026-11-25","me":{"participant":true,"answered":true,"answers":["a"],"taskIds":["t1","t2"],"canEdit":true}}""",
        )
        assertEquals(listOf("t1", "t2"), today.me?.taskIds)
        val body = json.encodeToString(CheckinAnswerBody.serializer(), CheckinAnswerBody("w1", listOf("b"), today.me!!.taskIds))
        assertTrue(body, body.contains("\"taskIds\":[\"t1\",\"t2\"]"))
    }

    @Test fun `before the round - a check-in day says the hour, another day says it is not a check-in day`() {
        // 2026-11-25 is a Wednesday (3); 2026-11-27 a Friday (5)
        assertEquals("تُفتح جولة اليوم في الساعة 09:00 (الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس).", D.waitingLine("2026-11-25", "09:00", listOf(4, 0, 1, 2, 3)))
        assertEquals("ليس اليوم يوم تسجيل في هذه المساحة. الأيام: الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس.", D.waitingLine("2026-11-27", "09:00", listOf(0, 1, 2, 3, 4)))
        assertEquals(D.checkinsOffTitle, D.waitingLine("2026-11-25", null, null))
        assertEquals(0, D.weekdayOf("2026-11-29"))
    }

    @Test fun `a refusal needs a reason and a change needs what to change, as the site's reasonProblem`() {
        assertEquals("اكتب سبب الرفض.", D.reasonProblem("REJECT", "  "))
        assertEquals("اكتب ما المطلوب تعديله.", D.reasonProblem("CHANGES", ""))
        assertNull(D.reasonProblem("APPROVE", ""))
        assertNull(D.reasonProblem("REJECT", "السعر عالي"))
    }

    @Test fun `an idea names its space only in the company space for a shared idea of another space`() {
        // inside a space: a shared idea says «مشتركة مع الشركة», the space is never named
        assertEquals("سارة · مشتركة مع الشركة", D.ideaLine("سارة", null, true, "المبيعات", "s1", isHq = false, here = "s1", converted = false))
        // in «الشركة»: a shared idea of another space says where it comes from, and no «مشتركة» chip
        assertEquals("سارة · مصممة · من المبيعات", D.ideaLine("سارة", "مصممة", true, "المبيعات", "s1", isHq = true, here = "hq", converted = false))
        // not shared: no space name at all
        assertEquals("سارة · تحوّلت لمهمة", D.ideaLine("سارة", null, false, "المبيعات", "s1", isHq = true, here = "hq", converted = true))
    }
}
