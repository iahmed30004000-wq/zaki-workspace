package io.zakiai.workspace

import io.zakiai.workspace.core.net.RequestsAnswer
import io.zakiai.workspace.feature.requests.R
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** N6 batch 3: «الطلبات» reads the site's own answer and words, and its link opens natively. */
class RequestsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test fun `the five kinds of row read from one answer, each with its own fields`() {
        val a = json.decodeFromString<RequestsAnswer>(
            """{"tab":"waiting","viewerId":"me","total":3,"builtAt":"x","sections":[
              {"key":"approvals","total":1,"allHref":"/approvals","rows":[{"kind":"approval","id":"a1","title":"T","at":"2026-11-26T09:00:00Z","href":"/approvals/a1","place":null,"byName":"سارة","amount":"500 دينار","status":"PENDING","waitingOn":null,"canDecide":true}]},
              {"key":"assignments","total":1,"allHref":null,"rows":[{"kind":"assign","id":"r1","title":"T","at":"2026-11-26T09:00:00Z","href":"/tasks/t1","place":"م","taskId":"t1","requestId":"r1","key":"ZK-1","fromName":"سارة","toName":"أنا","asCo":false,"canAnswer":true}]},
              {"key":"sheets","total":1,"allHref":null,"rows":[{"kind":"sheet","id":"k1","title":"T","at":"2026-11-26T09:00:00Z","href":"/knowledge/k1","place":null,"byName":null,"version":3,"canDecide":true}]}
            ]}""",
        )
        assertEquals(3, a.total)
        val approval = a.sections[0].rows[0]
        assertEquals("500 دينار", approval.amount)
        assertEquals(true, approval.canDecide)
        val assign = a.sections[1].rows[0]
        assertEquals("t1", assign.taskId)
        assertEquals("r1", assign.requestId)
        assertEquals(3, a.sections[2].rows[0].version)
        assertNull(a.groups)
    }

    @Test fun `section titles are the site's, «طلباتي» has its own`() {
        assertEquals("الموافقات", R.section("approvals", false))
        assertEquals("موافقات طلبتها", R.section("approvals", true))
        assertEquals("تذاكر أقسامي", R.section("tickets", false))
        assertEquals("بطاقات أرسلتها للمراجعة", R.section("cards", true))
    }

    @Test fun `the inbox link opens natively`() {
        assertEquals(Destination.Work("requests"), Links.destinationOf("/requests", "https://workspace.zakiai.io"))
    }

    @Test fun `the stale sweep and the contacts open natively`() {
        assertEquals(Destination.Stale, Links.destinationOf("/my-work/stale", "https://workspace.zakiai.io"))
        assertEquals(Destination.Contacts, Links.destinationOf("/contacts", "https://workspace.zakiai.io"))
    }

    @Test fun `the pages kept on the site on purpose are exactly the ones holding secrets (the owner's decision)`() {
        val kept = io.zakiai.workspace.feature.web.SiteKept
        for (p in listOf("/settings", "/settings/company", "/automation", "/automation/tokens", "/telegram", "/owner/assistant/settings", "/theme-gallery", "/approvals/forms", "/approvals/forms/f1", "/settings?tab=x")) {
            org.junit.Assert.assertTrue(p, kept.isKept(p))
        }
        // the person's own settings are ported phase by phase: not kept
        for (p in listOf("/settings/me", "/settings/me/account", "/owner", "/owner/assistant", "/approvals", "/automationx", "/watch")) {
            org.junit.Assert.assertFalse(p, kept.isKept(p))
        }
    }

    @Test fun `a sweep's result says what was done, requested and refused, as the site`() {
        val s = io.zakiai.workspace.feature.stale.S
        assertEquals("تمّت 3 مهمة", s.result(io.zakiai.workspace.feature.stale.SweepResult(done = 3)))
        assertEquals(
            "تمّت 2 مهمة\n1 مهمة انرفضت، والباقي تنفّذ",
            s.result(io.zakiai.workspace.feature.stale.SweepResult(done = 2, refused = 1)),
        )
    }
}
