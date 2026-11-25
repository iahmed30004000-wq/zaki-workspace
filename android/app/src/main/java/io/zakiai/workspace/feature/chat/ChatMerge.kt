package io.zakiai.workspace.feature.chat

import io.zakiai.workspace.core.net.ChatRow
import io.zakiai.workspace.core.net.Message
import io.zakiai.workspace.core.net.MessagesPage
import io.zakiai.workspace.core.net.Reader

/** A tab of the list: a built-in one, or one of the person's own folders. */
sealed interface ListTab {
    val key: String
    data object All : ListTab { override val key = "all" }
    data object Unread : ListTab { override val key = "unread" }
    data object Dms : ListTab { override val key = "dm" }
    data object Spaces : ListTab { override val key = "spaces" }
    data object Mentions : ListTab { override val key = "mentions" }
    data object Archive : ListTab { override val key = "archive" }
    data class Custom(val folder: io.zakiai.workspace.core.net.Folder) : ListTab { override val key = "f:${folder.id}" }
}

/** Which rows a tab shows — the site's own rules (src/lib/chat/folders.ts, list-folders.ts). Pure (unit-tested). */
object ChatFilter {
    fun hasUnread(r: ChatRow) = r.unread > 0 || r.markedUnread

    private fun private(r: ChatRow) = r.kind == "DM" || r.kind == "GROUP"

    fun of(rows: List<ChatRow>, tab: ListTab): List<ChatRow> = when (tab) {
        // an archived chat lives in «الأرشيف» only
        ListTab.All -> rows.filter { !it.archivedByMe }
        ListTab.Unread -> rows.filter { !it.archivedByMe && hasUnread(it) }
        ListTab.Dms -> rows.filter { !it.archivedByMe && private(it) }
        ListTab.Spaces -> rows.filter { !it.archivedByMe && !private(it) }
        ListTab.Mentions -> rows.filter { !it.archivedByMe && it.mentionsUnread > 0 }
        ListTab.Archive -> rows.filter { it.archivedByMe }
        is ListTab.Custom -> rows.filter { includes(it, tab.folder) }
    }

    fun includes(r: ChatRow, f: io.zakiai.workspace.core.net.Folder): Boolean {
        val i = f.include
        val wanted = (i.dms && private(r)) || (i.spaces && !private(r)) || (i.mentions && r.mentionsUnread > 0) ||
            r.id in i.conversationIds || i.spaceIds.any { s -> r.space?.id == s || (r.kind == "SPACE" && r.id == s) }
        if (!wanted) return false
        if (f.exclude.muted && r.muted) return false
        if (f.exclude.read && !hasUnread(r)) return false
        if (f.exclude.archived && r.archivedByMe) return false
        return true
    }

    /** The number on a tab: the chats with something waiting (an archived one never counts outside «الأرشيف»). */
    fun badge(rows: List<ChatRow>, tab: ListTab): Int = of(rows, tab).count { hasUnread(it) && (tab == ListTab.Archive || !it.archivedByMe) }
}

/** One conversation as the phone holds it: a window of messages (oldest first) and what lies beyond it. */
data class ConvWindow(
    val messages: List<Message> = emptyList(),
    val hasOlder: Boolean = false,
    /** true while the window does not reach the newest message (a jump to an old reply): new messages are not appended then */
    val hasNewer: Boolean = false,
    val readers: List<Reader> = emptyList(),
    val firstUnreadId: String? = null,
    val loaded: Boolean = false,
)

/**
 * HOW WHAT ARRIVES IS FOLDED INTO WHAT THE PHONE HOLDS. Pure (unit-tested): the list's rows, a conversation's window, the read and
 * delivered marks. The server is the truth — a message it sends replaces the phone's copy of the same id, never the other way round.
 */
object ChatMerge {
    /**
     * Rows the server changed replace the phone's rows of the same id; removed ones (left, made private) go. Which NEW rows join is the
     * site's own rule (`mergeRowsIntoList`): in the one list (`all`) a topic lives inside its space's row, so a topic row only replaces one
     * already shown; in one space's list there is no space row, and only that space's topics (and the private chats) join.
     */
    fun rows(current: List<ChatRow>, incoming: List<ChatRow>, removed: Collection<String>, scope: String = "all", spaceId: String? = null): List<ChatRow> {
        if (incoming.isEmpty() && removed.isEmpty()) return current
        val gone = removed.toHashSet()
        val have = current.mapTo(HashSet()) { it.id }
        val take = incoming.filter { r ->
            when {
                r.id in gone -> false
                scope == "all" -> r.kind != "TOPIC" || r.id in have
                r.kind == "SPACE" -> false
                else -> r.id in have || r.space?.id == spaceId || r.kind == "DM" || r.kind == "GROUP"
            }
        }
        val byId = LinkedHashMap<String, ChatRow>()
        for (r in current) if (r.id !in gone) byId[r.id] = r
        for (r in take) byId[r.id] = r
        return byId.values.toList()
    }

