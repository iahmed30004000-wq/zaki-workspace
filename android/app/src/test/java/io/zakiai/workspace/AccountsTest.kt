package io.zakiai.workspace

import io.zakiai.workspace.feature.accounts.A
import io.zakiai.workspace.feature.accounts.AccountWords
import io.zakiai.workspace.feature.accounts.CapRow
import io.zakiai.workspace.feature.accounts.Member
import io.zakiai.workspace.feature.accounts.MemberSheet
import io.zakiai.workspace.feature.accounts.MemberSpace
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 12: «الحسابات والصلاحيات» opens natively and says what the site's people screen says, by the site's own rules. */
class AccountsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
    private val base = "https://workspace.zakiai.io"

    @Test fun `the panel's accounts open natively, its other sections stay the site's`() {
        assertEquals(Destination.Accounts, Links.destinationOf("/owner?s=accounts", base))
        assertEquals(Destination.Accounts, Links.destinationOf("/owner?s=people&part=accounts", base))
        assertEquals(Destination.OwnerBoard, Links.destinationOf("/owner?s=people", base))
        assertEquals(Destination.Site("/owner?s=features"), Links.destinationOf("/owner?s=features", base))
    }

    @Test fun `the search folds the spellings people type and every word must match`() {
        val people = listOf(Member(id = "1", name = "أحمد الخطيب", jobTitle = "مندوب"), Member(id = "2", name = "سارة", username = "sara", status = "SUSPENDED"))
        assertEquals(listOf("1"), A.filter(people, "احمد  مندوب", "ALL").map { it.id })
        assertEquals(listOf("2"), A.filter(people, "SARA", "ALL").map { it.id })
        assertEquals(listOf("2"), A.filter(people, "", "SUSPENDED").map { it.id })
        assertEquals(emptyList<String>(), A.filter(people, "احمد سارة", "ALL").map { it.id })
        assertEquals(mapOf("ALL" to 2, "ACTIVE" to 1, "SUSPENDED" to 1, "OFFBOARDED" to 0), A.counts(people))
    }

    @Test fun `the last sign-in in the site's Arabic forms`() {
        val now = java.time.Instant.parse("2026-11-26T12:00:00Z").toEpochMilli()
        assertEquals(AccountWords.all["members.never_logged"], A.lastLogin(null, now))
        assertEquals(AccountWords.s("members.last_login", "when" to AccountWords.all["members.ago.hour.two"]), A.lastLogin("2026-11-26T10:00:00Z", now))
        assertEquals(AccountWords.s("members.ago.day.few", "n" to 3), A.ago("2026-11-23T11:00:00Z", now))
        assertEquals(AccountWords.all["members.ago.now"], A.ago("2026-11-26T11:59:40Z", now))
    }

    @Test fun `a partner is named a partner, and the spaces line is shortened as on the card`() {
        assertEquals(AccountWords.all["role.partner"], A.role("OWNER", false))
        assertEquals(AccountWords.all["role.owner"], A.role("OWNER", true))
        val m = Member(role = "MEMBER", workspaces = (1..5).map { MemberSpace("s$it", "م$it") })
        assertEquals("م1، م2، م3 " + AccountWords.s("members.spaces_more", "n" to 2), A.spaces(m))
        assertEquals(AccountWords.all["members.spaces_all"], A.spaces(Member(role = "OWNER")))
    }

    @Test fun `«حفظ» sends only what changed, no manager as null, and nothing when nothing changed`() {
        val m = Member(id = "u", name = "سارة", jobTitle = "مبيعات", role = "MEMBER", managerId = "boss")
        assertNull(A.infoBody(m, " سارة ", "مبيعات", "MEMBER", "boss"))
        assertEquals("""{"jobTitle":"","managerId":null}""", A.infoBody(m, "سارة", "", "MEMBER", "").toString())
        assertEquals("""{"role":"LEAD"}""", A.infoBody(m, "سارة", "مبيعات", "LEAD", "boss").toString())
        // a guest follows nobody: the server clears the manager itself
        assertEquals("""{"role":"GUEST"}""", A.infoBody(m, "سارة", "مبيعات", "GUEST", "boss").toString())
    }

    @Test fun `a switch says whether it is the rank's or the owner's change, and why it is locked`() {
        assertEquals(AccountWords.all["members.caps_default"], A.tag(CapRow(customized = false)))
        assertEquals(AccountWords.all["members.caps_added"], A.tag(CapRow(customized = true, on = true)))
        assertEquals(AccountWords.all["members.caps_removed"], A.tag(CapRow(customized = true, on = false)))
        assertEquals(AccountWords.all["members.caps_locked_actor"], A.note(CapRow(locked = "actor_lacks")))
        assertEquals(AccountWords.all["members.caps_sensitive"], A.note(CapRow(on = true, sensitive = true, rankDefault = false)))
        assertNull(A.note(CapRow(on = true, sensitive = true, rankDefault = true)))
    }

    @Test fun `the sheet's answer is read whole, a flip carries the lists it sends`() {
        val s = json.decodeFromString<MemberSheet>(
            """{"member":{"id":"u","name":"سارة","role":"MEMBER","status":"ACTIVE","openWork":2},"acts":{"manageable":true,"edit":true,"capabilities":"editable","suspend":true,"offboard":true},
               "ownerRank":true,"roles":["ADMIN","LEAD","MEMBER","GUEST"],"oversight":null,
               "areas":[{"id":"work","on":1,"total":2,"grid":[{"section":"tasks","cells":[{"capability":"tasks.view","on":true,"locked":null,"needsView":false,"next":{"capabilities":[],"revokedCapabilities":["tasks.view"]}},null,null]}],"rows":[]}],
               "explain":[{"id":"work","rows":[{"capability":"tasks.view","usable":true,"why":"حسب الرتبة"}]}],"reset":null,"managers":[{"id":"o","name":"المالك"}],"receivers":[{"id":"o","name":"المالك","role":"OWNER","primaryOwner":true}]}""",
        )
        assertEquals(2, s.member.openWork)
        assertEquals(listOf("tasks.view"), s.areas[0].grid[0].cells[0]!!.next.revokedCapabilities)
        assertNull(s.areas[0].grid[0].cells[1])
        assertTrue(s.explain[0].rows[0].usable)
        assertEquals("المالك — " + AccountWords.all["role.owner"], A.pickLabel(s.receivers[0]))
    }
}
