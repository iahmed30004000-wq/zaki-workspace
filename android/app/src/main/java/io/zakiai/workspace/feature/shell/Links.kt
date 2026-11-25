package io.zakiai.workspace.feature.shell

import java.net.URI
import java.net.URLDecoder

/** Where an address of the site opens in the app. */
sealed interface Destination {
    /** `at`: the message to open it on (a notification of a mention, a search hit: `/chat/<id>?m=<messageId>`) */
    data class Conversation(val id: String, val at: String? = null) : Destination
    data object Chats : Destination
    data object Notifications : Destination
    data object Settings : Destination
    data object Today : Destination
    data object MyWork : Destination
    data class Task(val id: String) : Destination
    /** آ«ط§ظ„ظ…ط´ط§ط±ظٹط¹آ» (the work tab on its projects) */
    data object Projects : Destination
    data class Project(val id: String) : Destination
    data class Board(val id: String) : Destination
    data object Goals : Destination
    /** ⚠️ not native yet: the page of the site inside the app (WebBridge) */
    data class Site(val path: String) : Destination
}

/**
 * Reads an address of the site (a notification's, a tapped link, a call's) into the screen that shows it. Pure (unit-tested).
 * «/go?space=…&next=/chat/abc» enters a space and opens a page: the chat itself needs only the conversation. An address of
 * another site is never opened inside the app (it is the home page instead).
 */
object Links {
    private val CHAT = Regex("^/chat/([A-Za-z0-9_-]+)/?$")
    private val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    private val TASK = Regex("^/tasks/([A-Za-z0-9_-]+)/?$")
    // a project (its timeline is one of its tabs) and a board open natively too (M2 N3)
    private val PROJECT = Regex("^/projects/([A-Za-z0-9_-]+)(/timeline)?/?$")
    private val BOARD = Regex("^/boards/([A-Za-z0-9_-]+)/?$")

    fun pathOf(url: String?, base: String): String? {
        if (url.isNullOrBlank()) return null
        if (url.startsWith("/") && !url.startsWith("//")) return url
        if (!url.startsWith("$base/") && url != base) return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        return (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
    }

    fun destinationOf(url: String?, base: String): Destination? {
        var path = pathOf(url, base) ?: return null
        if (path.startsWith("/go?")) {
            val next = path.removePrefix("/go?").split("&").firstOrNull { it.startsWith("next=") }?.removePrefix("next=")
                ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
            if (next != null && listOf(CHAT, TASK, PROJECT, BOARD).any { it.matches(next.substringBefore('?')) }) path = next
        }
        // a task opens natively in any space: its sheet is read by id (the site's own scope rules decide)
        TASK.find(path.substringBefore('?'))?.let { return Destination.Task(it.groupValues[1]) }
        PROJECT.find(path.substringBefore('?'))?.let { return Destination.Project(it.groupValues[1]) }
        BOARD.find(path.substringBefore('?'))?.let { return Destination.Board(it.groupValues[1]) }
        CHAT.find(path.substringBefore('?'))?.let { match ->
            val at = path.substringAfter('?', "").split("&").firstOrNull { it.startsWith("m=") }?.removePrefix("m=")
                ?.takeIf { ID.matches(it) }
            return Destination.Conversation(match.groupValues[1], at)
        }
        val bare = path.substringBefore('?').trimEnd('/')
        // «/settings…» stays the site's page: the profile, the password and the company's settings live there, not in the
        // native tab (which holds only what belongs to the phone: theme, lock, permissions)
        return when (bare) {
            "/chat" -> Destination.Chats
            "/notifications" -> Destination.Notifications
            // «اليوم» is «/» (or «/?view=today» with the new menu), «مهامي» is «/my-work»
            "", "/" -> Destination.Today
            "/my-work" -> Destination.MyWork
            "/projects" -> Destination.Projects
            "/goals" -> Destination.Goals
            else -> Destination.Site(path)
        }
    }
}
