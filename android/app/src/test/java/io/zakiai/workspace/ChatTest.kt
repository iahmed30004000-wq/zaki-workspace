package io.zakiai.workspace

import io.zakiai.workspace.core.live.SseFrame
import io.zakiai.workspace.core.live.SseParser
import io.zakiai.workspace.core.net.ChatRow
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.core.net.MessagesPage
import io.zakiai.workspace.core.net.RowLast
import io.zakiai.workspace.feature.chat.ChatFilter
import io.zakiai.workspace.feature.chat.ChatMerge
import io.zakiai.workspace.feature.chat.ConvWindow
import io.zakiai.workspace.feature.chat.ListTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun msg(id: String, at: String, body: String = "b-$id", mine: Boolean = false, status: String? = null) =
    Message(id = id, body = body, createdAt = at, mine = mine, status = status)

class ChatMergeTest {
    private val w = ConvWindow(listOf(msg("a", "2026-11-25T10:00:00.000Z"), msg("b", "2026-11-25T10:01:00.000Z")), loaded = true)

    @Test fun `a message the server sends again replaces the phone's copy in place`() {
        val edited = ChatMerge.window(w, listOf(msg("a", "2026-11-25T10:00:00.000Z", body = "edited")))
        assertEquals(listOf("a", "b"), edited.messages.map { it.id })
        assertEquals("edited", edited.messages[0].body)
    }

    @Test fun `a new message joins the window in time order, once`() {
        val late = msg("c", "2026-11-25T10:00:30.000Z")
        val once = ChatMerge.window(ChatMerge.window(w, listOf(late)), listOf(late))
        assertEquals(listOf("a", "c", "b"), once.messages.map { it.id })
    }

    @Test fun `a window that does not reach the newest message never gets a new one appended`() {
        val jumped = w.copy(hasNewer = true)
        val after = ChatMerge.window(jumped, listOf(msg("z", "2026-11-25T11:00:00.000Z"), msg("a", "2026-11-25T10:00:00.000Z", body = "x")))
        assertEquals(listOf("a", "b"), after.messages.map { it.id })
        assertEquals("x", after.messages[0].body)
    }

    @Test fun `a message hidden for me leaves the window`() {
        assertEquals(listOf("b"), ChatMerge.window(w, emptyList(), listOf("a")).messages.map { it.id })
    }

    @Test fun `an older page joins in front and says whether there is more`() {
        val older = ChatMerge.page(w, MessagesPage(listOf(msg("z", "2026-11-25T09:00:00.000Z")), hasOlder = false), older = true)
        assertEquals(listOf("z", "a", "b"), older.messages.map { it.id })
        assertTrue(!older.hasOlder)
    }

    @Test fun `my messages turn read up to the moment the other person read, never back`() {
        val mine = ConvWindow(listOf(msg("a", "2026-11-25T10:00:00.000Z", mine = true, status = "sent"), msg("b", "2026-11-25T10:05:00.000Z", mine = true, status = "sent")))
        val read = ChatMerge.marks(mine, "peer", "P", "2026-11-25T10:01:00.000Z", read = true, me = "me")
        assertEquals(listOf("read", "sent"), read.messages.map { it.status })
        val delivered = ChatMerge.marks(read, "peer", "P", "2026-11-25T10:06:00.000Z", read = false, me = "me")
        assertEquals(listOf("read", "delivered"), delivered.messages.map { it.status })
        // my own read mark changes nothing
        assertEquals(mine, ChatMerge.marks(mine, "me", "Me", "2026-11-25T11:00:00.000Z", read = true, me = "me"))
    }

    @Test fun `in a group the reader's face moves under the last message they read`() {
        val read = ChatMerge.marks(w, "u2", "Sara", "2026-11-25T10:00:10.000Z", read = true, me = "me")
        assertEquals("a", read.readers.single { it.userId == "u2" }.messageId)
        val later = ChatMerge.marks(read, "u2", "Sara", "2026-11-25T10:02:00.000Z", read = true, me = "me")
        assertEquals("b", later.readers.single { it.userId == "u2" }.messageId)
        assertEquals(1, later.readers.size)
    }

    @Test fun `rows are replaced, added and removed, and the list puts my pins first then the newest`() {
        val r1 = ChatRow("1", kind = "DM", lastMessage = RowLast(at = "2026-11-25T10:00:00.000Z"))
        val r2 = ChatRow("2", kind = "DM", lastMessage = RowLast(at = "2026-11-25T11:00:00.000Z"))
        val r3 = ChatRow("3", kind = "DM", pinnedByMe = true, lastMessage = RowLast(at = "2026-11-24T10:00:00.000Z"))
        val merged = ChatMerge.rows(listOf(r1, r2), listOf(r3, r1.copy(unread = 4)), removed = listOf("2"))
        assertEquals(listOf("1", "3"), merged.map { it.id })
        assertEquals(4, merged.first { it.id == "1" }.unread)
        assertEquals(listOf("3", "2", "1"), ChatMerge.ordered(listOf(r1, r2, r3)).map { it.id })
    }

