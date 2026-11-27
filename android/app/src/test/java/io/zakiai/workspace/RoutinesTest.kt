package io.zakiai.workspace

import io.zakiai.workspace.core.net.ApiFailure
import io.zakiai.workspace.feature.desks.DeskFacts
import io.zakiai.workspace.feature.routines.Opt
import io.zakiai.workspace.feature.routines.RT
import io.zakiai.workspace.feature.routines.Routine
import io.zakiai.workspace.feature.routines.RoutinesAnswer
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 11: «روتين المهام» native — the site's /my-work/routines and its rules, pinned. */
class RoutinesTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test fun `the site's link opens the tab of «الشغل», and the facts say whether it exists`() {
        assertEquals(Destination.Work("routines"), Links.destinationOf("/my-work/routines", "https://workspace.zakiai.io"))
        assertTrue(json.decodeFromString<DeskFacts>("""{"routines":true}""").routines)
        // an older server says nothing: no tab
        assertFalse(json.decodeFromString<DeskFacts>("{}").routines)
    }

    @Test fun `the days read as the site reads them`() {
        assertEquals("EVERY", RT.presetOf(listOf(6, 5, 4, 3, 2, 1, 0)))
        assertEquals("WORKING", RT.presetOf(listOf(0, 1, 2, 3, 4)))
        assertEquals("CUSTOM", RT.presetOf(listOf(0, 2)))
        assertEquals("كل يوم", RT.daysText(RT.EVERY_DAY))
        // Saturday first, as the site's week
        assertEquals("السبت، الاثنين", RT.daysText(listOf(1, 6)))
        assertEquals(listOf(1, 3), RT.daysOf("CUSTOM", listOf(3, 1, 3)))
    }

    @Test fun `the form says what to fix in the site's order, and the due time must come after`() {
        assertEquals("routine.title_required", RT.problem(" ", "p", listOf(0), "08:00", "18:00"))
        assertEquals("routine.assignee_required", RT.problem("x", "", listOf(0), "08:00", "18:00"))
        assertEquals("routine.days_required", RT.problem("x", "p", emptyList(), "08:00", "18:00"))
        assertEquals("routine.time_invalid", RT.problem("x", "p", listOf(0), "8:00", "18:00"))
        assertEquals("routine.due_after_time", RT.problem("x", "p", listOf(0), "18:00", "18:00"))
        assertNull(RT.problem("x", "p", listOf(0), "08:00", "18:00"))
        assertEquals("08:05", RT.clock(8, 5))
    }

    @Test fun `a refusal and a stop are said in the site's words, the next card in the company's zone`() {
        assertEquals("اختار يوم واحد على الأقل.", RT.refusal(ApiFailure("x", key = "validation.failed", detail = "routine.days_required")))
        assertEquals("الروتين مش موجود.", RT.refusal(ApiFailure("x", key = "daily_routine.not_found")))
        assertEquals("some sentence", RT.refusal(ApiFailure("some sentence", key = "unknown.key")))
        assertTrue(RT.stopped("ARCHIVED")!!.startsWith("وقف لحاله"))
        // 05:00 UTC is 08:00 in Damascus
        assertEquals("25 تشرين الثاني · 08:00", RT.whenLabel("2026-11-25T05:00:00Z", "Asia/Damascus"))
        val r = Routine(id = "r", workspaceId = "w", workspaceName = "المبيعات", projectId = "p", projectName = "اليومي", title = "t", assignee = Opt("u", "سارة"), days = listOf(0, 1, 2, 3, 4), time = "08:00", dueTime = "17:00")
        assertEquals("لـ سارة · المبيعات / اليومي", RT.forLine(r))
        assertEquals("أيام الدوام (الأحد–الخميس) · بتنعمل الساعة 08:00 ولازم تخلص قبل 17:00", RT.whenLine(r))
    }

    @Test fun `the answer starts a new form on the company's due hour, and an older server on the site's usual one`() {
        assertEquals("09:00", json.decodeFromString<RoutinesAnswer>("""{"routines":[],"spaces":[],"timeZone":"Asia/Damascus","defaultDueTime":"09:00"}""").defaultDueTime)
        assertEquals("18:00", json.decodeFromString<RoutinesAnswer>("""{"routines":[],"spaces":[],"timeZone":"Asia/Damascus"}""").defaultDueTime)
    }
}
