package io.zakiai.workspace

import io.zakiai.workspace.feature.desks.Campaigns
import io.zakiai.workspace.feature.desks.DayAnswer
import io.zakiai.workspace.feature.desks.DeskFacts
import io.zakiai.workspace.feature.desks.Department
import io.zakiai.workspace.feature.desks.Member
import io.zakiai.workspace.feature.desks.Q
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.feature.watch.V
import io.zakiai.workspace.feature.watch.WatchHomeAnswer
import io.zakiai.workspace.feature.watch.WatchRow
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 6: «الحملات», «الأقسام», «الروتين اليومي» and «نتفرّج سوا» keep the site's rules and words, and their links open natively. */
class DesksTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun `the facts, the campaigns and the day read from the site's answers`() {
        val f = json.decodeFromString<DeskFacts>("""{"role":"MEMBER","external":false,"spaceOnly":false,"directory":true,"manager":false,"campaigns":{"view":true,"edit":true,"delete":false},"tickets":{"view":true,"edit":true,"delete":true},"production":{"view":true,"edit":false,"delete":false},"departmentId":"d1","timeZone":"Asia/Damascus","today":"2026-11-26"}""")
        assertEquals("d1", f.departmentId)
        assertFalse(f.production.edit)
        val c = json.decodeFromString<Campaigns>("""{"campaigns":[{"id":"c1","number":7,"title":"رمضان","status":"RUNNING","priority":"HIGH","startDate":"2026-03-01T12:00:00.000Z","endDate":"2026-03-30T12:00:00.000Z","owner":{"id":"u","name":"سارة"},"_count":{"items":4}}]}""")
        assertEquals(4, c.campaigns[0].count.items)
        assertEquals("1 آذار", Q.shortDay(c.campaigns[0].startDate))
        val d = json.decodeFromString<DayAnswer>("""{"day":"2026-11-26","items":[{"id":"r1","title":"فيديو","doneAt":null},{"id":"r2","title":"نشر","doneAt":"2026-11-26T08:00:00Z","archived":true}]}""")
        assertEquals(1, Q.doneCount(d.items))
        assertTrue(d.items[1].archived)
    }

    @Test fun `active campaigns are the running and the scheduled ones`() {
        val c = json.decodeFromString<Campaigns>("""{"campaigns":[{"id":"a","status":"RUNNING"},{"id":"b","status":"SCHEDULED"},{"id":"c","status":"DRAFT"},{"id":"d","status":"DONE"}]}""")
        assertEquals(2, Q.active(c.campaigns))
        assertEquals("ملغاة", Q.status("CANCELLED"))
        assertEquals("عاجلة", Q.priority("URGENT"))
    }

    @Test fun `who manages a department's campaigns is the site's rule`() {
        val dept = Department(id = "d", members = listOf(Member(id = "me")))
        assertTrue(Q.managesCampaigns(true, null, "x"))
        assertTrue(Q.managesCampaigns(false, dept, "me"))
        assertFalse(Q.managesCampaigns(false, dept, "other"))
    }

    @Test fun `the routine's days - Sunday is 0, none or all seven is every day`() {
        assertEquals(Q.everyDay, Q.weekdaysLabel(""))
        assertEquals(Q.everyDay, Q.weekdaysLabel("0,1,2,3,4,5,6"))
        assertEquals("اثنين · أربعاء", Q.weekdaysLabel("3,1"))
        assertEquals("الخميس 26 تشرين الثاني 2026", Q.longDay("2026-11-26"))
        assertEquals("الأحد 29 تشرين الثاني 2026", Q.longDay("2026-11-29"))
        assertEquals("2026-12-01", Q.shiftDay("2026-11-30", 1))
        assertEquals("2026-11-29", Q.shiftDay("2026-11-30", -1))
    }

    @Test fun `watch - only YouTube links play, live sessions come first`() {
        assertTrue(V.looksPlayable("https://www.youtube.com/watch?v=abc"))
        assertTrue(V.looksPlayable("https://youtu.be/abc"))
        assertFalse(V.looksPlayable("https://vimeo.com/1"))
        assertFalse(V.looksPlayable("not a link"))
        val rows = listOf(WatchRow(id = "old", live = false, createdAt = "2026-11-26T10:00:00Z"), WatchRow(id = "live", live = true, createdAt = "2026-11-20T10:00:00Z"))
        assertEquals(listOf("live", "old"), V.ordered(rows).map { it.id })
        val home = json.decodeFromString<WatchHomeAnswer>("""{"spaceId":"s","sessions":[],"candidates":[{"id":"u","name":"سارة"}],"canStart":true}""")
        assertTrue(home.canStart)
    }

    @Test fun `the four places open natively`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Work("campaigns"), Links.destinationOf("/campaigns", base))
        assertEquals(Destination.Work("production"), Links.destinationOf("/production", base))
        assertEquals(Destination.Departments, Links.destinationOf("/departments", base))
        assertEquals(Destination.WatchSession("w1"), Links.destinationOf("/go?space=s&next=%2Fwatch%2Fw1", base))
    }
}
