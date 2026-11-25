package io.zakiai.workspace.feature.library

/**
 * The site's document markup (src/lib/docs/markup.ts), the same rules on the phone: «# » «## » «### » headings, «- » / «* » bullets,
 * «1. » / «1) » numbered items, blank lines between paragraphs; inside a line **bold**, [words](https://…) links (https, http, mailto only:
 * anything else stays the words it was written with) and @name of the space's people. Pure (unit-tested).
 */
object DocMarkup {
    sealed interface Inline {
        data class Text(val text: String) : Inline
        data class Bold(val children: List<Inline>) : Inline
        data class Link(val href: String, val text: String) : Inline
        data class Mention(val text: String) : Inline
    }

    sealed interface Block {
        data class Heading(val level: Int, val inline: List<Inline>) : Block
        data class Para(val inline: List<Inline>) : Block
        data class Bullets(val items: List<List<Inline>>) : Block
        data class Numbered(val items: List<List<Inline>>) : Block
    }

    private val HEADING = Regex("^(#{1,3}) +(.*)$")
    private val BULLET = Regex("^[-*] +(.*)$")
    private val NUMBERED = Regex("^\\d{1,3}[.)] +(.*)$")
    private val TOKEN = Regex("\\*\\*([^*]+?)\\*\\*|\\[([^\\]\\n]+)\\]\\(([^)\\n]*)\\)")
    private val CONTROL = Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]")

    fun clean(raw: String): String = raw.replace(Regex("\r\n?"), "\n").replace(CONTROL, "")

    /** The address of a link, or null when it is not https, http or mailto. */
    fun safeHref(raw: String): String? {
        val t = raw.trim()
        if (t != raw || t.isEmpty() || t.length > 2000 || t.any { it.isWhitespace() }) return null
        val lower = t.lowercase()
        return when {
            lower.startsWith("mailto:") -> if (t.length > 7) t else null
            lower.startsWith("https://") || lower.startsWith("http://") -> {
                val host = runCatching { java.net.URI(t).host }.getOrNull()
                if (host.isNullOrEmpty()) null else t
            }
            else -> null
        }
    }

    /** @name of a person of the space, as a whole word (the longest name first), else text. */
    private fun mentions(chunk: String, names: List<String>): List<Inline> {
        if (names.isEmpty() || '@' !in chunk) return listOf(Inline.Text(chunk))
        val sorted = names.filter { it.isNotBlank() }.sortedByDescending { it.length }
        val out = mutableListOf<Inline>()
        val buf = StringBuilder()
        var i = 0
        while (i < chunk.length) {
            val c = chunk[i]
            val starts = c == '@' && (i == 0 || !chunk[i - 1].isLetterOrDigit())
            val hit = if (starts) sorted.firstOrNull { n ->
                chunk.startsWith(n, i + 1) && (i + 1 + n.length == chunk.length || !chunk[i + 1 + n.length].isLetterOrDigit())
            } else null
            if (hit != null) {
                if (buf.isNotEmpty()) { out += Inline.Text(buf.toString()); buf.clear() }
                out += Inline.Mention("@$hit")
                i += 1 + hit.length
            } else {
                buf.append(c)
                i++
            }
        }
        if (buf.isNotEmpty()) out += Inline.Text(buf.toString())
        return out
    }

    fun parseInline(text: String, names: List<String>, allowBold: Boolean = true): List<Inline> {
        val out = mutableListOf<Inline>()
        fun plain(chunk: String) { if (chunk.isNotEmpty()) out += mentions(chunk, names) }
        var at = 0
        for (m in TOKEN.findAll(text)) {
            plain(text.substring(at, m.range.first))
            val bold = m.groups[1]
            if (bold != null) {
                if (allowBold) out += Inline.Bold(parseInline(bold.value, names, false)) else plain(m.value)
            } else {
                val label = m.groups[2]?.value.orEmpty()
                val href = safeHref(m.groups[3]?.value.orEmpty())
                if (href != null) out += Inline.Link(href, label) else plain(m.value)
            }
            at = m.range.last + 1
        }
        plain(text.substring(at))
        return merge(out)
    }

    private fun merge(nodes: List<Inline>): List<Inline> {
        val out = mutableListOf<Inline>()
        for (n in nodes) {
            val last = out.lastOrNull()
            if (n is Inline.Text && last is Inline.Text) out[out.size - 1] = Inline.Text(last.text + n.text) else out += n
        }
        return out
    }

    fun parse(content: String, names: List<String> = emptyList()): List<Block> {
        val blocks = mutableListOf<Block>()
        val para = mutableListOf<String>()
        fun flush() {
            if (para.isNotEmpty()) blocks += Block.Para(parseInline(para.joinToString("\n"), names))
            para.clear()
        }
        for (line in clean(content).split("\n")) {
            val t = line.trimEnd()
            val heading = HEADING.matchEntire(t)
            val bullet = BULLET.matchEntire(t)
            val numbered = NUMBERED.matchEntire(t)
            when {
                t.isBlank() -> flush()
                heading != null -> { flush(); blocks += Block.Heading(heading.groupValues[1].length, parseInline(heading.groupValues[2], names)) }
                bullet != null || numbered != null -> {
                    flush()
                    val item = parseInline((bullet ?: numbered)!!.groupValues[1], names)
                    val last = blocks.lastOrNull()
                    if (bullet != null) {
                        if (last is Block.Bullets) blocks[blocks.size - 1] = Block.Bullets(last.items + listOf(item)) else blocks += Block.Bullets(listOf(item))
                    } else {
                        if (last is Block.Numbered) blocks[blocks.size - 1] = Block.Numbered(last.items + listOf(item)) else blocks += Block.Numbered(listOf(item))
                    }
                }
                else -> para += t
            }
        }
        flush()
        return blocks
    }
}
