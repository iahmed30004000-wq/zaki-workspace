package io.zakiai.workspace.feature.web

/**
 * The two decisions of the file chooser of a page inside the app. Pure (unit-tested). The system's own shortcuts
 * (the chooser params' ready-made intent and result reader) ask for ONE file of the FIRST accepted kind and read one file
 * back, so «several pictures» or «pictures and videos» never reached the page.
 */
object FilePick {
    /** Every kind the page's input accepts. No kind, or one given only by its ending («.pdf», which the picker cannot filter by), means any file. */
    fun mimeTypes(accept: Array<String>?): List<String> {
        val asked = accept.orEmpty().flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
        return if (asked.isEmpty() || asked.any { '/' !in it }) listOf("*/*") else asked.distinct()
    }

    /** What the picker gave back: its list when several were picked, else the one address, else nothing. */
    fun <T : Any> picked(list: List<T>, single: T?): List<T> = if (list.isNotEmpty()) list.distinct() else listOfNotNull(single)
}