    /** The list's order: my pins first, then the newest message first (a row with no message last). */
    fun ordered(rows: List<ChatRow>): List<ChatRow> =
        rows.sortedWith(compareByDescending<ChatRow> { it.pinnedByMe }.thenByDescending { it.lastMessage?.at.orEmpty() })

    private val byTime = compareBy<Message>({ it.createdAt }, { it.id })

    /**
     * Messages of this conversation that arrived (the live line's catch-up, a send's answer, an edit): the same id is replaced in
     * place; a new one joins the window only when the window reaches the newest message ([ConvWindow.hasNewer] false) — otherwise it
     * belongs to a part the phone has not loaded, and the bottom of the conversation fetches it. Hidden ones («حذف عندي») go.
     */
    fun window(w: ConvWindow, incoming: List<Message>, hidden: Collection<String> = emptyList()): ConvWindow {
        if (incoming.isEmpty() && hidden.isEmpty()) return w
        val gone = hidden.toHashSet()
        val byId = LinkedHashMap<String, Message>()
        for (m in w.messages) if (m.id !in gone) byId[m.id] = m
        for (m in incoming) {
            if (m.id in gone) continue
            if (m.id in byId || !w.hasNewer) byId[m.id] = m
        }
        return w.copy(messages = byId.values.sortedWith(byTime))
    }

    /** An older page (scrolling up) joins in front; a newer one (scrolling down after a jump) behind. Duplicates collapse. */
    fun page(w: ConvWindow, p: MessagesPage, older: Boolean): ConvWindow {
        val merged = window(w.copy(hasNewer = false), p.messages).messages
        return if (older) w.copy(messages = merged, hasOlder = p.hasOlder, readers = (w.readers + p.readers).distinctBy { it.userId }, loaded = true)
        else w.copy(messages = merged, hasNewer = p.hasNewer, readers = p.readers.ifEmpty { w.readers }, loaded = true)
    }

    /**
     * The newest page asked for again (the timer while the live line is down, a return to the screen) folded into the window: the older
     * pages already scrolled to stay. A window opened on an old message (`hasNewer`, a jump) is left alone; a window that the page does not
     * meet (more new messages than one page while away) is replaced, so no hole is ever drawn.
     */
    fun newest(w: ConvWindow, p: MessagesPage): ConvWindow {
        if (!w.loaded || w.messages.isEmpty()) return fresh(p)
        if (w.hasNewer) return w
        val pageFirst = p.messages.firstOrNull() ?: return w.copy(readers = p.readers.ifEmpty { w.readers })
        if (p.hasOlder && w.messages.last().createdAt < pageFirst.createdAt) return fresh(p)
        val merged = window(w, p.messages).messages
        val hasOlder = if (w.messages.first().createdAt >= pageFirst.createdAt) p.hasOlder else w.hasOlder
        return w.copy(messages = merged, hasOlder = hasOlder, readers = p.readers.ifEmpty { w.readers })
    }

    /** The newest window, fetched fresh: it replaces the phone's (an answer of the server is the truth). */
    fun fresh(p: MessagesPage): ConvWindow =
        ConvWindow(p.messages.sortedWith(byTime), p.hasOlder, p.hasNewer, p.readers, p.firstUnreadId, loaded = true)

    /**
     * Somebody else read (or got) the conversation up to `at`: my own messages up to then say so — read wins over delivered, and a
     * mark never goes back. In a topic or a group the person's face moves under the last message they read.
     */
    fun marks(w: ConvWindow, userId: String, name: String?, at: String, read: Boolean, me: String): ConvWindow {
        if (userId == me || at.isEmpty()) return w
        val messages = w.messages.map { m ->
            if (!m.mine || m.status == null || m.createdAt > at) m
            else if (read && m.status != "read") m.copy(status = "read")
            else if (!read && m.status == "sent") m.copy(status = "delivered")
            else m
        }
        val readers = if (!read) w.readers else {
            val last = w.messages.lastOrNull { it.createdAt <= at && it.kind != "SYSTEM" }
            if (last == null) w.readers
            else {
                val old = w.readers.firstOrNull { it.userId == userId }
                // a reader not on the phone yet: their name from their own messages here (never a blank face)
                val known = name ?: w.messages.lastOrNull { it.authorId == userId }?.authorName
                val mine = (old ?: Reader(userId = userId, name = known.orEmpty())).copy(messageId = last.id, readAt = at)
                w.readers.filter { it.userId != userId } + mine
            }
        }
        return w.copy(messages = messages, readers = readers)
    }
}
