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
    /** «المشاريع» (the work tab on its projects) */
    data object Projects : Destination
    data class Project(val id: String) : Destination
    data class Board(val id: String) : Destination
    data object Goals : Destination
    /** «المكتبة» (its files, documents and product sheets), one document, one product sheet (M2 N4) */
    data object Library : Destination
    data class Document(val id: String) : Destination
    data class Sheet(val id: String) : Destination
    /** a call, native (M2 N5): the site's LiveKit room joined from the phone */
    data class Call(val id: String) : Destination
    /** a tab of «الشغل» (M2 N6): ideas · approvals · checkins · calendar · tickets · time */
    data class Work(val tab: String, val view: String? = null) : Destination
    data class Approval(val id: String) : Destination
    /** «الناس» (the staff directory), one person, one ticket (M2 N6 batch 2) */
    data object People : Destination
    data class Person(val id: String) : Destination
    data class Ticket(val id: String) : Destination
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
    private val DOCUMENT = Regex("^/documents/([A-Za-z0-9_-]+)/?$")
    private val SHEET = Regex("^/knowledge/([A-Za-z0-9_-]+)/?$")
    private val CALL = Regex("^/calls/([A-Za-z0-9_-]+)/?$")
    private val APPROVAL = Regex("^/approvals/([A-Za-z0-9_-]+)/?$")
    private val PERSON = Regex("^/u/([A-Za-z0-9_-]+)/?$")

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
            if (next != null && listOf(CHAT, TASK, PROJECT, BOARD, DOCUMENT, SHEET, CALL, APPROVAL, PERSON).any { it.matches(next.substringBefore('?')) }) path = next
        }
        // a task opens natively in any space: its sheet is read by id (the site's own scope rules decide)
        TASK.find(path.substringBefore('?'))?.let { return Destination.Task(it.groupValues[1]) }
        PROJECT.find(path.substringBefore('?'))?.let { return Destination.Project(it.groupValues[1]) }
        BOARD.find(path.substringBefore('?'))?.let { return Destination.Board(it.groupValues[1]) }
        DOCUMENT.find(path.substringBefore('?'))?.let { return Destination.Document(it.groupValues[1]) }
        SHEET.find(path.substringBefore('?'))?.let { return Destination.Sheet(it.groupValues[1]) }
        CALL.find(path.substringBefore('?'))?.let { return Destination.Call(it.groupValues[1]) }
        // «/approvals/forms» is still the site's page
        APPROVAL.find(path.substringBefore('?'))?.takeIf { it.groupValues[1] != "forms" }?.let { return Destination.Approval(it.groupValues[1]) }
        PERSON.find(path.substringBefore('?'))?.let { return Destination.Person(it.groupValues[1]) }
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
            "/files", "/documents", "/knowledge" -> Destination.Library
            "/ideas" -> Destination.Work("ideas")
            // a new request and a form («?new=1», «?fill=») are still the site's page; «?v=» picks the tab, as on the site
            "/approvals" -> {
                val q = path.substringAfter('?', "").split("&")
                if (q.any { it.startsWith("new=") || it.startsWith("fill=") || it.startsWith("link=") }) Destination.Site(path)
                else Destination.Work("approvals", q.firstOrNull { it.startsWith("v=") }?.removePrefix("v="))
            }
            "/checkins" -> Destination.Work("checkins")
            "/calendar" -> Destination.Work("calendar")
            "/requests" -> Destination.Work("requests")
            // a report narrowed by the site (a task's «تقرير الوقت»: ?taskId=, a range) stays the site's page: the phone has the week and the month only
            "/time" -> if (path.contains('?')) Destination.Site(path) else Destination.Work("time")
            // «?ticket=<id>» opens that ticket (the site opens its sheet over the desk)
            "/tickets" -> path.substringAfter('?', "").split("&").firstOrNull { it.startsWith("ticket=") }?.removePrefix("ticket=")
                ?.takeIf { ID.matches(it) }?.let { Destination.Ticket(it) } ?: Destination.Work("tickets")
            // «جديد» → a person (?new=) is the site's account form
            "/members", "/teams" -> if (path.contains("new=")) Destination.Site(path) else Destination.People
            else -> Destination.Site(path)
        }
    }
}
