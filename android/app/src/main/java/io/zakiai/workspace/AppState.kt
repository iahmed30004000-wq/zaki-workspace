package io.zakiai.workspace

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class Tab { CHAT, NOTES, MORE }

/** Where the person is in the app. One object, read by every screen. */
class AppState {
    var signedIn by mutableStateOf(false)
    var tab by mutableStateOf(Tab.CHAT)

    /** the page of the site open over everything (a path of the site), or null: the web view exists only while this is set */
    var webPath by mutableStateOf<String?>(null)

    /** the conversation open over the tabs, or null */
    var openConversation by mutableStateOf<String?>(null)
    var chatUnread by mutableIntStateOf(0)
    var notesUnread by mutableIntStateOf(0)

    /** Opens an address of the site (a notification's, a tapped link): chat pages are native, the rest opens in the web view. */
    fun open(url: String?) {
        if (url.isNullOrBlank()) return
        val uri = Uri.parse(url)
        var path = if (url.startsWith("/")) url else (uri.encodedPath ?: "/") + (uri.encodedQuery?.let { "?$it" } ?: "")
        // «/go?space=…&next=%2Fchat%2Fabc» switches the space then opens the page: the chat itself needs only the conversation
        if (path.startsWith("/go?")) {
            val next = Uri.parse("https://x$path").getQueryParameter("next")
            if (next != null && CHAT_PATH.matches(next)) path = next
        }
        val chat = CHAT_PATH.find(path)
        if (chat != null) {
            openConversation = chat.groupValues[1]
            tab = Tab.CHAT
            return
        }
        openConversation = null
        webPath = path
    }

    companion object {
        private val CHAT_PATH = Regex("^/chat/([A-Za-z0-9_-]+)/?$")
    }
}
