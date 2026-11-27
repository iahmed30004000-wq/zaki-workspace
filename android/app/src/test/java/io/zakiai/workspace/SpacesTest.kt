package io.zakiai.workspace

import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.feature.spaces.DirPerson
import io.zakiai.workspace.feature.spaces.DirUser
import io.zakiai.workspace.feature.spaces.S
import io.zakiai.workspace.feature.spaces.SS
import io.zakiai.workspace.feature.spaces.SpaceMember
import io.zakiai.workspace.feature.spaces.SpaceSettingsAnswer
import io.zakiai.workspace.feature.spaces.Unplaced
import io.zakiai.workspace.feature.spaces.SpaceCard
import io.zakiai.workspace.feature.spaces.SpaceWords
import io.zakiai.workspace.feature.spaces.SpacesScreen
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** N6 batch 10: «كل المساحات» opens natively and shows numbers only, in the site's own words, Western digits on an Arabic phone. */
class SpacesTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun `the overview and a space's settings open natively`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Spaces, Links.destinationOf("/spaces", base))
        assertEquals(Destination.SpaceSettings("s1"), Links.destinationOf("/spaces/s1/settings?tab=people", base))
    }

    @Test fun `the phone offers the site's tabs without «خطر», and adds only who is not in the space yet`() {
        val a = SpaceSettingsAnswer(tabs = listOf("general", "people", "teams", "chat", "work", "danger"))
        assertEquals(listOf("general", "people", "teams", "chat", "work"), SS.tabsOf(a))
        val members = listOf(SpaceMember("u1", "a", "ADMIN"))
        val dir = listOf(DirPerson("u1", DirUser("u1", "a")), DirPerson("u2", DirUser("u2", "b")))
        assertEquals(listOf("u2"), SS.addable(members, dir).map { it.userId })
        assertEquals(SpaceWords.all["ws.role_admin"], SS.roleWord("ADMIN"))
        assertEquals(null, SS.roleWord(null))
        // «بلا إيموجي» and «بلا قائد» travel as null, never left out
        assertEquals("""{"emoji":null}""", SS.emojiBody(null).toString())
        assertEquals("""{"leadId":null}""", SS.leadBody(null).toString())
    }

    @Test fun `the old things with no space are grouped by kind, in the site's order, empty kinds left out`() {
        val rows = listOf(Unplaced("goal", "g1"), Unplaced("idea", "i1"), Unplaced("idea", "i2"))
        assertEquals(listOf("idea" to 2, "goal" to 1), S.groups(rows).map { it.first to it.second.size })
    }

    @Test fun `a card's numbers each carry their word, Western digits always`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ar"))
            val line = S.figures(SpaceCard(id = "s", name = "م", open = 12, overdue = 3, unread = 7, members = 5))
            assertTrue(line, line.startsWith("12 " + SpaceWords.all["spaces.overview.open"]))
            assertTrue(line, line.contains("3 " + SpaceWords.all["spaces.overview.overdue"]))
            assertTrue(line, line.endsWith("5 " + SpaceWords.all["spaces.overview.members"]))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test fun `the company's own space is never offered for archiving, and a card is numbers only`() {
        assertEquals(false, S.archivable(SpaceCard(kind = "HQ")))
        assertEquals(true, S.archivable(SpaceCard(kind = "TEAM")))
        val a = json.decodeFromString<SpacesScreen>("""{"cards":[{"id":"s","name":"المبيعات","emoji":null,"kind":"TEAM","members":4,"open":9,"overdue":1,"unread":2}],"hereId":"s","archived":[{"id":"o","name":"قديمة","emoji":null,"archivedAt":"2026-11-01T00:00:00Z"}]}""")
        assertEquals("s", a.hereId)
        assertEquals(9, a.cards[0].open)
        assertEquals("o", a.archived[0].id)
    }
}
