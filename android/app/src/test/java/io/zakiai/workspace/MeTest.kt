package io.zakiai.workspace

import io.zakiai.workspace.feature.me.GuideAnswer
import io.zakiai.workspace.feature.me.M
import io.zakiai.workspace.feature.me.SettingsFacts
import io.zakiai.workspace.feature.me.WorkHours
import io.zakiai.workspace.feature.shell.Destination
import io.zakiai.workspace.feature.shell.Links
import io.zakiai.workspace.feature.web.SiteKept
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** N6 batch 5: «إعداداتي» keeps the site's rules and words, «دليل ذكي» reads the site's answer, and their links open natively. */
class MeTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test fun `the settings facts and a guide article read from the site's answers`() {
        val f = json.decodeFromString<SettingsFacts>("""{"external":false,"usernameManaged":true,"contactOwnerId":"o1","digits":"arabic","features":{"avatars":true,"chatAutomation":false,"lastSeen":true,"appConnection":true,"chatFolders":false}}""")
        assertEquals("o1", f.contactOwnerId)
        assertTrue(f.features.avatars)
        assertFalse(f.features.chatAutomation)
        val g = json.decodeFromString<GuideAnswer>(
            """{"article":{"slug":"tasks","title":"المهام","summary":"س","audience":"staff","blocks":[{"type":"steps","title":"خطوات","items":["أ","ب"]},{"type":"warn","text":"تحذير","fix":"حل"},{"type":"keys","keys":["Ctrl","K"],"text":"بحث"}],"cta":null,"art":null},"prev":{"slug":"calls","title":"المكالمات"},"next":null}""",
        )
        assertEquals(listOf("أ", "ب"), g.article.blocks[0].items)
        assertEquals("حل", g.article.blocks[1].fix)
        assertEquals("calls", g.prev?.slug)
        assertNull(g.next)
    }

    @Test fun `a missing rule is on, and the section sent holds only the false flags (null when nothing is off)`() {
        val prefs = JsonObject(mapOf("notifications" to JsonObject(mapOf("calls" to JsonObject(mapOf("on" to JsonPrimitive(false)))))))
        val rules = M.rules(prefs)
        assertTrue(rules.getValue("private").on)
        assertFalse(rules.getValue("calls").on)
        val off = rules.toMutableMap().apply { put("topics", M.NotifyRule(on = true, preview = false)) }
        assertEquals(
            JsonObject(mapOf("topics" to JsonObject(mapOf("preview" to JsonPrimitive(false))), "calls" to JsonObject(mapOf("on" to JsonPrimitive(false))))),
            M.notificationsSection(off),
        )
        assertEquals(JsonNull, M.notificationsSection(M.KINDS.associateWith { M.NotifyRule() }))
        // «المكالمات» has no message text to hide
        assertEquals(JsonNull, M.notificationsSection(mapOf("calls" to M.NotifyRule(preview = false))))
    }

    @Test fun `the quick six are the person's or the site's, stored only when they differ, the rest of the chat section kept`() {
        assertEquals(listOf("👍", "❤️", "😂", "🎉", "🔥", "👀"), M.quickOf(null))
        val mine = listOf("👍", "❤️", "😂", "🎉", "🔥", "🚀")
        val prefs = JsonObject(mapOf("chat" to JsonObject(mapOf("fontStep" to JsonPrimitive(3), "doubleTap" to JsonPrimitive("👀")))))
        val chat = M.chatWithQuick(prefs, mine)
        assertEquals(JsonPrimitive(3), chat["fontStep"])
        assertEquals(mine, (chat["quickReactions"] as JsonArray).map { (it as JsonPrimitive).content })
        assertNull("a double tap no longer among the six is dropped", chat["doubleTap"])
        assertEquals(mine, M.quickOf(JsonObject(mapOf("chat" to chat))))
        assertNull(M.chatWithQuick(JsonObject(mapOf("chat" to chat)), M.QUICK_DEFAULT)["quickReactions"])
        // a broken list reads as the site's six
        assertEquals(M.QUICK_DEFAULT, M.quickOf(JsonObject(mapOf("chat" to JsonObject(mapOf("quickReactions" to JsonArray(listOf(JsonPrimitive("👍")))))))))
    }

    @Test fun `work hours as the server takes them`() {
        assertNull(M.hoursProblem(WorkHours()))
        assertNotNull(M.hoursProblem(WorkHours(from = "17:00", to = "09:00")))
        assertNotNull(M.hoursProblem(WorkHours(from = "9:00")))
        assertNotNull(M.hoursProblem(WorkHours(days = emptyList())))
    }

    @Test fun `a browser and the app are named as the site names them`() {
        assertEquals("تطبيق ذكي على أندرويد", M.uaLabel("okhttp/4.12.0"))
        assertEquals("تطبيق ذكي على أندرويد", M.uaLabel("ZakiApp/5.2.0 (Android 15; Pixel 8)"))
        assertEquals("كروم على ويندوز", M.uaLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537"))
        assertEquals("إيدج على ويندوز", M.uaLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120"))
        assertEquals("متصفح ما بنعرف اسمه", M.uaLabel(null))
    }

    @Test fun `the person's settings open natively, the site's sections stay the site's, the company's are kept`() {
        val base = "https://workspace.zakiai.io"
        assertEquals(Destination.Settings, Links.destinationOf("/settings/me", base))
        assertEquals(Destination.Me("account"), Links.destinationOf("/settings/me/account", base))
        assertEquals(Destination.Me("devices"), Links.destinationOf("/settings/me/devices", base))
        assertEquals(Destination.Site("/settings/me/menu"), Links.destinationOf("/settings/me/menu", base))
        assertEquals(Destination.Site("/settings/me/company"), Links.destinationOf("/settings/me/company", base))
        assertTrue(SiteKept.isKept("/settings/me/company"))
        assertTrue(SiteKept.isKept("/settings/me/integrations"))
        assertFalse(SiteKept.isKept("/settings/me/menu"))
        assertEquals(Destination.Guide, Links.destinationOf("/guide", base))
        assertEquals(Destination.GuideArticle("tasks"), Links.destinationOf("/guide/tasks", base))
    }

    @Test fun `the notifications section the server is sent is the whole one`() {
        val sent = M.notificationsSection(mapOf("mentions" to M.NotifyRule(on = false)))
        assertEquals(setOf("mentions"), sent.jsonObject.keys)
    }
}
