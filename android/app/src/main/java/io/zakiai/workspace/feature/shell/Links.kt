package io.zakiai.workspace.feature.shell

import java.net.URI
import java.net.URLDecoder

/** Where an address of the site opens in the app. */
sealed interface Destination {
    data class Conversation(val id: String) : Destination
    data object Chats : Destination
    data object Notifications : Destination
    data object Settings : Destination
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
            if (next != null && CHAT.matches(next)) path = next
        }
        CHAT.find(path)?.let { return Destination.Conversation(it.groupValues[1]) }
        val bare = path.substringBefore('?').trimEnd('/')
        // «/settings…» stays the site's page: the profile, the password and the company's settings live there, not in the
        // native tab (which holds only what belongs to the phone: theme, lock, permissions)
        return when (bare) {
            "/chat" -> Destination.Chats
            "/notifications" -> Destination.Notifications
            else -> Destination.Site(path)
        }
    }
}
