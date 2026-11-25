package io.zakiai.workspace.core.live

/** One frame of the site's live stream: `id:` (stored events only), `event:` (ping · reload · bye; absent = a message) and `data:`. */
data class SseFrame(val id: String?, val event: String?, val data: String)

/**
 * Reads the stream line by line (the text/event-stream format: fields until an empty line, `:` starts a comment). Pure (unit-tested):
 * the network code only feeds it lines.
 */
class SseParser {
    private var id: String? = null
    private var event: String? = null
    private val data = StringBuilder()

    /** Feeds one line (without its line break); returns the frame an empty line completes, or null. */
    fun line(raw: String): SseFrame? {
        if (raw.isEmpty()) {
            if (data.isEmpty() && event == null) { id = null; return null }
            val frame = SseFrame(id, event, data.toString())
            id = null; event = null; data.setLength(0)
            return frame
        }
        if (raw.startsWith(":")) return null
        val colon = raw.indexOf(':')
        val field = if (colon < 0) raw else raw.substring(0, colon)
        var value = if (colon < 0) "" else raw.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "id" -> id = value
            "event" -> event = value
            "data" -> { if (data.isNotEmpty()) data.append('\n'); data.append(value) }
        }
        return null
    }
}
