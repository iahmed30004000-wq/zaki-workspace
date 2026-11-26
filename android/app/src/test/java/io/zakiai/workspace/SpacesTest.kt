package io.zakiai.workspace

import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.feature.spaces.S
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

    @Test fun `the overview opens natively, a space's own settings stay the site's page for now`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Spaces, Links.destinationOf("/spaces", base))
        assertEquals(Destination.Site("/spaces/s1/settings"), Links.destinationOf("/spaces/s1/settings", base))
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
