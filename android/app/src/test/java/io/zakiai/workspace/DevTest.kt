package io.zakiai.workspace

import io.zakiai.workspace.feature.dev.D
import io.zakiai.workspace.feature.dev.DevWords
import io.zakiai.workspace.feature.dev.PeriodChoice
import io.zakiai.workspace.feature.dev.ReviewsAnswer
import io.zakiai.workspace.feature.dev.Structure
import io.zakiai.workspace.feature.dev.StructureNode
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** N6 batch 9: «الأداء والتطوير» and «الهيكل» open natively, draw the tree as the site does, and read no private note they were not sent. */
class DevTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    private fun node(id: String, manager: String?) = StructureNode(userId = id, name = id, managerId = manager)

    @Test fun `the section's addresses open natively, a tab of a file kept, what is not native yet stays the site's`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Development, Links.destinationOf("/development", base))
        assertEquals(Destination.Structure, Links.destinationOf("/structure", base))
        assertEquals(Destination.DevPerson("u1", "score"), Links.destinationOf("/development/people/u1?tab=score&period=2026-10", base))
        assertEquals(Destination.DevPerson("u1", null), Links.destinationOf("/development/people/u1", base))
        assertEquals(Destination.Site("/development/settings"), Links.destinationOf("/development/settings", base))
    }

    @Test fun `the tree runs from the top down, then the people nobody answers for, each drawn once`() {
        val s = Structure(
            mode = "all",
            nodes = listOf(node("owner", null), node("sup", "owner"), node("r1", "sup"), node("rr1", "r1"), node("loose", null), node("under-loose", "loose")),
            roots = listOf("owner"),
            unassigned = listOf("loose"),
        )
        val lines = D.tree(s)
        assertEquals(listOf("owner", "sup", "r1", "rr1", "loose", "under-loose"), lines.map { it.node.userId })
        assertEquals(listOf(0, 1, 2, 3, 0, 1), lines.map { it.depth })
        assertEquals(listOf(false, false, false, false, true, true), lines.map { it.loose })
    }

    @Test fun `a new supervisor is never the person or anybody below them`() {
        val s = Structure(nodes = listOf(node("owner", null), node("sup", "owner"), node("r1", "sup"), node("rr1", "r1"), node("x", "owner")))
        assertEquals(listOf("owner", "x"), D.pickable(s, "sup").map { it.userId })
        assertEquals(listOf("owner", "sup", "x"), D.pickable(s, "r1").map { it.userId })
        // everybody answers to the owner, directly or not: nobody can be put above him
        assertEquals(emptyList<String>(), D.pickable(s, "owner").map { it.userId })
    }

    @Test fun `numbers and words as the site writes them, Western digits on an Arabic phone`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ar"))
            assertEquals("72", D.n(72))
            assertEquals("—", D.num(null))
            assertEquals("67", D.num(66.6))
            assertEquals("3.5", D.one(3.46))
            assertEquals("4", D.one(4.0))
            assertEquals("2:05", D.minutes(125))
            assertEquals("3 — " + DevWords.all["teamdev.level.3"], D.level(3))
            assertEquals(DevWords.all["teamdev.light.AMBER"], D.light("AMBER"))
        } finally {
            Locale.setDefault(before)
        }
        assertEquals("الربع 4 2026", D.period("2026-Q4", listOf(PeriodChoice("2026-Q4", "quarter", "الربع 4 2026"))))
        assertEquals(listOf("skills"), D.tabsOf("OWNER"))
        assertEquals(5, D.tabsOf("MEMBER").size)
    }

    @Test fun `a rating tapped again is taken back`() {
        val one = D.rate(emptyMap(), "c1", 4)
        assertEquals(mapOf("c1" to 4), one)
        assertEquals(mapOf("c1" to 2), D.rate(one, "c1", 2))
        assertEquals(emptyMap<String, Int>(), D.rate(one, "c1", 4))
    }

    @Test fun `the person's own reviews arrive without the private note, and the phone shows none`() {
        val r = json.decodeFromString<ReviewsAnswer>("""{"reviews":[{"id":"r","userId":"u","reviewerId":"s","reviewerName":"المسؤول","period":"2026-10","version":1,"status":"SHARED","ratings":{"c1":4},"light":"GREEN","strengths":"ممتاز","improvement":"","updatedAt":"2026-11-01T10:00:00Z","submittedAt":null,"sharedAt":null,"mine":false,"editable":false,"live":true}]}""")
        assertNull(r.reviews[0].privateNote)
        assertEquals(4, r.reviews[0].ratings["c1"])
        assertTrue(r.reviews[0].live)
        assertEquals("الصفحة المطلوبة غير موجودة.", D.refusal(null, "teamdev.not_found", "x"))
        assertEquals("x", D.refusal(null, null, "x"))
    }
}