    @Test fun `in the one list a topic lives inside its space's row, never beside it`() {
        val space = ChatRow("s1", kind = "SPACE")
        val topic = ChatRow("t1", kind = "TOPIC", space = io.zakiai.workspace.core.net.RowSpace("s1"))
        assertEquals(listOf("s1"), ChatMerge.rows(listOf(space), listOf(topic, space.copy(unread = 1)), emptyList(), "all").map { it.id })
        // a topic the list already shows is replaced
        assertEquals(3, ChatMerge.rows(listOf(space, topic), listOf(topic.copy(unread = 3)), emptyList(), "all").first { it.id == "t1" }.unread)
        // one space's list: no space row, only its own topics join
        val other = ChatRow("t2", kind = "TOPIC", space = io.zakiai.workspace.core.net.RowSpace("s2"))
        assertEquals(listOf("t1"), ChatMerge.rows(emptyList(), listOf(space, topic, other), emptyList(), "space", "s1").map { it.id })
    }
}

class ChatFilterTest {
    private val dm = ChatRow("d", kind = "DM", unread = 2)
    private val topic = ChatRow("t", kind = "TOPIC", space = io.zakiai.workspace.core.net.RowSpace("s1"), mentionsUnread = 1, unread = 1)
    private val archived = ChatRow("a", kind = "GROUP", archivedByMe = true, unread = 5)
    private val mutedRead = ChatRow("m", kind = "TOPIC", muted = true)
    private val rows = listOf(dm, topic, archived, mutedRead)

    @Test fun `the built-in tabs, and an archived chat only in the archive`() {
        assertEquals(listOf("d", "t", "m"), ChatFilter.of(rows, ListTab.All).map { it.id })
        assertEquals(listOf("d", "t"), ChatFilter.of(rows, ListTab.Unread).map { it.id })
        assertEquals(listOf("d"), ChatFilter.of(rows, ListTab.Dms).map { it.id })
        assertEquals(listOf("t", "m"), ChatFilter.of(rows, ListTab.Spaces).map { it.id })
        assertEquals(listOf("t"), ChatFilter.of(rows, ListTab.Mentions).map { it.id })
        assertEquals(listOf("a"), ChatFilter.of(rows, ListTab.Archive).map { it.id })
        assertEquals(2, ChatFilter.badge(rows, ListTab.All))
    }

    @Test fun `a folder of the person, with its own exclusions`() {
        val f = io.zakiai.workspace.core.net.Folder(
            id = "work",
            include = io.zakiai.workspace.core.net.FolderInclude(spaceIds = listOf("s1"), conversationIds = listOf("m", "a")),
            exclude = io.zakiai.workspace.core.net.FolderExclude(muted = true, archived = true),
        )
        assertEquals(listOf("t"), ChatFilter.of(rows, ListTab.Custom(f)).map { it.id })
    }
}

class EntryTest {
    @Test fun `newest first, the unread mark above the first unread message, a day line where the day changes`() {
        val lines = listOf(
            msg("c", "2026-11-25T10:00:00.000Z"),
            msg("b", "2026-11-25T09:00:00.000Z"),
            msg("a", "2026-11-24T09:00:00.000Z"),
        ).map { io.zakiai.workspace.feature.chat.Line(it.id, it) }
        val entries = io.zakiai.workspace.feature.chat.Entry.of(lines, firstUnreadId = "b") { it.substring(0, 10) }
        assertEquals(listOf("c", "b", "unread", "day-b", "a", "day-a"), entries.map { it.key })
    }
}

class PeaksTest {
    @Test fun `at most 100 values of 0 to 100, the loudest is 100`() {
        val p = io.zakiai.workspace.feature.chat.Peaks.of((1..250).map { it * 10 })
        assertTrue(p.size <= 100)
        assertEquals(100, p.last())
        assertTrue(p.all { it in 0..100 })
        assertEquals(emptyList<Int>(), io.zakiai.workspace.feature.chat.Peaks.of(emptyList()))
    }
}

class SystemLineTest {
    @Test fun `a system line is the site's sentence with the author's name`() {
        assertEquals("تثبيت رسالة بواسطة سارة", io.zakiai.workspace.feature.chat.C.systemLine("pin", emptyMap(), "سارة"))
        assertEquals("تحديث في المحادثة", io.zakiai.workspace.feature.chat.C.systemLine("nope", emptyMap(), "سارة"))
        // the line's own words never replace the author's name
        assertEquals("بلّش سارة مكالمة", io.zakiai.workspace.feature.chat.C.systemLine("call_started", mapOf("name" to "x"), "سارة"))
    }
}

class SseParserTest {
    private fun feed(vararg lines: String): List<SseFrame> {
        val p = SseParser()
        return lines.mapNotNull { p.line(it) }
    }

    @Test fun `a stored event carries its id and data, a named one its name`() {
        val frames = feed(
            "retry: 3000", "",
            "id: 42", "data: {\"kind\":\"message.created\"}", "",
            "event: ping", "data: 1700000000", "",
            ": a comment", "",
        )
        assertEquals(2, frames.size)
        assertEquals("42", frames[0].id)
        assertNull(frames[0].event)
        assertEquals("{\"kind\":\"message.created\"}", frames[0].data)
        assertEquals("ping", frames[1].event)
        assertNull(frames[1].id)
    }

    @Test fun `a typing frame has no id, and data on two lines is joined`() {
        val frames = feed("data: {\"kind\":", "data: \"typing\"}", "")
        assertNull(frames.single().id)
        assertEquals("{\"kind\":\n\"typing\"}", frames.single().data)
    }
}
