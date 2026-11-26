package io.zakiai.workspace

import io.zakiai.workspace.feature.cards.CardDraft
import io.zakiai.workspace.feature.cards.CardItem
import io.zakiai.workspace.feature.cards.CardList
import io.zakiai.workspace.feature.cards.CardPageData
import io.zakiai.workspace.feature.cards.CardPatch
import io.zakiai.workspace.feature.cards.K
import io.zakiai.workspace.feature.cards.LogEntry
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** N6 batch 4: «اللوحات» reads the site's own answers, keeps its rules (view.ts, shared.ts, texts.ts) and opens natively. */
class CardsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true; encodeDefaults = true }

    private fun card(id: String, title: String, pinned: Boolean = false, position: Double = 0.0, createdAt: String = "2026-11-01T00:00:00Z", kind: String = "NOTE", category: String? = null, body: String? = null) =
        CardItem(id = id, title = title, pinned = pinned, position = position, createdAt = createdAt, kind = kind, category = category, body = body)

    @Test fun `the list and the page read from the site's answers`() {
        val list = json.decodeFromString<CardList>(
            """{"cards":[{"id":"c1","kind":"LIST","title":"T","body":null,"data":{"items":[{"text":"a","done":true},{"text":"b","done":false}]},"color":"cat-2","category":null,"tags":["x"],"pinned":true,"position":1024,"fileId":null,"file":null,"archivedAt":null,"createdAt":"x","updatedAt":"x","createdById":"u","createdByName":"سارة","status":"REVIEW","version":3,"coverFileId":null}],"canWrite":true,"owner":false}""",
        )
        val c = list.cards.single()
        assertEquals("1 من 2", K.preview(c))
        assertEquals(3, c.version)
        assertTrue(list.canWrite)
        val page = json.decodeFromString<CardPageData>(
            """{"card":{"id":"c1","kind":"NOTE","title":"T","data":null},"abilities":{"write":true,"participate":true,"moderate":true,"gallery":false,"seeRaters":false,"internal":true,"oversight":false,"restore":false,"statusMoves":["REVIEW","ARCHIVED"]},"rating":{"average":4.5,"count":2,"mine":5,"raters":null},"gallery":[],"spaceId":"s","spaceName":"م"}""",
        )
        assertEquals(listOf("REVIEW", "ARCHIVED"), page.abilities.statusMoves)
        assertEquals(5, page.rating?.mine)
        assertNull(page.rating?.raters)
    }

    @Test fun `pinned cards come first in every order, as on the site`() {
        val cards = listOf(
            card("a", "ب", position = 1.0, createdAt = "2026-11-03T00:00:00Z"),
            card("b", "أ", position = 2.0, createdAt = "2026-11-01T00:00:00Z", pinned = true),
            card("c", "ج", position = 3.0, createdAt = "2026-11-02T00:00:00Z"),
        )
        assertEquals(listOf("b", "a", "c"), K.visible(cards, "", null, null, false, "manual").map { it.id })
        assertEquals(listOf("b", "a", "c"), K.visible(cards, "", null, null, false, "newest").map { it.id })
        assertEquals(listOf("b", "c", "a"), K.visible(cards, "", null, null, false, "oldest").map { it.id })
        assertEquals(listOf("b", "a", "c"), K.visible(cards, "", null, null, false, "title").map { it.id })
        assertEquals(listOf("b"), K.visible(cards, "", null, null, true, "manual").map { it.id })
    }

    @Test fun `the search reads one shape of alef and Western digits, and the category «بلا تصنيف»`() {
        val cards = listOf(card("a", "إعلان ١٢", category = "تسويق"), card("b", "طلب", body = "رقم 7"))
        assertEquals(listOf("a"), K.visible(cards, "اعلان 12", null, null, false, "manual").map { it.id })
        assertEquals(listOf("b"), K.visible(cards, "٧", null, null, false, "manual").map { it.id })
        assertEquals(listOf("b"), K.visible(cards, "", null, "", false, "manual").map { it.id })
        assertEquals(listOf("a"), K.visible(cards, "", null, "تسويق", false, "manual").map { it.id })
        assertEquals(listOf("تسويق"), K.categoriesOf(cards))
    }

    @Test fun `a link opens only over https, with no password in it`() {
        assertTrue(K.isSafeHttps("https://zakiai.io/a"))
        assertFalse(K.isSafeHttps("http://zakiai.io"))
        assertFalse(K.isSafeHttps("javascript:alert(1)"))
        assertFalse(K.isSafeHttps("https://user:pw@zakiai.io"))
        assertNull(K.linkUrl(JsonObject(mapOf("url" to JsonPrimitive("http://x.io")))))
        assertEquals("zakiai.io", K.preview(CardItem(kind = "LINK", data = K.linkData("https://zakiai.io/x"))))
    }

    @Test fun `a table is padded to its columns, and the editor writes the site's shapes`() {
        val (cols, rows) = K.table(K.tableData(listOf("أ", "ب"), listOf(listOf("1"))))
        assertEquals(listOf("أ", "ب"), cols)
        assertEquals(listOf(listOf("1", "")), rows)
        val list = K.listData(listOf("a" to true, " " to false)).jsonObject["items"] as JsonArray
        assertEquals(1, list.size)
        assertEquals("اكتب عنوانًا للوحة", CardDraft(title = " ").problem())
        assertEquals("اكتب نص البرومبت", CardDraft(kind = "PROMPT", title = "t").problem())
        assertNull(CardDraft(kind = "LINK", title = "t", url = "https://a.io").problem())
    }

    @Test fun `tags are cleaned as the site cleans them`() {
        assertEquals(listOf("سوق", "عرض"), K.tagsOf("#سوق، عرض, سوق ,  "))
        assertEquals(10, K.tagsOf((1..20).joinToString(",") { "t$it" }).size)
    }

    @Test fun `an edit sends only what it changes, a pin alone is only the pin`() {
        val pin = json.encodeToString(CardPatch.serializer(), CardPatch(pinned = true))
        assertEquals("""{"pinned":true}""", pin)
        val edit = json.encodeToString(CardPatch.serializer(), CardPatch(version = 2, body = "", category = ""))
        assertEquals("""{"version":2,"body":"","category":""}""", edit)
    }

    @Test fun `the log speaks the site's sentences, and a rating seen by somebody who may not know names nobody`() {
        fun e(action: String, actor: String?, vararg d: Pair<String, Any>) = LogEntry(
            action = action, actorName = actor,
            detail = JsonObject(d.associate { (k, v) -> k to when (v) { is Int -> JsonPrimitive(v); is Boolean -> JsonPrimitive(v); else -> JsonPrimitive(v.toString()) } }),
        )
        assertEquals("سارة: نقل الحالة من «مسودة» إلى «معتمدة»", K.logLine(e("status", "سارة", "from" to "DRAFT", "to" to "APPROVED")))
        assertEquals("سارة: عدّل اللوحة (العنوان، النص) فصارت الإصدار 4", K.logLine(e("edited", "سارة", "fields" to "title,body", "version" to 4)))
        assertEquals("قيّم أحد الأعضاء اللوحة", K.logLine(e("rated", null)))
        assertEquals("أحد الأعضاء: ثبّت اللوحة", K.logLine(e("pinned", null, "pinned" to true)))
    }

    @Test fun `a date and an hour are written with 0-9 on an Arabic phone`() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ar"))
            val s = K.stamp("2026-11-26T09:05:00Z", java.time.ZoneOffset.UTC)
            assertTrue(s, s.endsWith("09:05"))
            assertEquals("4.5 من 5", K.starsAvg(4.5))
        } finally {
            Locale.setDefault(before)
        }
    }

    @Test fun `the cards open natively, the site's task sheet over them stays the site's`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Cards, Links.destinationOf("/cards", base))
        assertEquals(Destination.Card("c1"), Links.destinationOf("/cards/c1", base))
        assertEquals(Destination.Card("c1"), Links.destinationOf("/go?space=s&next=%2Fcards%2Fc1", base))
        assertEquals(Destination.Site("/cards?new=task"), Links.destinationOf("/cards?new=task", base))
    }
}
